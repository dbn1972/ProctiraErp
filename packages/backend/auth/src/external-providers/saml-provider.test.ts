/**
 * Unit tests for SAMLProvider.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { SAMLProvider, DefaultSAMLResponseParser } from './saml-provider.js';
import type { SAMLResponseParser, SAMLParsedResponse } from './saml-provider.js';
import type { SAMLProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';

const samlConfig: SAMLProviderConfig = {
  type: 'saml',
  providerId: 'corp-saml',
  displayName: 'Corporate SAML',
  entryPoint: 'https://idp.corp.com/sso',
  idpCertificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
  issuer: 'https://app.example.com/saml/metadata',
  callbackUrl: 'https://app.example.com/auth/saml/callback',
  attributeMapping: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    displayName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  },
};

/** Mock SAML response parser for testing */
class MockSAMLResponseParser implements SAMLResponseParser {
  readonly verifiesSignature = true;
  public parseResult: SAMLParsedResponse | null = null;
  public parseError: Error | null = null;
  private seq = 0;
  async parseResponse(
    _samlResponse: string,
    _config: SAMLProviderConfig,
    context?: { expectedInResponseTo: string },
  ): Promise<SAMLParsedResponse> {
    if (this.parseError) throw this.parseError;
    if (!this.parseResult) throw new Error('No mock result configured');
    this.seq += 1;
    return {
      inResponseTo: context?.expectedInResponseTo,
      assertionId: `_assertion-${this.seq}`,
      ...this.parseResult,
    };
  }
}

describe('SAMLProvider', () => {
  let mockParser: MockSAMLResponseParser;
  let provider: SAMLProvider;

  beforeEach(() => {
    mockParser = new MockSAMLResponseParser();
    provider = new SAMLProvider(samlConfig, mockParser);
  });

  describe('initiateAuth', () => {
    it('should return redirect URL to IdP SSO endpoint', async () => {
      const result = await provider.initiateAuth('tenant-1');

      expect(result.redirectUrl).toContain('https://idp.corp.com/sso');
      expect(result.redirectUrl).toContain('SAMLRequest=');
      expect(result.redirectUrl).toContain('RelayState=');
      expect(result.state).toBeDefined();
    });

    it('should include a valid base64-encoded AuthnRequest', async () => {
      const result = await provider.initiateAuth('tenant-1');

      const url = new URL(result.redirectUrl);
      const samlRequest = url.searchParams.get('SAMLRequest');
      expect(samlRequest).toBeDefined();

      // Decode and verify it's valid XML
      // PRC-M587: HTTP-Redirect binding is DEFLATE + base64.
      const decoded = inflateRawSync(Buffer.from(samlRequest!, 'base64')).toString('utf-8');
      expect(decoded).toContain('AuthnRequest');
      expect(decoded).toContain('samlp:AuthnRequest');
      expect(decoded).toContain(samlConfig.issuer);
      expect(decoded).toContain(samlConfig.callbackUrl);
    });

    it('should generate unique relay states', async () => {
      const result1 = await provider.initiateAuth('tenant-1');
      const result2 = await provider.initiateAuth('tenant-1');

      expect(result1.state).not.toBe(result2.state);
    });
  });

  describe('handleCallback', () => {
    it('should parse SAML response and return user profile', async () => {
      // Initiate to store relay state
      const initResult = await provider.initiateAuth('tenant-1');

      mockParser.parseResult = {
        nameId: 'user@corp.com',
        sessionIndex: '_session123',
        attributes: {
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'user@corp.com',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'Corporate User',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Corporate',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'User',
        },
      };

      const profile = await provider.handleCallback(
        { samlResponse: 'base64-encoded-response', relayState: initResult.state },
        'tenant-1',
      );

      expect(profile.externalId).toBe('user@corp.com');
      expect(profile.email).toBe('user@corp.com');
      expect(profile.displayName).toBe('Corporate User');
      expect(profile.firstName).toBe('Corporate');
      expect(profile.lastName).toBe('User');
    });

    it('should use NameID as email when email attribute is missing', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      mockParser.parseResult = {
        nameId: 'user@corp.com',
        attributes: {},
      };

      const profile = await provider.handleCallback(
        { samlResponse: 'response', relayState: initResult.state },
        'tenant-1',
      );

      expect(profile.email).toBe('user@corp.com');
      expect(profile.externalId).toBe('user@corp.com');
    });

    it('should throw when SAML response is missing', async () => {
      await expect(
        provider.handleCallback({ relayState: 'some-state' }, 'tenant-1'),
      ).rejects.toThrow('SAML response is missing');
    });

    it('should throw on invalid relay state', async () => {
      await expect(
        provider.handleCallback(
          { samlResponse: 'response', relayState: 'invalid-state' },
          'tenant-1',
        ),
      ).rejects.toThrow('Invalid or expired relay state');
    });

    it('should throw on tenant mismatch', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      await expect(
        provider.handleCallback(
          { samlResponse: 'response', relayState: initResult.state },
          'tenant-2',
        ),
      ).rejects.toThrow('Tenant mismatch');
    });

    it('should throw when email cannot be determined', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      mockParser.parseResult = {
        nameId: 'not-an-email',
        attributes: {},
      };

      await expect(
        provider.handleCallback(
          { samlResponse: 'response', relayState: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('Could not determine email');
    });

    it('rejects unsolicited responses without RelayState (PRC-M587)', async () => {
      mockParser.parseResult = {
        nameId: 'user@corp.com',
        attributes: {
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'user@corp.com',
        },
      };
      await expect(
        provider.handleCallback({ samlResponse: 'response' }, 'tenant-1'),
      ).rejects.toMatchObject({ code: 'SAML_MISSING_RELAY_STATE' });
    });

    it('rejects a response that does not answer the pending AuthnRequest (PRC-M587)', async () => {
      const init = await provider.initiateAuth('tenant-1');
      mockParser.parseResult = {
        nameId: 'user@corp.com',
        inResponseTo: '_some-other-request',
        attributes: {},
      };
      await expect(
        provider.handleCallback({ samlResponse: 'r', relayState: init.state }, 'tenant-1'),
      ).rejects.toMatchObject({ code: 'SAML_IN_RESPONSE_TO_MISMATCH' });
    });

    it('rejects a replayed assertion and a reused RelayState (PRC-M587)', async () => {
      const first = await provider.initiateAuth('tenant-1');
      mockParser.parseResult = { nameId: 'user@corp.com', assertionId: '_fixed', attributes: {} };
      await provider.handleCallback({ samlResponse: 'r', relayState: first.state }, 'tenant-1');
      await expect(
        provider.handleCallback({ samlResponse: 'r', relayState: first.state }, 'tenant-1'),
      ).rejects.toMatchObject({ code: 'SAML_INVALID_RELAY_STATE' });
      const second = await provider.initiateAuth('tenant-1');
      await expect(
        provider.handleCallback({ samlResponse: 'r', relayState: second.state }, 'tenant-1'),
      ).rejects.toMatchObject({ code: 'SAML_ASSERTION_REPLAY' });
    });

    it('should propagate parser errors', async () => {
      const initResult = await provider.initiateAuth('tenant-1');

      mockParser.parseError = new ExternalAuthError(
        'Invalid signature',
        'corp-saml',
        'SAML_INVALID_SIGNATURE',
      );

      await expect(
        provider.handleCallback(
          { samlResponse: 'bad-response', relayState: initResult.state },
          'tenant-1',
        ),
      ).rejects.toThrow('Invalid signature');
    });
  });
});

describe('PRC-M587 parser gate', () => {
  it('refuses to construct without a parser or with the regex-only default parser', () => {
    expect(() => new SAMLProvider(samlConfig)).toThrow(/signature-verifying/);
    expect(() => new SAMLProvider(samlConfig, new DefaultSAMLResponseParser())).toThrow(
      /signature-verifying/,
    );
  });
});

describe('DefaultSAMLResponseParser', () => {
  const parser = new DefaultSAMLResponseParser();

  it('should parse a valid SAML response', async () => {
    const samlXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <samlp:Status>
          <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
        </samlp:Status>
        <saml:Assertion>
          <saml:Subject>
            <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">user@corp.com</saml:NameID>
          </saml:Subject>
          <saml:Conditions>
            <saml:AudienceRestriction>
              <saml:Audience>https://app.example.com/saml/metadata</saml:Audience>
            </saml:AudienceRestriction>
          </saml:Conditions>
          <saml:AuthnStatement SessionIndex="_session456"/>
          <saml:AttributeStatement>
            <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress">
              <saml:AttributeValue>user@corp.com</saml:AttributeValue>
            </saml:Attribute>
            <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name">
              <saml:AttributeValue>Test User</saml:AttributeValue>
            </saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>
    `;
    const encoded = Buffer.from(samlXml).toString('base64');

    const result = await parser.parseResponse(encoded, samlConfig);

    expect(result.nameId).toBe('user@corp.com');
    expect(
      result.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    ).toBe('user@corp.com');
    expect(result.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']).toBe(
      'Test User',
    );
  });

  it('should throw when NameID is missing', async () => {
    const samlXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <samlp:Status>
          <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
        </samlp:Status>
      </samlp:Response>
    `;
    const encoded = Buffer.from(samlXml).toString('base64');

    await expect(parser.parseResponse(encoded, samlConfig)).rejects.toThrow(
      'SAML response missing NameID',
    );
  });

  it('should throw on audience mismatch', async () => {
    const samlXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <saml:Assertion>
          <saml:Subject>
            <saml:NameID>user@corp.com</saml:NameID>
          </saml:Subject>
          <saml:Conditions>
            <saml:AudienceRestriction>
              <saml:Audience>https://wrong-audience.com</saml:Audience>
            </saml:AudienceRestriction>
          </saml:Conditions>
        </saml:Assertion>
      </samlp:Response>
    `;
    const encoded = Buffer.from(samlXml).toString('base64');

    await expect(parser.parseResponse(encoded, samlConfig)).rejects.toThrow('audience mismatch');
  });

  it('should throw on non-success status', async () => {
    const samlXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <samlp:Status>
          <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Requester"/>
        </samlp:Status>
        <saml:Assertion>
          <saml:Subject>
            <saml:NameID>user@corp.com</saml:NameID>
          </saml:Subject>
        </saml:Assertion>
      </samlp:Response>
    `;
    const encoded = Buffer.from(samlXml).toString('base64');

    await expect(parser.parseResponse(encoded, samlConfig)).rejects.toThrow(
      'SAML authentication failed',
    );
  });
});
