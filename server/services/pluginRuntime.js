// Plugin container lifecycle: each installed plugin runs as its own Docker
// container on an isolated bridge network (`deltis-plugins-net`), with no
// host mounts, no privileged mode and no access to the Docker socket. It can
// only reach the Plugin Host API (routes/pluginHostApi.js) — served by this
// same app process — which enforces the plugin's granted capabilities on
// every request (middleware/pluginAuth.js).
//
// Known limitation: outbound network egress to the third-party hosts a
// plugin declared via `network:<domain>` capabilities is recorded and shown
// to the user at consent time, but is not yet firewalled at the Docker
// network layer — see docs/plugins/MANIFEST.md "Known limitations" for the
// egress-allowlisting hardening still required before this is safe to run
// untrusted community plugins in production.
const crypto = require('crypto');
const docker = require('../utils/dockerClient');

const NETWORK_NAME = process.env.PLUGIN_DOCKER_NETWORK || 'deltis-plugins-net';
const APP_NETWORK_ALIAS = 'deltis-app';
const CONTAINER_PREFIX = 'deltis-plugin-';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function containerName(pluginId) {
  return `${CONTAINER_PREFIX}${pluginId}`;
}

// Creates the plugin network if it doesn't exist yet, and makes sure this
// app container itself is attached to it (reachable by plugins as
// "deltis-app") — without joining plugin containers to the app's own
// default network, where MongoDB lives.
async function ensureNetwork() {
  try {
    await docker.inspectNetwork(NETWORK_NAME);
  } catch {
    await docker.createNetwork(NETWORK_NAME, { internal: false });
  }
  try {
    await docker.connectNetwork(NETWORK_NAME, docker.selfContainerId(), [APP_NETWORK_ALIAS]);
  } catch (err) {
    if (!/already exists|already attached|already connected/i.test(err.message || '')) throw err;
  }
}

// Provisions and starts a plugin's container. Returns the raw bearer token —
// callers must hash it (hashToken) before persisting and must never store
// or log the raw value.
async function provision({ pluginId, manifest, hostApiPort }) {
  await ensureNetwork();
  const token = generateToken();
  const name = containerName(pluginId);

  // A pull failure here isn't fatal — the image may already be present
  // locally (development) — createContainer will fail clearly if it's truly
  // unavailable.
  await docker.pullImage(manifest.runtime.image).catch(() => {});

  const created = await docker.createContainer(name, {
    Image: manifest.runtime.image,
    Env: [
      `PLUGIN_ID=${pluginId}`,
      `PLUGIN_TOKEN=${token}`,
      `PLUGIN_HOST_API_URL=http://${APP_NETWORK_ALIAS}:${hostApiPort}/api/plugin-host/v1`,
    ],
    HostConfig: {
      NetworkMode: NETWORK_NAME,
      Binds: [],
      Privileged: false,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });
  await docker.startContainer(created.Id);

  return { token, tokenHash: hashToken(token), containerId: created.Id, containerName: name };
}

async function stop(containerIdOrName) {
  await docker.stopContainer(containerIdOrName);
}

async function start(containerIdOrName) {
  await docker.startContainer(containerIdOrName);
}

async function remove(containerIdOrName) {
  await docker.stopContainer(containerIdOrName).catch(() => {});
  await docker.removeContainer(containerIdOrName, true);
}

module.exports = {
  NETWORK_NAME,
  generateToken,
  hashToken,
  containerName,
  ensureNetwork,
  provision,
  stop,
  start,
  remove,
};
