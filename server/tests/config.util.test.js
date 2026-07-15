// Unit tests for the `expose` policy in utils/config.js – no DB, no HTTP.
// This is the single place that decides what a value may look like on its way
// to the admin UI, so it is tested directly rather than only through the route.
const cfg = require('../utils/config');

afterEach(() => cfg._resetCache());

describe('maskCredentials', () => {
  it('masks user and password but keeps host and database', () => {
    expect(cfg.maskCredentials('mongodb://admin:s3cret@db.local:27017/habit_tracker'))
      .toBe('mongodb://***:***@db.local:27017/habit_tracker');
  });

  it('masks a username even without a password', () => {
    expect(cfg.maskCredentials('mongodb://admin@db.local/habit_tracker'))
      .toBe('mongodb://***:***@db.local/habit_tracker');
  });

  it('leaves a URI without credentials untouched', () => {
    expect(cfg.maskCredentials('mongodb://localhost:27017/habit_tracker'))
      .toBe('mongodb://localhost:27017/habit_tracker');
  });

  it('handles mongodb+srv URIs', () => {
    expect(cfg.maskCredentials('mongodb+srv://u:p@cluster.example.net/db'))
      .toBe('mongodb+srv://***:***@cluster.example.net/db');
  });

  it('does not mistake an @ in the path or query for credentials', () => {
    expect(cfg.maskCredentials('mongodb://localhost:27017/db?user=a@b'))
      .toBe('mongodb://localhost:27017/db?user=a@b');
  });
});

describe('getDisplayValue', () => {
  it('returns a plain value as-is and unmasked', () => {
    const backup = process.env.PORT;
    process.env.PORT = '4123';
    expect(cfg.getDisplayValue('PORT')).toEqual({ value: '4123', masked: false });
    if (backup === undefined) delete process.env.PORT;
    else process.env.PORT = backup;
  });

  it('marks a redacted value as masked so it is never reused as a draft', () => {
    const backup = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://u:p@host/db';
    expect(cfg.getDisplayValue('MONGODB_URI')).toEqual({
      value: 'mongodb://***:***@host/db',
      masked: true,
    });
    if (backup === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = backup;
  });

  it('does not call a URI masked when it had no credentials to mask', () => {
    const backup = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://localhost:27017/habit_tracker';
    expect(cfg.getDisplayValue('MONGODB_URI')).toEqual({
      value: 'mongodb://localhost:27017/habit_tracker',
      masked: false,
    });
    if (backup === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = backup;
  });

  it('withholds a secret value entirely', () => {
    const backup = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'supersecret';
    expect(cfg.getDisplayValue('JWT_SECRET')).toEqual({ value: null, masked: false });
    if (backup === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = backup;
  });

  it('reports an unset key as empty rather than masked', () => {
    const backup = process.env.JWT_SECRET_FILE;
    delete process.env.JWT_SECRET_FILE;
    expect(cfg.getDisplayValue('JWT_SECRET_FILE')).toEqual({ value: null, masked: false });
    if (backup !== undefined) process.env.JWT_SECRET_FILE = backup;
  });

  // Fail closed: a key added without an `expose` flag must not leak its value.
  it('withholds the value of an unknown key', () => {
    expect(cfg.getDisplayValue('DOES_NOT_EXIST')).toEqual({ value: null, masked: false });
  });
});

describe('DEFINITIONS', () => {
  it('declares an expose policy for every key', () => {
    for (const [key, def] of Object.entries(cfg.DEFINITIONS)) {
      expect(['plain', 'credentials', 'never']).toContain(def.expose);
      expect(typeof key).toBe('string');
    }
  });

  it('never exposes the JWT secret or the peppers', () => {
    expect(cfg.DEFINITIONS.JWT_SECRET.expose).toBe('never');
    expect(cfg.DEFINITIONS.PASSWORD_PEPPER.expose).toBe('never');
  });

  it('fixes the main channel to the main branch', () => {
    expect(cfg.MAIN_BRANCH).toBe('main');
    expect(cfg.DEFINITIONS.UPDATE_BRANCH).toBeUndefined();
  });
});
