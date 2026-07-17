const { findRansomMarkers, warnIfDatabaseCompromised } = require('../utils/securityCheck');

describe('findRansomMarkers', () => {
  it('detects common ransom marker database names', () => {
    expect(findRansomMarkers(['deltis', 'READ_ME_TO_RECOVER_YOUR_DATA'])).toEqual(['READ_ME_TO_RECOVER_YOUR_DATA']);
    expect(findRansomMarkers(['READ__ME', 'deltis'])).toEqual(['READ__ME']);
    expect(findRansomMarkers(['PLEASE_READ_ME_XYZ'])).toEqual(['PLEASE_READ_ME_XYZ']);
    expect(findRansomMarkers(['HOW_TO_RESTORE_YOUR_DATA'])).toEqual(['HOW_TO_RESTORE_YOUR_DATA']);
    expect(findRansomMarkers(['RANSOM_NOTE'])).toEqual(['RANSOM_NOTE']);
    expect(findRansomMarkers(['WARNING'])).toEqual(['WARNING']);
  });

  it('ignores normal and system databases', () => {
    expect(findRansomMarkers(['deltis', 'habit_tracker'])).toEqual([]);
    // System DBs never count, even though "admin"/"config" are unusual matches
    expect(findRansomMarkers(['admin', 'config', 'local'])).toEqual([]);
  });

  it('tolerates empty and malformed input', () => {
    expect(findRansomMarkers([])).toEqual([]);
    expect(findRansomMarkers(undefined)).toEqual([]);
    expect(findRansomMarkers([null, 42, 'deltis'])).toEqual([]);
  });
});

describe('warnIfDatabaseCompromised', () => {
  const fakeConnection = (dbNames) => ({
    db: {
      admin: () => ({
        listDatabases: async () => ({ databases: dbNames.map(name => ({ name })) }),
      }),
    },
  });

  it('logs an alert and returns the markers when compromised', async () => {
    const errors = [];
    const log = { error: (msg = '') => errors.push(String(msg)) };
    const markers = await warnIfDatabaseCompromised(
      fakeConnection(['READ_ME_TO_RECOVER_YOUR_DATA', 'admin', 'config']),
      log
    );
    expect(markers).toEqual(['READ_ME_TO_RECOVER_YOUR_DATA']);
    const output = errors.join('\n');
    expect(output).toContain('SECURITY ALERT');
    expect(output).toContain('READ_ME_TO_RECOVER_YOUR_DATA');
    expect(output).toContain('restore');
  });

  it('stays silent on a clean server', async () => {
    const errors = [];
    const log = { error: (msg = '') => errors.push(String(msg)) };
    const markers = await warnIfDatabaseCompromised(fakeConnection(['deltis', 'admin']), log);
    expect(markers).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('returns an empty list when listDatabases is not permitted', async () => {
    const connection = {
      db: { admin: () => ({ listDatabases: async () => { throw new Error('unauthorized'); } }) },
    };
    expect(await warnIfDatabaseCompromised(connection, { error: () => {} })).toEqual([]);
  });
});
