const fs = require('fs');
const os = require('os');
const path = require('path');

const { runMigrations } = require('../migrations/runner');

function makeMigrationFile(dir, name = '001-initial') {
  fs.writeFileSync(
    path.join(dir, `${name}.js`),
    `module.exports = { name: '${name}', async up() {} };\n`
  );
}

describe('migration runner version guard', () => {
  it('throws when DB version is newer than the highest supported migration version', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltis-mig-guard-'));
    makeMigrationFile(dir, '001-initial');

    try {
      const migrationLean = jest.fn().mockResolvedValue([{ name: '999-future-schema' }]);
      const migrationSelect = jest.fn().mockReturnValue({ lean: migrationLean });
      const migrationFind = jest.fn().mockReturnValue({ select: migrationSelect });
      const lockCreate = jest.fn().mockResolvedValue(undefined);
      const lockDeleteMany = jest.fn().mockResolvedValue(undefined);
      const mongoose = {
        models: {
          Migration: { find: migrationFind },
          MigrationLock: { create: lockCreate, deleteMany: lockDeleteMany },
        },
        connection: { db: {} },
      };

      await expect(runMigrations({ dir, mongoose, exitOnFailure: false }))
        .rejects.toMatchObject({
          code: 'DB_VERSION_TOO_NEW',
          dbVersion: 999,
          maxSupportedVersion: 1,
        });

      expect(lockCreate).toHaveBeenCalledTimes(1);
      expect(lockDeleteMany).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
