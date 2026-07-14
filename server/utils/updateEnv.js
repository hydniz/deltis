// Environment & capability detection for the OTA update pipeline.
//
// Answers two questions:
//   1. Are we running inside a Docker container?
//   2. What is the best available update mechanism ("mode")?
//
// Modes (in detection order):
//   'docker-socket' – in Docker, /var/run/docker.sock is mounted and the
//                     Docker Engine answers → full self-update via Docker API
//   'docker-manual' – in Docker without any control over the engine →
//                     the UI shows manual update instructions
//   'host'          – not in Docker → git-based self-update on the host

const fs = require('fs');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

// /.dockerenv is created by the Docker runtime inside every container.
// RUNNING_IN_DOCKER can be set explicitly in docker-compose as a fallback.
function isRunningInDocker() {
  try { fs.accessSync('/.dockerenv'); return true; } catch { /* not present */ }
  return process.env.RUNNING_IN_DOCKER === '1' || process.env.RUNNING_IN_DOCKER === 'true';
}

// True when the Docker socket exists and is an actual unix socket we may open.
function hasDockerSocket() {
  try {
    const stat = fs.statSync(DOCKER_SOCKET);
    if (!stat.isSocket()) return false;
    fs.accessSync(DOCKER_SOCKET, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Determines the effective update mode. `deps` is injectable for tests.
async function getUpdateMode(deps = {}) {
  const {
    inDocker = isRunningInDocker(),
    socketAvailable = hasDockerSocket(),
    dockerPing = () => require('./dockerClient').ping(),
  } = deps;

  if (!inDocker) return 'host';

  if (socketAvailable) {
    try {
      await dockerPing();
      return 'docker-socket';
    } catch { /* socket mounted but engine not answering – fall through */ }
  }

  return 'docker-manual';
}

module.exports = {
  DOCKER_SOCKET,
  isRunningInDocker,
  hasDockerSocket,
  getUpdateMode,
};
