const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Point the client at a fake Docker daemon on a temp unix socket BEFORE load.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-docker-'));
const SOCKET = path.join(tmpDir, 'docker.sock');
process.env.DOCKER_SOCKET = SOCKET;

const docker = require('../utils/dockerClient');

// Minimal fake Docker Engine.
let server;
const seen = [];

beforeAll((done) => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });

      if (req.url === '/_ping') { res.writeHead(200); return res.end('OK'); }

      if (req.url.startsWith('/images/create')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ status: 'Pulling from test/image' }) + '\n');
        res.write(JSON.stringify({ status: 'Downloading' }) + '\n');
        if (req.url.includes('tag=broken')) {
          res.write(JSON.stringify({ error: 'manifest unknown' }) + '\n');
        }
        return res.end();
      }

      if (req.url.startsWith('/images/') && req.url.endsWith('/json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ Id: 'sha256:abc', Config: { Env: ['NODE_ENV=production'] } }));
      }

      if (req.url === '/containers/app/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ Id: 'c0ffee', Name: '/app' }));
      }

      if (req.url === '/containers/missing/json') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'No such container: missing' }));
      }

      if (req.url.startsWith('/containers/create')) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ Id: 'newc0ffee' }));
      }

      // start / stop / rename / remove → 204 empty
      res.writeHead(204);
      res.end();
    });
  });
  server.listen(SOCKET, done);
});

afterAll((done) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    done();
  });
});

describe('dockerClient', () => {
  it('pings the daemon', async () => {
    await expect(docker.ping()).resolves.toBe('OK');
  });

  it('inspects a container', async () => {
    const c = await docker.inspectContainer('app');
    expect(c.Name).toBe('/app');
  });

  it('throws with the daemon message on 404', async () => {
    await expect(docker.inspectContainer('missing'))
      .rejects.toThrow(/No such container/);
  });

  it('pulls an image and reports de-duplicated progress', async () => {
    const progress = [];
    const img = await docker.pullImage('test/image:1.0', s => progress.push(s));
    expect(progress).toEqual(['Pulling from test/image', 'Downloading']);
    expect(img.Id).toBe('sha256:abc');
  });

  it('surfaces in-stream pull errors as exceptions', async () => {
    await expect(docker.pullImage('test/image:broken'))
      .rejects.toThrow(/manifest unknown/);
  });

  it('creates, starts, stops, renames and removes containers', async () => {
    const created = await docker.createContainer('helper', { Image: 'x' });
    expect(created.Id).toBe('newc0ffee');
    await docker.startContainer('newc0ffee');
    await docker.stopContainer('newc0ffee', 5);
    await docker.renameContainer('newc0ffee', 'helper-old');
    await docker.removeContainer('newc0ffee', true);

    const urls = seen.map(s => `${s.method} ${s.url}`);
    expect(urls).toContain('POST /containers/create?name=helper');
    expect(urls).toContain('POST /containers/newc0ffee/start');
    expect(urls).toContain('POST /containers/newc0ffee/stop?t=5');
    expect(urls).toContain('POST /containers/newc0ffee/rename?name=helper-old');
    expect(urls).toContain('DELETE /containers/newc0ffee?force=true');
  });

  it('selfContainerId falls back to the hostname', () => {
    expect(typeof docker.selfContainerId()).toBe('string');
    expect(docker.selfContainerId().length).toBeGreaterThan(0);
  });
});
