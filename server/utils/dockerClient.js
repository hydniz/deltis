// Minimal Docker Engine API client over the unix socket – no dependencies.
//
// Only implements the handful of calls the self-update pipeline needs.
// All functions throw on non-2xx responses with the daemon's error message.
//
// Docs: https://docs.docker.com/engine/api/

const http = require('http');
const os = require('os');
const { DOCKER_SOCKET } = require('./updateEnv');

const DEFAULT_TIMEOUT_MS = 30000;

// Low-level request helper. Returns the parsed JSON body (or raw string when
// the response is not JSON). `onChunk` receives raw body chunks as they
// arrive – used to surface image-pull progress.
function request(method, apiPath, { body, timeoutMs = DEFAULT_TIMEOUT_MS, onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      method,
      path: apiPath,
      headers: {
        Host: 'docker',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString();
        if (onChunk) onChunk(chunk.toString());
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (!raw) return resolve(null);
          try { return resolve(JSON.parse(raw)); } catch { return resolve(raw); }
        }
        let message = raw;
        try { message = JSON.parse(raw).message || raw; } catch { /* keep raw */ }
        reject(new Error(`Docker API ${method} ${apiPath} → ${res.statusCode}: ${String(message).slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Docker API ${method} ${apiPath}: timeout after ${timeoutMs} ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Engine

async function ping() {
  return request('GET', '/_ping', { timeoutMs: 3000 });
}

// Images

// Pulls `ref` (e.g. "hydniz/deltis:1.2.3"). The registry streams JSON progress
// lines; `onProgress(statusLine)` is invoked with de-duplicated status text.
async function pullImage(ref, onProgress) {
  const idx = ref.lastIndexOf(':');
  const fromImage = idx > 0 ? ref.slice(0, idx) : ref;
  const tag = idx > 0 ? ref.slice(idx + 1) : 'latest';

  let lastStatus = '';
  let pullError = null;
  await request('POST', `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`, {
    timeoutMs: 10 * 60 * 1000, // image pulls on a NAS can be slow
    onChunk: (chunk) => {
      // The stream is newline-delimited JSON; a chunk may contain several lines.
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          // Pull errors arrive as stream events with HTTP 200 – capture them.
          if (evt.error) { pullError = evt.error; continue; }
          if (evt.status && evt.status !== lastStatus && onProgress) {
            lastStatus = evt.status;
            onProgress(evt.status);
          }
        } catch { /* partial line across chunks – ignore */ }
      }
    },
  });
  if (pullError) throw new Error(`Image-Pull fehlgeschlagen: ${pullError}`);
  return inspectImage(ref);
}

async function inspectImage(ref) {
  return request('GET', `/images/${encodeURIComponent(ref)}/json`);
}

// Containers

async function inspectContainer(idOrName) {
  return request('GET', `/containers/${encodeURIComponent(idOrName)}/json`);
}

async function createContainer(name, config) {
  return request('POST', `/containers/create?name=${encodeURIComponent(name)}`, { body: config });
}

async function startContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/start`);
}

// `waitSeconds` grace period before SIGKILL.
async function stopContainer(id, waitSeconds = 30) {
  return request('POST', `/containers/${encodeURIComponent(id)}/stop?t=${waitSeconds}`, {
    timeoutMs: (waitSeconds + 15) * 1000,
  });
}

async function renameContainer(id, newName) {
  return request('POST', `/containers/${encodeURIComponent(id)}/rename?name=${encodeURIComponent(newName)}`);
}

async function removeContainer(id, force = false) {
  return request('DELETE', `/containers/${encodeURIComponent(id)}?force=${force}`);
}

async function listContainers(all = true) {
  return request('GET', `/containers/json?all=${all}`);
}

// Inside a container the default hostname is the short container ID.
// HOSTNAME may be overridden in compose – callers should verify via inspect.
function selfContainerId() {
  return process.env.HOSTNAME || os.hostname();
}

module.exports = {
  request,
  ping,
  pullImage,
  inspectImage,
  inspectContainer,
  createContainer,
  startContainer,
  stopContainer,
  renameContainer,
  removeContainer,
  listContainers,
  selfContainerId,
};
