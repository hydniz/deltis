const fs = require('fs');
const os = require('os');
const path = require('path');

// Redirect the state file / log dir into a temp dir BEFORE loading the modules.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-state-'));
process.env.UPDATE_STATE_FILE = path.join(tmpDir, 'update-state.json');
process.env.UPDATE_LOG_DIR = path.join(tmpDir, 'update-logs');

const state = require('../utils/updateState');
const ulog = require('../utils/updateLog');

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('updateState', () => {
  afterEach(() => state.clear());

  it('returns phase idle when no file exists', () => {
    expect(state.read()).toEqual({ phase: 'idle' });
  });

  it('persists and merges patches', () => {
    state.write({ phase: 'pulling', toImage: 'x:1' });
    state.write({ phase: 'applying' });
    const st = state.read();
    expect(st.phase).toBe('applying');
    expect(st.toImage).toBe('x:1');        // merged, not replaced
    expect(st.updatedAt).toBeDefined();
  });

  it('reset replaces the whole state', () => {
    state.write({ phase: 'failed', error: 'boom' });
    state.reset({ phase: 'backing-up', mode: 'host' });
    const st = state.read();
    expect(st.phase).toBe('backing-up');
    expect(st.error).toBeUndefined();      // gone after reset
  });

  it('survives a corrupt state file', () => {
    fs.writeFileSync(state.STATE_FILE, '{not json');
    expect(state.read()).toEqual({ phase: 'idle' });
  });
});

describe('updateLog', () => {
  afterEach(() => ulog._reset());

  it('writes timestamped lines into the run file and notifies sinks', () => {
    const received = [];
    ulog.addSink(l => received.push(l));
    const file = ulog.startRun('test');
    ulog.log('hello');
    ulog.log('world');

    expect(received).toEqual(['hello', 'world']);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T[^\]]+\] hello\n/);
    expect(content).toMatch(/world\n/);
  });

  it('attachToFile continues an existing log file', () => {
    const file = ulog.startRun('test');
    ulog.log('first process');
    ulog._reset();

    ulog.attachToFile(file);
    ulog.log('second process');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/first process/);
    expect(content).toMatch(/second process/);
  });

  it('prunes old run logs beyond the retention limit', () => {
    for (let i = 0; i < 12; i++) ulog.startRun(`run${String(i).padStart(2, '0')}`);
    const files = fs.readdirSync(ulog.LOG_DIR).filter(f => f.endsWith('.log'));
    expect(files.length).toBeLessThanOrEqual(10);
  });

  it('a broken sink does not break logging', () => {
    ulog.addSink(() => { throw new Error('broken sink'); });
    expect(() => ulog.log('still works')).not.toThrow();
  });
});
