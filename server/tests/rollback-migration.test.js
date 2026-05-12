describe('rollback migration post-restore recovery', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('clears migration locks and syncs indexes for all registered models', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const syncA = jest.fn().mockResolvedValue(undefined);
    const syncB = jest.fn().mockResolvedValue(undefined);

    jest.doMock('mongoose', () => ({
      models: {
        ActivityLog: { syncIndexes: syncA },
        UserHabitSettings: { syncIndexes: syncB },
      },
    }));
    jest.doMock('../models/MigrationLock', () => ({ deleteMany }));

    const { postRestoreRecovery } = require('../../scripts/rollback-migration');
    await postRestoreRecovery();

    expect(deleteMany).toHaveBeenCalledWith({});
    expect(syncA).toHaveBeenCalledTimes(1);
    expect(syncB).toHaveBeenCalledTimes(1);
  });
});
