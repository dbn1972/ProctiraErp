/**
 * PRC-M326 (DR50): MSG91 SMS, Amazon SES email and FCM push senders, contract-tested
 * against a stubbed provider (a local HTTP server speaking each API's request and
 * response shape). No real credentials; delivery against the real providers waits
 * for accounts and secrets.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createEmailSenderFromEnv,
  createPushSenderFromEnv,
  createSmsSenderFromEnv,
} from './channel-sender-factory.js';
import {
  createFcmPushSender,
  createMsg91SmsSender,
  createSesEmailSender,
  signAwsV4,
} from './live-channel-senders.js';

interface StubCall {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let server: Server;
let base: string;
const calls: StubCall[] = [];
let failSends = false;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    calls.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (failSends && !req.url?.startsWith('/token')) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'boom', echo: 'payer-secret' }));
      return;
    }
    if (req.url === '/msg91/flow/') {
      const ok = req.headers.authkey === 'stub-auth-key';
      res.statusCode = ok ? 200 : 401;
      res.end(JSON.stringify(ok ? { type: 'success', message: 'req-123' } : { type: 'error' }));
      return;
    }
    if (req.url === '/v2/email/outbound-emails') {
      res.end(JSON.stringify({ MessageId: 'ses-msg-1' }));
      return;
    }
    if (req.url === '/token') {
      const params = new URLSearchParams(body);
      const [h, c, sig] = (params.get('assertion') ?? '').split('.');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${h}.${c}`);
      const valid = verifier.verify(publicKey, Buffer.from(sig ?? '', 'base64url'));
      res.statusCode = valid ? 200 : 400;
      res.end(JSON.stringify(valid ? { access_token: 'ya29.stub', expires_in: 3600 } : {}));
      return;
    }
    if (req.url === '/v1/projects/demo-project/messages:send') {
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      const ok = req.headers.authorization === 'Bearer ya29.stub' && token !== 'dead-token';
      res.statusCode = ok ? 200 : 404;
      res.end(JSON.stringify(ok ? { name: `projects/demo-project/messages/${token}` } : {}));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls.length = 0;
  failSends = false;
});

describe('PRC-M326 MSG91 SMS sender', () => {
  it('posts the Flow API request with the auth key and returns the request id', async () => {
    const sender = createMsg91SmsSender({
      authKey: 'stub-auth-key',
      templateId: 'tmpl-1',
      apiBaseUrl: `${base}/msg91`,
    });
    const result = await sender.send({ to: '+91 98765-43210', body: 'Fee due', tenantId: 't1' });
    expect(result).toEqual({ success: true, messageId: 'req-123', mode: 'live' });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      template_id: 'tmpl-1',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', body: 'Fee due' }],
    });
  });

  it('fails closed on a refusal without echoing the provider body', async () => {
    failSends = true;
    const sender = createMsg91SmsSender({
      authKey: 'stub-auth-key',
      templateId: 'tmpl-1',
      apiBaseUrl: `${base}/msg91`,
    });
    const result = await sender.send({ to: '+919876543210', body: 'x', tenantId: 't1' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('payer-secret');
    expect((await sender.send({ to: '12', body: 'x', tenantId: 't1' })).success).toBe(false);
  });
});

describe('PRC-M326 SES email sender', () => {
  it('signAwsV4 matches the AWS SigV4 test-suite vector (get-vanilla)', () => {
    const headers = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: {},
      body: '',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('sends a signed SendEmail v2 request and returns the MessageId', async () => {
    const sender = createSesEmailSender(
      {
        region: 'ap-south-1',
        fromAddress: 'no-reply@school.example',
        accessKeyId: 'AKIDSTUB',
        secretAccessKey: 'stub-secret',
        apiBaseUrl: base,
      },
      undefined,
      () => new Date('2026-11-25T10:00:00Z'),
    );
    const result = await sender.send({
      to: 'parent@example.com',
      subject: 'Fee due',
      body: 'Please pay',
      tenantId: 't1',
    });
    expect(result).toEqual({ success: true, messageId: 'ses-msg-1', mode: 'live' });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.headers['x-amz-date']).toBe('20261125T100000Z');
    expect(call.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDSTUB\/20261125\/ap-south-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.parse(call.body)).toMatchObject({
      FromEmailAddress: 'no-reply@school.example',
      Destination: { ToAddresses: ['parent@example.com'] },
      Content: { Simple: { Subject: { Data: 'Fee due' }, Body: { Text: { Data: 'Please pay' } } } },
    });
  });
});

describe('PRC-M326 FCM push sender', () => {
  const config = {
    projectId: 'demo-project',
    clientEmail: 'svc@demo-project.iam.gserviceaccount.com',
    privateKey: PRIVATE_PEM,
  };

  it('mints an RS256 service-account token, sends per device and caches the token', async () => {
    const sender = createFcmPushSender(
      { ...config, apiBaseUrl: base, tokenUrl: `${base}/token` },
      async () => ['dev-a', 'dead-token'],
    );
    const first = await sender.send({ userId: 'u1', title: 'Fee', body: 'Due', tenantId: 't1' });
    expect(first).toEqual({
      success: true,
      messageId: 'projects/demo-project/messages/dev-a',
      mode: 'live',
    });
    await sender.send({ userId: 'u1', title: 'Fee', body: 'Due', tenantId: 't1' });
    expect(calls.filter((c) => c.url === '/token')).toHaveLength(1);
  });

  it('reports failure with no device or when every device is refused', async () => {
    const none = createFcmPushSender(
      { ...config, apiBaseUrl: base, tokenUrl: `${base}/token` },
      async () => [],
    );
    expect((await none.send({ userId: 'u1', title: 't', body: 'b', tenantId: 't1' })).success).toBe(
      false,
    );
    const dead = createFcmPushSender(
      { ...config, apiBaseUrl: base, tokenUrl: `${base}/token` },
      async () => ['dead-token'],
    );
    expect((await dead.send({ userId: 'u1', title: 't', body: 'b', tenantId: 't1' })).success).toBe(
      false,
    );
  });
});

describe('PRC-M326 env factories pick the live senders only with full credentials', () => {
  it('live + full credentials -> real provider calls; partial -> fail closed', async () => {
    const env = {
      PROVIDER_MODE: 'live',
      MSG91_AUTH_KEY: 'stub-auth-key',
      MSG91_TEMPLATE_ID: 'tmpl-1',
      MSG91_API_BASE_URL: `${base}/msg91`,
      SES_REGION: 'ap-south-1',
      SES_FROM_ADDRESS: 'no-reply@school.example',
      AWS_ACCESS_KEY_ID: 'AKIDSTUB',
      AWS_SECRET_ACCESS_KEY: 'stub-secret',
      SES_API_BASE_URL: base,
      FCM_PROJECT_ID: 'demo-project',
      FCM_CLIENT_EMAIL: 'svc@demo-project.iam.gserviceaccount.com',
      FCM_PRIVATE_KEY: PRIVATE_PEM.replace(/\n/g, '\\n'),
      FCM_API_BASE_URL: base,
      FCM_TOKEN_URL: `${base}/token`,
    };
    expect(
      (await createSmsSenderFromEnv(env).send({ to: '+919876543210', body: 'x', tenantId: 't' }))
        .success,
    ).toBe(true);
    expect(
      (
        await createEmailSenderFromEnv(env).send({
          to: 'a@b.example',
          subject: 's',
          body: 'b',
          tenantId: 't',
        })
      ).success,
    ).toBe(true);
    const push = createPushSenderFromEnv(env, { listDeviceTokens: async () => ['dev-a'] });
    expect((await push.send({ userId: 'u', title: 't', body: 'b', tenantId: 't' })).success).toBe(
      true,
    );
    // Without a device store the push factory stays fail-closed.
    const noStore = await createPushSenderFromEnv(env).send({
      userId: 'u',
      title: 't',
      body: 'b',
      tenantId: 't',
    });
    expect(noStore).toMatchObject({ success: false, mode: 'live' });
    const partial = await createSmsSenderFromEnv({ ...env, MSG91_TEMPLATE_ID: '' }).send({
      to: '+919876543210',
      body: 'x',
      tenantId: 't',
    });
    expect(partial).toMatchObject({ success: false, mode: 'live' });
  });
});
