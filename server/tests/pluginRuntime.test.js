const crypto = require('crypto');

jest.mock('../utils/dockerClient');
const docker = require('../utils/dockerClient');
const pluginRuntime = require('../services/pluginRuntime');

beforeEach(() => {
  jest.resetAllMocks();
  docker.selfContainerId.mockReturnValue('self-container-id');
});

describe('generateToken / hashToken', () => {
  it('generates a 64-char hex token and hashes it deterministically', () => {
    const token = pluginRuntime.generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const expected = crypto.createHash('sha256').update(token).digest('hex');
    expect(pluginRuntime.hashToken(token)).toBe(expected);
  });

  it('produces different tokens on each call', () => {
    expect(pluginRuntime.generateToken()).not.toBe(pluginRuntime.generateToken());
  });
});

describe('ensureNetwork', () => {
  it('creates the network only if it does not already exist, then connects self', async () => {
    docker.inspectNetwork.mockRejectedValue(new Error('not found'));
    docker.createNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockResolvedValue(null);

    await pluginRuntime.ensureNetwork();

    expect(docker.createNetwork).toHaveBeenCalledWith(pluginRuntime.NETWORK_NAME, { internal: false });
    expect(docker.connectNetwork).toHaveBeenCalledWith(pluginRuntime.NETWORK_NAME, 'self-container-id', ['deltis-app']);
  });

  it('skips creation when the network already exists', async () => {
    docker.inspectNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockResolvedValue(null);

    await pluginRuntime.ensureNetwork();

    expect(docker.createNetwork).not.toHaveBeenCalled();
    expect(docker.connectNetwork).toHaveBeenCalled();
  });

  it('swallows an "already connected" error from connectNetwork', async () => {
    docker.inspectNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockRejectedValue(new Error('endpoint already exists in network'));

    await expect(pluginRuntime.ensureNetwork()).resolves.toBeUndefined();
  });

  it('rethrows an unrelated connectNetwork error', async () => {
    docker.inspectNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockRejectedValue(new Error('daemon exploded'));

    await expect(pluginRuntime.ensureNetwork()).rejects.toThrow('daemon exploded');
  });

  it('rethrows a connectNetwork error with no message at all', async () => {
    docker.inspectNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockRejectedValue(new Error());

    await expect(pluginRuntime.ensureNetwork()).rejects.toThrow();
  });
});

describe('provision', () => {
  const manifest = { runtime: { type: 'docker', image: 'ghcr.io/hydniz/deltis-strava-integration:1.0.0' } };

  beforeEach(() => {
    docker.inspectNetwork.mockResolvedValue({ Id: 'net1' });
    docker.connectNetwork.mockResolvedValue(null);
    docker.pullImage.mockResolvedValue({ Id: 'sha256:abc' });
    docker.createContainer.mockResolvedValue({ Id: 'container123' });
    docker.startContainer.mockResolvedValue(null);
  });

  it('provisions and starts a container with the plugin env wired up', async () => {
    const result = await pluginRuntime.provision({ pluginId: 'strava-integration', manifest, hostApiPort: 3001 });

    expect(docker.createContainer).toHaveBeenCalledWith(
      'deltis-plugin-strava-integration',
      expect.objectContaining({
        Image: manifest.runtime.image,
        Env: expect.arrayContaining([
          'PLUGIN_ID=strava-integration',
          'PLUGIN_HOST_API_URL=http://deltis-app:3001/api/plugin-host/v1',
        ]),
        HostConfig: expect.objectContaining({
          NetworkMode: pluginRuntime.NETWORK_NAME,
          Binds: [],
          Privileged: false,
        }),
      })
    );
    expect(docker.startContainer).toHaveBeenCalledWith('container123');
    expect(result.containerId).toBe('container123');
    expect(result.containerName).toBe('deltis-plugin-strava-integration');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.tokenHash).toBe(pluginRuntime.hashToken(result.token));
  });

  it('does not fail provisioning when the image pull fails (image may already be local)', async () => {
    docker.pullImage.mockRejectedValue(new Error('registry unreachable'));
    await expect(pluginRuntime.provision({ pluginId: 'x', manifest, hostApiPort: 3001 })).resolves.toBeDefined();
  });

  it('propagates a container creation failure', async () => {
    docker.createContainer.mockRejectedValue(new Error('image not found'));
    await expect(pluginRuntime.provision({ pluginId: 'x', manifest, hostApiPort: 3001 })).rejects.toThrow('image not found');
  });
});

describe('start / stop / remove', () => {
  it('start delegates to docker.startContainer', async () => {
    docker.startContainer.mockResolvedValue(null);
    await pluginRuntime.start('c1');
    expect(docker.startContainer).toHaveBeenCalledWith('c1');
  });

  it('stop delegates to docker.stopContainer', async () => {
    docker.stopContainer.mockResolvedValue(null);
    await pluginRuntime.stop('c1');
    expect(docker.stopContainer).toHaveBeenCalledWith('c1');
  });

  it('remove stops (best-effort) then force-removes the container', async () => {
    docker.stopContainer.mockRejectedValue(new Error('already stopped'));
    docker.removeContainer.mockResolvedValue(null);

    await pluginRuntime.remove('c1');

    expect(docker.stopContainer).toHaveBeenCalledWith('c1');
    expect(docker.removeContainer).toHaveBeenCalledWith('c1', true);
  });

  it('remove still throws if removeContainer itself fails', async () => {
    docker.stopContainer.mockResolvedValue(null);
    docker.removeContainer.mockRejectedValue(new Error('container busy'));
    await expect(pluginRuntime.remove('c1')).rejects.toThrow('container busy');
  });
});
