// UATENV-D28: one Keycloak token request through the api-gateway, run as a child process so the
// synchronous e2e header helpers can obtain a real session. Input arrives on stdin (never argv)
// and the result goes to stdout for the parent only; nothing is logged.
//
// stdin:  {"gatewayUrl": "...", "op": "password", "username": "...", "password": "..."}
//         {"gatewayUrl": "...", "op": "refresh", "refreshToken": "..."}
// stdout: {"ok": true, "accessToken": "...", "refreshToken": "...", "expiresIn": 300}
//         {"ok": false, "status": 401, "code": "INVALID_CREDENTIALS"}

const TIMEOUT_MS = 20_000;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const input = await readStdin();
  const path = input.op === 'refresh' ? '/api/v1/auth/refresh' : '/api/v1/auth/password';
  const body =
    input.op === 'refresh'
      ? { refreshToken: input.refreshToken }
      : { username: input.username, password: input.password };
  let response;
  try {
    response = await fetch(new URL(path, input.gatewayUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE',
    };
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || typeof data.accessToken !== 'string') {
    // `mfa_required` arrives as a 401 with a status field instead of a code.
    return { ok: false, status: response.status, code: data.code ?? data.status ?? 'NO_TOKEN' };
  }
  return {
    ok: true,
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : undefined,
  };
}

main()
  .then((result) => process.stdout.write(JSON.stringify(result)))
  .catch(() => process.stdout.write(JSON.stringify({ ok: false, status: 0, code: 'BAD_INPUT' })));
