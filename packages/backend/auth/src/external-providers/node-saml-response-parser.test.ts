/**
 * PRC-M587: SAML login through a signature-verifying parser
 * (`@node-saml/node-saml`). A response whose assertion is signed by the
 * configured IdP certificate, for our audience, answering the pending
 * AuthnRequest, is accepted; unsigned, tampered, wrong-certificate,
 * wrong-audience, expired and unsolicited responses are rejected.
 *
 * The test IdP key and certificate are generated per run with `openssl`
 * (no key material is committed).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { signSamlPost } from '@node-saml/node-saml/lib/saml-post-signing';
import { afterAll, describe, expect, it } from 'vitest';

import { NodeSamlResponseParser } from './node-saml-response-parser.js';
import { SAMLProvider, createSAMLProvider } from './saml-provider.js';
import type { SAMLProviderConfig } from './types.js';
import { ExternalAuthError } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'saml-idp-'));
function keyPair(name: string): { key: string; cert: string } {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
      '-keyout',
      join(dir, `${name}.key`),
      '-out',
      join(dir, `${name}.crt`),
    ],
    { stdio: 'ignore' },
  );
  return {
    key: readFileSync(join(dir, `${name}.key`), 'utf8'),
    cert: readFileSync(join(dir, `${name}.crt`), 'utf8'),
  };
}
const idp = keyPair('idp');
const attacker = keyPair('attacker');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SP_ENTITY = 'https://app.example.com/saml/metadata';
const ACS = 'https://app.example.com/auth/saml/callback';
const config: SAMLProviderConfig = {
  type: 'saml',
  providerId: 'corp-saml',
  displayName: 'Corporate SAML',
  entryPoint: 'https://idp.corp.test/sso',
  idpCertificate: idp.cert,
  issuer: SP_ENTITY,
  callbackUrl: ACS,
};

const EMAIL_ATTR = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const ASSERTION_XPATH =
  '/*[local-name(.)="Response"]/*[local-name(.)="Assertion" and namespace-uri(.)="urn:oasis:names:tc:SAML:2.0:assertion"]';

function responseXml(opts: {
  inResponseTo: string;
  audience?: string;
  notOnOrAfter?: Date;
  assertionId?: string;
  email?: string;
}): string {
  const now = new Date();
  const later = opts.notOnOrAfter ?? new Date(now.getTime() + 5 * 60 * 1000);
  const before = new Date(now.getTime() - 60 * 1000);
  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp1" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${ACS}" InResponseTo="${opts.inResponseTo}">` +
    `<saml:Issuer>https://idp.corp.test</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${opts.assertionId ?? '_assert1'}" Version="2.0" IssueInstant="${now.toISOString()}">` +
    `<saml:Issuer>https://idp.corp.test</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jane@corp.test</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later.toISOString()}" Recipient="${ACS}" InResponseTo="${opts.inResponseTo}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${before.toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${opts.audience ?? SP_ENTITY}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_sess1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="${EMAIL_ATTR}"><saml:AttributeValue>${opts.email ?? 'jane@corp.test'}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion></samlp:Response>`
  );
}

function sign(xml: string, key = idp.key): string {
  return signSamlPost(xml, ASSERTION_XPATH, {
    privateKey: key,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
  });
}

const b64 = (xml: string) => Buffer.from(xml, 'utf8').toString('base64');

async function startLogin(provider: SAMLProvider) {
  const { redirectUrl, state } = await provider.initiateAuth('tenant-a');
  const { inflateRawSync } = await import('node:zlib');
  const request = inflateRawSync(
    Buffer.from(new URL(redirectUrl).searchParams.get('SAMLRequest')!, 'base64'),
  ).toString();
  const requestId = /ID="([^"]+)"/.exec(request)![1]!;
  return { relayState: state!, requestId };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return error instanceof ExternalAuthError ? error.code : String(error);
  }
}

describe('NodeSamlResponseParser (PRC-M587)', () => {
  it('createSAMLProvider defaults to the signature-verifying parser', () => {
    expect(() => createSAMLProvider(config)).not.toThrow();
  });

  it('accepts a signed assertion that answers the pending AuthnRequest', async () => {
    const provider = createSAMLProvider(config, new NodeSamlResponseParser());
    const { relayState, requestId } = await startLogin(provider);
    const profile = await provider.handleCallback(
      { samlResponse: b64(sign(responseXml({ inResponseTo: requestId }))), relayState },
      'tenant-a',
    );
    expect(profile).toMatchObject({ externalId: 'jane@corp.test', email: 'jane@corp.test' });
  });

  it('rejects an unsigned response', async () => {
    const provider = createSAMLProvider(config);
    const { relayState, requestId } = await startLogin(provider);
    expect(
      await code(
        provider.handleCallback(
          { samlResponse: b64(responseXml({ inResponseTo: requestId })), relayState },
          'tenant-a',
        ),
      ),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects an assertion signed by another key', async () => {
    const provider = createSAMLProvider(config);
    const { relayState, requestId } = await startLogin(provider);
    const forged = sign(responseXml({ inResponseTo: requestId }), attacker.key);
    expect(
      await code(provider.handleCallback({ samlResponse: b64(forged), relayState }, 'tenant-a')),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects a signed assertion edited after signing', async () => {
    const provider = createSAMLProvider(config);
    const { relayState, requestId } = await startLogin(provider);
    const tampered = sign(responseXml({ inResponseTo: requestId })).replace(
      'jane@corp.test</saml:AttributeValue>',
      'admin@corp.test</saml:AttributeValue>',
    );
    expect(
      await code(provider.handleCallback({ samlResponse: b64(tampered), relayState }, 'tenant-a')),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects a wrong audience', async () => {
    const provider = createSAMLProvider(config);
    const { relayState, requestId } = await startLogin(provider);
    const xml = sign(responseXml({ inResponseTo: requestId, audience: 'https://other-sp' }));
    expect(
      await code(provider.handleCallback({ samlResponse: b64(xml), relayState }, 'tenant-a')),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects an expired assertion', async () => {
    const provider = createSAMLProvider(config);
    const { relayState, requestId } = await startLogin(provider);
    const xml = sign(
      responseXml({ inResponseTo: requestId, notOnOrAfter: new Date(Date.now() - 10 * 60_000) }),
    );
    expect(
      await code(provider.handleCallback({ samlResponse: b64(xml), relayState }, 'tenant-a')),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects a response answering a different AuthnRequest', async () => {
    const provider = createSAMLProvider(config);
    const { relayState } = await startLogin(provider);
    const xml = sign(responseXml({ inResponseTo: '_some-other-request' }));
    expect(
      await code(provider.handleCallback({ samlResponse: b64(xml), relayState }, 'tenant-a')),
    ).toBe('SAML_INVALID_RESPONSE');
  });

  it('rejects a replayed assertion on a second login', async () => {
    const provider = createSAMLProvider(config);
    const first = await startLogin(provider);
    const xml = (id: string) => sign(responseXml({ inResponseTo: id, assertionId: '_same' }));
    await provider.handleCallback(
      { samlResponse: b64(xml(first.requestId)), relayState: first.relayState },
      'tenant-a',
    );
    const second = await startLogin(provider);
    expect(
      await code(
        provider.handleCallback(
          { samlResponse: b64(xml(second.requestId)), relayState: second.relayState },
          'tenant-a',
        ),
      ),
    ).toBe('SAML_ASSERTION_REPLAY');
  });

  it('refuses to parse without an IdP certificate', async () => {
    const parser = new NodeSamlResponseParser();
    expect(
      await code(
        parser.parseResponse(
          'x',
          { ...config, idpCertificate: '' },
          { expectedInResponseTo: '_r' },
        ),
      ),
    ).toBe('SAML_MISSING_IDP_CERT');
  });
});
