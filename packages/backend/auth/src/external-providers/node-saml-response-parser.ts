/**
 * PRC-M587: signature-verifying SAML response parser built on
 * `@node-saml/node-saml` (pinned in the dependency-lockfile batch; topic 1:
 * "SAML needs an XML-DSig dependency").
 *
 * node-saml verifies the XML signature against the IdP certificate
 * (XSW-safe: only the signed content is read), the assertion Conditions
 * (NotBefore / NotOnOrAfter with the configured clock skew), the
 * AudienceRestriction (our SP entity id) and the Response InResponseTo, which
 * must equal the AuthnRequest id `SAMLProvider` issued for this login. Only
 * the verified assertion is mapped into {@link SAMLParsedResponse}.
 * `SAMLProvider` keeps its own RelayState, tenant and assertion-replay checks.
 */
import {
  InMemoryCacheProvider,
  SAML,
  ValidateInResponseTo,
  type Profile,
} from '@node-saml/node-saml';

import type { SAMLParsedResponse, SAMLResponseParser } from './saml-provider.js';
import type { SAMLProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';

export interface NodeSamlResponseParserOptions {
  /** Accepted clock skew for Conditions (default 60 s). */
  acceptedClockSkewMs?: number;
  /** Also require a signature on the Response element (default false; the assertion is always signed). */
  wantAuthnResponseSigned?: boolean;
}

/** Profile fields that are not attributes. */
const PROFILE_FIELDS = new Set([
  'issuer',
  'sessionIndex',
  'nameID',
  'nameIDFormat',
  'nameQualifier',
  'spNameQualifier',
  'ID',
  'inResponseTo',
  'getAssertionXml',
  'getAssertion',
  'getSamlResponseXml',
]);

function assertionIdOf(profile: Profile): string | undefined {
  const xml = profile.getAssertionXml?.();
  if (!xml) return undefined;
  const match = /^\s*<(?:[\w-]+:)?Assertion\b[^>]*?\sID="([^"]+)"/.exec(xml);
  return match?.[1];
}

function attributesOf(profile: Profile): Record<string, string | string[]> {
  const attributes: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (PROFILE_FIELDS.has(key)) continue;
    if (typeof value === 'string') attributes[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      attributes[key] = value as string[];
    }
  }
  return attributes;
}

export class NodeSamlResponseParser implements SAMLResponseParser {
  readonly verifiesSignature = true;

  constructor(private readonly options: NodeSamlResponseParserOptions = {}) {}

  async parseResponse(
    samlResponse: string,
    config: SAMLProviderConfig,
    context?: { expectedInResponseTo: string },
  ): Promise<SAMLParsedResponse> {
    if (!config.idpCertificate?.trim()) {
      throw new ExternalAuthError(
        'SAML IdP certificate is not configured',
        config.providerId,
        'SAML_MISSING_IDP_CERT',
      );
    }
    if (!context?.expectedInResponseTo) {
      throw new ExternalAuthError(
        'SAML response cannot be validated without the pending AuthnRequest id',
        config.providerId,
        'SAML_IN_RESPONSE_TO_MISMATCH',
      );
    }

    // One-entry request cache: node-saml accepts only a response that answers
    // this exact AuthnRequest.
    const cacheProvider = new InMemoryCacheProvider({ keyExpirationPeriodMs: 10 * 60 * 1000 });
    await cacheProvider.saveAsync(context.expectedInResponseTo, new Date().toISOString());

    const saml = new SAML({
      idpCert: config.idpCertificate,
      issuer: config.issuer,
      audience: config.issuer,
      callbackUrl: config.callbackUrl,
      entryPoint: config.entryPoint,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: this.options.wantAuthnResponseSigned ?? false,
      acceptedClockSkewMs: this.options.acceptedClockSkewMs ?? 60_000,
      validateInResponseTo: ValidateInResponseTo.always,
      cacheProvider,
    });

    let profile: Profile | null;
    try {
      ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ExternalAuthError(
        `SAML response rejected: ${reason}`,
        config.providerId,
        'SAML_INVALID_RESPONSE',
      );
    }
    if (!profile?.nameID) {
      throw new ExternalAuthError(
        'SAML response missing NameID',
        config.providerId,
        'SAML_MISSING_NAMEID',
      );
    }

    return {
      nameId: profile.nameID,
      nameIdFormat: profile.nameIDFormat,
      ...(profile.sessionIndex ? { sessionIndex: profile.sessionIndex } : {}),
      attributes: attributesOf(profile),
      // Verified by node-saml against the one cached request id above.
      inResponseTo: context.expectedInResponseTo,
      assertionId: assertionIdOf(profile),
    };
  }
}
