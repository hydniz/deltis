const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated state/log location BEFORE loading modules.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-apply-'));
process.env.UPDATE_STATE_FILE = path.join(tmpDir, 'update-state.json');
process.env.UPDATE_LOG_DIR = path.join(tmpDir, 'update-logs');

jest.mock('../utils/dockerClient');
const docker = require('../utils/dockerClient');
const state = require('../utils/updateState');
const { doUpdate, doRollback, buildReplacementConfig, waitHealthy } = require('../updater/applyUpdate');

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// Fixture: a typical inspect payload of the running app container.
function appInspect(overrides = {}) {
  return {
    Id: 'aaaaaaaaaaaabbbbbbbbbbbb',
    Name: '/deltis-app',
    Config: {
      Image: 'hydniz/deltis:1.0.0',
      Env: ['NODE_ENV=production', 'MONGODB_URI=mongodb://mongo:27017/deltis', 'PATH=/usr/bin'],
      Labels: { 'com.docker.compose.service': 'app' },
      ExposedPorts: { '3001/tcp': {} },
    },
    HostConfig: { Binds: ['/host/backups:/app/backups'], RestartPolicy: { Name: 'unless-stopped' } },
    NetworkSettings: { Networks: { deltis_default: { Aliases: ['app', 'aaaaaaaaaaaa'] } } },
    State: { Running: true },
    ...overrides,
  };
}

function healthyInspect() {
  return { State: { Running: true, Health: { Status: 'healthy' } } };
}

function unhealthyInspect() {
  return { State: { Running: true, Health: { Status: 'unhealthy' } } };
}

beforeEach(() => {
  jest.resetAllMocks();
  state.clear();
  // Old image env – used for the runtime-env diff.
  docker.inspectImage.mockResolvedValue({ Config: { Env: ['NODE_ENV=production', 'PATH=/usr/bin'] } });
});

describe('buildReplacementConfig', () => {
  it('keeps only runtime env vars and drops image-baked ones', async () => {
    const cfg = await buildReplacementConfig(appInspect(), 'hydniz/deltis:2.0.0');
    expect(cfg.Image).toBe('hydniz/deltis:2.0.0');
    expect(cfg.Env).toEqual(['MONGODB_URI=mongodb://mongo:27017/deltis']);
    expect(cfg.HostConfig.Binds).toEqual(['/host/backups:/app/backups']);
  });

  it('carries over network aliases minus the old container id', async () => {
    const cfg = await buildReplacementConfig(appInspect(), 'x:2');
    expect(cfg.NetworkingConfig.EndpointsConfig.deltis_default.Aliases).toEqual(['app']);
  });
});

describe('waitHealthy', () => {
  it('returns true as soon as the health check reports healthy', async () => {
    docker.inspectContainer.mockResolvedValue(healthyInspect());
    await expect(waitHealthy('id', 30, 'x')).resolves.toBe(true);
  });

  it('returns false on unhealthy', async () => {
    docker.inspectContainer.mockResolvedValue(unhealthyInspect());
    await expect(waitHealthy('id', 30, 'x')).resolves.toBe(false);
  });

  it('returns false when the container exited', async () => {
    docker.inspectContainer.mockResolvedValue({ State: { Running: false, Status: 'exited', ExitCode: 1 } });
    await expect(waitHealthy('id', 30, 'x')).resolves.toBe(false);
  });

  it('returns false on timeout', async () => {
    docker.inspectContainer.mockResolvedValue(null);
    await expect(waitHealthy('id', 0, 'x')).resolves.toBe(false);
  });
});

describe('doUpdate', () => {
  const spec = { appName: 'deltis-app', newImage: 'hydniz/deltis:2.0.0', healthTimeoutSec: 30 };

  it('swaps the container and records started-new on success', async () => {
    docker.inspectContainer
      .mockResolvedValueOnce(appInspect())                     // inspect app
      .mockRejectedValueOnce(new Error('no such container'))   // -old does not exist
      .mockResolvedValue(healthyInspect());                    // health polling
    docker.createContainer.mockResolvedValue({ Id: 'new123456789' });

    const code = await doUpdate(spec);
    expect(code).toBe(0);

    expect(docker.stopContainer).toHaveBeenCalledWith('aaaaaaaaaaaabbbbbbbbbbbb', 30);
    expect(docker.renameContainer).toHaveBeenCalledWith('aaaaaaaaaaaabbbbbbbbbbbb', 'deltis-app-old');
    expect(docker.createContainer).toHaveBeenCalledWith('deltis-app', expect.objectContaining({
      Image: 'hydniz/deltis:2.0.0',
    }));
    expect(docker.startContainer).toHaveBeenCalledWith('new123456789');

    const st = state.read();
    expect(st.phase).toBe('started-new');
    expect(st.oldContainerName).toBe('deltis-app-old');
  });

  it('automatically restores the old container when the new one is unhealthy', async () => {
    docker.inspectContainer
      .mockResolvedValueOnce(appInspect())                     // inspect app
      .mockRejectedValueOnce(new Error('no such container'))   // -old does not exist
      .mockResolvedValueOnce(unhealthyInspect())               // new container health
      .mockResolvedValue(healthyInspect());                    // old container health after recovery
    docker.createContainer.mockResolvedValue({ Id: 'new123456789' });

    const code = await doUpdate(spec);
    expect(code).toBe(1);

    // Recovery: failed container removed, old renamed back and started.
    expect(docker.removeContainer).toHaveBeenCalledWith('new123456789', true);
    expect(docker.renameContainer).toHaveBeenCalledWith('deltis-app-old', 'deltis-app');
    expect(docker.startContainer).toHaveBeenLastCalledWith('deltis-app');

    const st = state.read();
    expect(st.phase).toBe('failed');
    expect(st.recovered).toBe(true);
    expect(st.error).toMatch(/nicht healthy/);
  });

  it('records recovered=false when the recovery itself fails', async () => {
    docker.inspectContainer
      .mockResolvedValueOnce(appInspect())
      .mockRejectedValueOnce(new Error('no such container'));
    docker.createContainer.mockRejectedValue(new Error('create failed'));
    docker.renameContainer
      .mockResolvedValueOnce(undefined)                        // rename to -old
      .mockRejectedValueOnce(new Error('rename back failed')); // recovery rename

    const code = await doUpdate(spec);
    expect(code).toBe(1);
    const st = state.read();
    expect(st.phase).toBe('failed');
    expect(st.recovered).toBe(false);
  });
});

describe('doRollback', () => {
  const spec = { appName: 'deltis-app', healthTimeoutSec: 30 };

  it('swaps the old container back in', async () => {
    docker.inspectContainer
      .mockResolvedValueOnce({ Id: 'old', Name: '/deltis-app-old' }) // rollback target exists
      .mockRejectedValueOnce(new Error('no such container'))               // -failed does not exist
      .mockResolvedValue(healthyInspect());                                // health polling
    const code = await doRollback(spec);
    expect(code).toBe(0);

    expect(docker.stopContainer).toHaveBeenCalledWith('deltis-app', 30);
    expect(docker.renameContainer).toHaveBeenCalledWith('deltis-app', 'deltis-app-failed');
    expect(docker.renameContainer).toHaveBeenCalledWith('deltis-app-old', 'deltis-app');
    expect(state.read().phase).toBe('rolled-back');
  });

  it('fails loudly when there is no rollback target', async () => {
    docker.inspectContainer.mockRejectedValue(new Error('no such container'));
    await expect(doRollback(spec)).rejects.toThrow(/no such container/);
  });
});
