/**
 * PRC-M602 — plugin sandbox child process entry.
 *
 * This file is shipped as-is and must stay dependency-free and self-contained:
 * the parent starts it with
 *   --experimental-permission --allow-fs-read=<this file>
 *   --disallow-code-generation-from-strings --max-old-space-size=<n>
 * and an empty environment, so it cannot load a TS loader, a relative import or a
 * package. Only `node:` built-ins are available, and the permission model denies
 * fs reads (other than this file), fs writes, child processes, workers and native
 * bindings.
 *
 * Plugin source arrives over IPC as a string and runs inside a `vm` context created
 * with `codeGeneration: { strings: false, wasm: false }` and no `require`,
 * `process` or `import`. Host values cross into that realm only as JSON strings that
 * are parsed inside the realm, so the plugin never receives a host object other than
 * the three bridge functions below (whose `constructor` is the host `Function`,
 * which `--disallow-code-generation-from-strings` turns into an EvalError).
 *
 * Network access is only possible through the `fetch` bridge, which asks the parent
 * over IPC; the parent applies the egress policy (allow-list + SSRF guard).
 */
import vm from 'node:vm';

/** Bootstrap that runs inside the plugin realm. Receives host bridges, keeps them private. */
const BOOTSTRAP = `(function (hostFetch, hostTimer, hostClearTimer, contextJson, maxTimerMs) {
  'use strict';
  const g = globalThis;
  const noop = function () {};
  g.console = Object.freeze({ log: noop, info: noop, warn: noop, error: noop, debug: noop });
  g.__pluginContext = Object.freeze(JSON.parse(contextJson));
  g.setTimeout = function (fn, ms) {
    if (typeof fn !== 'function') throw new TypeError('setTimeout callback must be a function');
    const delay = Math.max(0, Math.min(Number(ms) || 0, maxTimerMs));
    return hostTimer(function () { fn(); }, delay);
  };
  g.clearTimeout = function (id) { hostClearTimer(Number(id)); };
  g.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : String(input && input.url);
    const request = JSON.stringify({
      url: url,
      method: init && init.method ? String(init.method) : 'GET',
      headers: init && init.headers ? init.headers : {},
      body: init && init.body !== undefined ? String(init.body) : undefined,
    });
    return new Promise(function (resolve, reject) {
      hostFetch(request, function (error, responseJson) {
        if (error) { reject(new Error(String(error))); return; }
        const r = JSON.parse(responseJson);
        resolve(Object.freeze({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: Object.freeze(r.headers),
          text: function () { return Promise.resolve(r.body); },
          json: function () { return Promise.resolve(JSON.parse(r.body)); },
        }));
      });
    });
  };
  return function serialize(value) { return JSON.stringify(value === undefined ? null : value); };
})`;

let nextFetchId = 1;
const pendingFetches = new Map();
let nextTimerId = 1;
const timers = new Map();

function send(message) {
  if (typeof process.send === 'function') process.send(message);
}

function hostFetch(requestJson, callback) {
  if (typeof requestJson !== 'string' || typeof callback !== 'function') return;
  const id = nextFetchId++;
  pendingFetches.set(id, callback);
  send({ type: 'fetch', id, request: requestJson });
}

function hostTimer(fn, ms) {
  const id = nextTimerId++;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms),
  );
  return id;
}

function hostClearTimer(id) {
  const handle = timers.get(id);
  if (handle) clearTimeout(handle);
  timers.delete(id);
}

function errorText(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}

async function execute(message) {
  const startedAt = Date.now();
  const heapBefore = process.memoryUsage().heapUsed;
  const metrics = () => ({
    durationMs: Date.now() - startedAt,
    peakMemoryBytes: Math.max(0, process.memoryUsage().heapUsed - heapBefore),
  });
  try {
    const context = vm.createContext(Object.create(null), {
      name: 'plugin-sandbox',
      codeGeneration: { strings: false, wasm: false },
    });
    const bootstrap = new vm.Script(BOOTSTRAP, { filename: 'sandbox-bootstrap.js' }).runInContext(
      context,
    );
    const serialize = bootstrap(
      hostFetch,
      hostTimer,
      hostClearTimer,
      message.contextJson,
      Number(message.maxTimerMs),
    );
    const wrapped = `'use strict';
      const __exports = {};
      (function (exports) {
        ${message.code}
      })(__exports);
      const __handler = __exports[${JSON.stringify(message.handler)}];
      if (typeof __handler !== 'function') {
        throw new Error('Handler ' + ${JSON.stringify(JSON.stringify(message.handler))} + ' is not a function or does not exist');
      }
      Promise.resolve(__handler.apply(undefined, JSON.parse(${JSON.stringify(message.argsJson)})));`;
    const pending = new vm.Script(wrapped, { filename: 'plugin.js' }).runInContext(context, {
      timeout: Number(message.maxCpuTimeMs),
      displayErrors: false,
    });
    const value = await pending;
    send({ type: 'result', ok: true, resultJson: serialize(value), ...metrics() });
  } catch (err) {
    const text = errorText(err);
    send({
      type: 'result',
      ok: false,
      timeout: text.includes('Script execution timed out'),
      error: text,
      ...metrics(),
    });
  }
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'execute') {
    void execute(message);
  } else if (message.type === 'fetch-result') {
    const callback = pendingFetches.get(message.id);
    if (!callback) return;
    pendingFetches.delete(message.id);
    if (message.error) callback(String(message.error), null);
    else callback(null, String(message.responseJson));
  }
});

send({ type: 'ready' });
