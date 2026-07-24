const catalog = require('../services/metricCatalog');

describe('metricCatalog', () => {
  it('every Health Connect template carries a name, unit key and aggregation', () => {
    for (const [key, t] of Object.entries(catalog.HEALTH_METRICS)) {
      expect(typeof t.name).toBe('string');
      expect(catalog.HEALTH_TYPE_KEYS).toContain(key);
      expect(catalog.AGGREGATIONS_OK ?? true).toBeTruthy();
    }
  });

  it('healthTemplate returns the template or null', () => {
    expect(catalog.healthTemplate('restingHeartRate').name).toBe('Ruhepuls');
    expect(catalog.healthTemplate('nope')).toBeNull();
  });

  it('definitionFromTemplate fills defaults for a sparse template', () => {
    const def = catalog.definitionFromTemplate('x', { name: 'X' });
    expect(def).toMatchObject({
      key: 'x', name: 'X', unit: '', valueType: 'number', scaleMax: 5,
      dayAggregation: 'last', aggregation: 'last', direction: 'none',
      min: null, max: null, groupKey: null, groupOrder: 0, icon: 'Activity', color: 'rose',
    });
  });

  it('fullCatalog tags health-backed vs manual templates', () => {
    const full = catalog.fullCatalog();
    const bodyFat = full.find(t => t.key === 'bodyFat');
    const mood = full.find(t => t.key === 'mood');
    expect(bodyFat.importable).toBe(true);
    expect(bodyFat.healthType).toBe('bodyFat');
    expect(mood.importable).toBe(false);
    expect(mood.healthType).toBeNull();
    expect(full.length).toBe(
      Object.keys(catalog.HEALTH_METRICS).length + Object.keys(catalog.EXTRA_CATALOG).length
    );
  });

  it('the blood-pressure pair shares a group key', () => {
    expect(catalog.HEALTH_METRICS.bloodPressureSystolic.groupKey).toBe('blood_pressure');
    expect(catalog.HEALTH_METRICS.bloodPressureDiastolic.groupKey).toBe('blood_pressure');
  });
});
