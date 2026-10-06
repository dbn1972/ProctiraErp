/**
 * SAML Identity Provider
 *
 * Implements SAML 2.0 authentication flow.
 * Generates AuthnRequests and validates SAML Responses.
 *
 * Uses a lightweight implementation that handles:
 * - AuthnRequest generation with deflate encoding
 * - SAML Response parsing and basic validation
 * - Attribute extraction from SAML assertions
 *
 * For production use with full signature validation, integrate @node-saml/node-saml.
 */
import { deflateRawSync } from 'node:zlib';

import { v4 as uuidv4 } from 'uuid';

import type {
  ExternalAuthProvider,
  SAMLProviderConfig,
  AuthInitiationResult,
  AuthCallbackParams,
  ExternalUserProfile,
} from './types.js';
import { ExternalAuthError } from './types.js';

/**
 * Default SAML attribute names for common profile fields.
 */
const DEFAULT_ATTRIBUTE_MAPPING = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  displayName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
};

/**
 * Interface for SAML response parsing (allows mocking in tests).
 */
export interface SAMLResponseParser {
  /**
   * PRC-M587: must be `true` only for parsers that verify the XML signature
   * (Response/Assertion, XSW-safe), Conditions/NotOnOrAfter and audience —
   * e.g. an adapter over @node-saml/node-saml. SAMLProvider refuses any other.
   */
  readonly verifiesSignature?: boolean;
  /**
   * Parse and validate a SAML response.
   * Returns the extracted attributes and name ID.
   */
  parseResponse(
    samlResponse: string,
    config: SAMLProviderConfig,
    context?: { expectedInResponseTo: string },
  ): Promise<SAMLParsedResponse>;
}

/**
 * Parsed SAML response data.
 */
export interface SAMLParsedResponse {
  /** Name ID from the assertion (usually email or unique identifier) */
  nameId: string;
  /** Name ID format */
  nameIdFormat?: string;
  /** Session index from the assertion */
  sessionIndex?: string;
  /** Extracted attributes from the assertion */
  attributes: Record<string, string | string[]>;
  /** PRC-M587: Response@InResponseTo (must equal the AuthnRequest ID). */
  inResponseTo?: string;
  /** PRC-M587: Assertion@ID, used for replay detection. */
  assertionId?: string;
}

/**
 * Default SAML response parser.
 * Performs basic XML parsing of the SAML response.
 * For production, use @node-saml/node-saml for full signature validation.
 */
export class DefaultSAMLResponseParser implements SAMLResponseParser {
  /** PRC-M587: regex extraction only — never accepted by SAMLProvider. */
  readonly verifiesSignature = false;
  async parseResponse(
    samlResponse: string,
    config: SAMLProviderConfig,
  ): Promise<SAMLParsedResponse> {
    // Decode base64 SAML response
    const xml = Buffer.from(samlResponse, 'base64').toString('utf-8');

    // Basic XML parsing (simplified - production should use proper XML parser with signature validation)
    const nameId = this.extractElement(xml, 'NameID');
    if (!nameId) {
      throw new ExternalAuthError(
        'SAML response missing NameID',
        config.providerId,
        'SAML_MISSING_NAMEID',
      );
    }

    // Verify the response is for our issuer (basic audience check)
    const audience = this.extractElement(xml, 'Audience');
    if (audience && audience !== config.issuer) {
      throw new ExternalAuthError(
        `SAML audience mismatch: expected ${config.issuer}, got ${audience}`,
        config.providerId,
        'SAML_AUDIENCE_MISMATCH',
      );
    }

    // Check for status code (Success)
    const statusCode = this.extractAttribute(xml, 'StatusCode', 'Value');
    if (statusCode && !statusCode.includes('Success')) {
      throw new ExternalAuthError(
        `SAML authentication failed with status: ${statusCode}`,
        config.providerId,
        'SAML_AUTH_FAILED',
      );
    }

    // Extract attributes
    const attributes = this.extractAttributes(xml);

    // Extract session index
    const sessionIndex = this.extractAttribute(xml, 'AuthnStatement', 'SessionIndex') ?? undefined;

    return {
      nameId,
      sessionIndex,
      attributes,
    };
  }

  /**
   * Extract text content of an XML element (simplified regex-based).
   */
  private extractElement(xml: string, elementName: string): string | null {
    // Handle namespaced elements (e.g., saml:NameID, saml2:NameID)
    const regex = new RegExp(
      `<(?:[\\w]+:)?${elementName}[^>]*>([^<]+)</(?:[\\w]+:)?${elementName}>`,
      'i',
    );
    const match = xml.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  /**
   * Extract an attribute value from an XML element.
   */
  private extractAttribute(xml: string, elementName: string, attrName: string): string | null {
    const regex = new RegExp(`<(?:[\\w]+:)?${elementName}[^>]*${attrName}="([^"]*)"`, 'i');
    const match = xml.match(regex);
    return match?.[1] ?? null;
  }

  /**
   * Extract SAML attributes from AttributeStatement.
   */
  private extractAttributes(xml: string): Record<string, string | string[]> {
    const attributes: Record<string, string | string[]> = {};

    // Match Attribute elements with Name and AttributeValue
    const attrRegex =
      /<(?:[\w]+:)?Attribute\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Attribute>/gi;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(xml)) !== null) {
      const name = attrMatch[1]!;
      const valueBlock = attrMatch[2]!;

      // Extract AttributeValue elements
      const valueRegex = /<(?:[\w]+:)?AttributeValue[^>]*>([^<]*)<\/(?:[\w]+:)?AttributeValue>/gi;
      const values: string[] = [];
      let valueMatch: RegExpExecArray | null;

      while ((valueMatch = valueRegex.exec(valueBlock)) !== null) {
        values.push(valueMatch[1]!.trim());
      }

      if (values.length === 1) {
        attributes[name] = values[0]!;
      } else if (values.length > 1) {
        attributes[name] = values;
      }
    }

    return attributes;
  }
}

/**
 * SAML Identity Provider implementation.
 */
export class SAMLProvider implements ExternalAuthProvider {
  readonly providerId: string;
  readonly type = 'saml' as const;
  readonly displayName: string;

  private readonly config: SAMLProviderConfig;
  private readonly responseParser: SAMLResponseParser;
  private readonly attributeMapping: Required<NonNullable<SAMLProviderConfig['attributeMapping']>>;

  // Store relay states for validation
  private readonly pendingRequests = new Map<
    string,
    { tenantId: string; requestId: string; createdAt: number }
  >();
  /** PRC-M587: consumed Assertion IDs (replay cache, pruned with pending requests). */
  private readonly seenAssertions = new Map<string, number>();
  constructor(config: SAMLProviderConfig, responseParser?: SAMLResponseParser) {
    // PRC-M587: refuse to run without a signature-verifying parser. The built-in
    // regex parser accepts forged, unsigned assertions.
    if (!responseParser || responseParser.verifiesSignature !== true) {
      throw new ExternalAuthError(
        'SAML provider requires a signature-verifying response parser (e.g. @node-saml/node-saml adapter)',
        config.providerId,
        'SAML_UNVERIFIED_PARSER',
      );
    }
    this.config = config;
    this.providerId = config.providerId;
    this.displayName = config.displayName;
    this.responseParser = responseParser;
    this.attributeMapping = {
      email: config.attributeMapping?.email ?? DEFAULT_ATTRIBUTE_MAPPING.email,
      displayName: config.attributeMapping?.displayName ?? DEFAULT_ATTRIBUTE_MAPPING.displayName,
      firstName: config.attributeMapping?.firstName ?? DEFAULT_ATTRIBUTE_MAPPING.firstName,
      lastName: config.attributeMapping?.lastName ?? DEFAULT_ATTRIBUTE_MAPPING.lastName,
    };
  }

  /**
   * Initiate the SAML authentication flow.
   * Generates an AuthnRequest and returns the IdP SSO URL with the request.
   */
  async initiateAuth(tenantId: string): Promise<AuthInitiationResult> {
    const requestId = `_${uuidv4()}`;
    const relayState = uuidv4();

    // Store relay state for callback validation
    this.pendingRequests.set(relayState, { tenantId, requestId, createdAt: Date.now() });
    this.cleanupPendingRequests();

    // Generate AuthnRequest XML
    const authnRequest = this.generateAuthnRequest(requestId);

    // Encode for HTTP-Redirect binding (deflate + base64 + URL encode)
    const encoded = deflateRawSync(Buffer.from(authnRequest, 'utf-8')).toString('base64');

    const params = new URLSearchParams({
      SAMLRequest: encoded,
      RelayState: relayState,
    });

    const redirectUrl = `${this.config.entryPoint}?${params.toString()}`;

    return { redirectUrl, state: relayState };
  }

  /**
   * Handle the SAML callback (Assertion Consumer Service).
   * Parses and validates the SAML response, extracts user profile.
   */
  async handleCallback(params: AuthCallbackParams, tenantId: string): Promise<ExternalUserProfile> {
    if (!params.samlResponse) {
      throw new ExternalAuthError(
        'SAML response is missing from callback',
        this.providerId,
        'SAML_MISSING_RESPONSE',
      );
    }

    // PRC-M587: RelayState is mandatory (no unsolicited IdP-initiated logins)
    // and single-use; the response must answer this exact AuthnRequest.
    if (!params.relayState) {
      throw new ExternalAuthError(
        'SAML RelayState is required',
        this.providerId,
        'SAML_MISSING_RELAY_STATE',
      );
    }
    const storedRequest = this.pendingRequests.get(params.relayState);
    if (!storedRequest) {
      throw new ExternalAuthError(
        'Invalid or expired relay state',
        this.providerId,
        'SAML_INVALID_RELAY_STATE',
      );
    }
    this.pendingRequests.delete(params.relayState);
    if (storedRequest.tenantId !== tenantId) {
      throw new ExternalAuthError(
        'Tenant mismatch in SAML callback',
        this.providerId,
        'SAML_TENANT_MISMATCH',
      );
    }

    const parsed = await this.responseParser.parseResponse(params.samlResponse, this.config, {
      expectedInResponseTo: storedRequest.requestId,
    });
    if (parsed.inResponseTo !== storedRequest.requestId) {
      throw new ExternalAuthError(
        'SAML response does not answer the pending AuthnRequest',
        this.providerId,
        'SAML_IN_RESPONSE_TO_MISMATCH',
      );
    }
    if (!parsed.assertionId || this.seenAssertions.has(parsed.assertionId)) {
      throw new ExternalAuthError(
        'SAML assertion is missing an ID or was already used',
        this.providerId,
        'SAML_ASSERTION_REPLAY',
      );
    }
    this.seenAssertions.set(parsed.assertionId, Date.now());

    // Extract user profile from attributes
    const profile = this.buildProfile(parsed);

    return profile;
  }

  /**
   * Build user profile from parsed SAML response.
   */
  private buildProfile(parsed: SAMLParsedResponse): ExternalUserProfile {
    const attrs = parsed.attributes;

    // Get email from attributes or fall back to NameID
    const emailAttr = this.getAttributeValue(attrs, this.attributeMapping.email);
    const email = emailAttr ?? parsed.nameId;

    if (!email || !email.includes('@')) {
      throw new ExternalAuthError(
        'Could not determine email from SAML response',
        this.providerId,
        'SAML_MISSING_EMAIL',
      );
    }

    const displayName = this.getAttributeValue(attrs, this.attributeMapping.displayName);
    const firstName = this.getAttributeValue(attrs, this.attributeMapping.firstName);
    const lastName = this.getAttributeValue(attrs, this.attributeMapping.lastName);

    return {
      externalId: parsed.nameId,
      email,
      displayName: displayName ?? (`${firstName ?? ''} ${lastName ?? ''}`.trim() || email),
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      rawAttributes: attrs as Record<string, unknown>,
    };
  }

  /**
   * Get a single string value from SAML attributes.
   */
  private getAttributeValue(attrs: Record<string, string | string[]>, key: string): string | null {
    const value = attrs[key];
    if (!value) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  }

  /**
   * Generate a SAML AuthnRequest XML document.
   */
  private generateAuthnRequest(requestId: string): string {
    const issueInstant = new Date().toISOString();
    const nameIdFormat =
      this.config.nameIdFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

    return `<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${requestId}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  Destination="${this.config.entryPoint}"
  AssertionConsumerServiceURL="${this.config.callbackUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${this.config.issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="${nameIdFormat}" AllowCreate="true"/>
</samlp:AuthnRequest>`;
  }

  /**
   * Clean up expired pending requests (older than 10 minutes).
   */
  private cleanupPendingRequests(): void {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [state, data] of this.pendingRequests.entries()) {
      if (data.createdAt < tenMinutesAgo) {
        this.pendingRequests.delete(state);
      }
    }
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, at] of this.seenAssertions.entries()) {
      if (at < dayAgo) this.seenAssertions.delete(id);
    }
  }
}

/**
 * Create a SAML provider instance.
 */
export function createSAMLProvider(
  config: SAMLProviderConfig,
  responseParser?: SAMLResponseParser,
): SAMLProvider {
  return new SAMLProvider(config, responseParser);
}
