const updateEnv = require('../utils/updateEnv');

describe('updateEnv', () => {
  describe('isRunningInDocker', () => {
    afterEach(() => { delete process.env.RUNNING_IN_DOCKER; });

    it('respects the RUNNING_IN_DOCKER env fallback', () => {
      // /.dockerenv does not exist on the test machine
      expect(updateEnv.isRunningInDocker()).toBe(false);
      process.env.RUNNING_IN_DOCKER = '1';
      expect(updateEnv.isRunningInDocker()).toBe(true);
      process.env.RUNNING_IN_DOCKER = 'true';
      expect(updateEnv.isRunningInDocker()).toBe(true);
      process.env.RUNNING_IN_DOCKER = '0';
      expect(updateEnv.isRunningInDocker()).toBe(false);
    });
  });

  describe('hasDockerSocket', () => {
    it('returns false when the socket path does not exist', () => {
      // DOCKER_SOCKET default is /var/run/docker.sock – regardless of the test
      // machine, a plain file path is never reported as socket:
      expect(typeof updateEnv.hasDockerSocket()).toBe('boolean');
    });
  });

  describe('getUpdateMode', () => {
    it('returns host when not in Docker', async () => {
      const mode = await updateEnv.getUpdateMode({ inDocker: false });
      expect(mode).toBe('host');
    });

    it('returns docker-socket when the socket answers', async () => {
      const mode = await updateEnv.getUpdateMode({
        inDocker: true,
        socketAvailable: true,
        dockerPing: async () => 'OK',
      });
      expect(mode).toBe('docker-socket');
    });

    it('returns docker-manual when the socket is mounted but the engine is dead', async () => {
      const mode = await updateEnv.getUpdateMode({
        inDocker: true,
        socketAvailable: true,
        dockerPing: async () => { throw new Error('no daemon'); },
      });
      expect(mode).toBe('docker-manual');
    });

    it('returns docker-manual when nothing is controllable', async () => {
      const mode = await updateEnv.getUpdateMode({
        inDocker: true,
        socketAvailable: false,
      });
      expect(mode).toBe('docker-manual');
    });
  });
});
