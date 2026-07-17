const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const User = require('../models/User');
const WeightLog = require('../models/WeightLog');
const HabitLog = require('../models/HabitLog');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');
const ActivityPlan = require('../models/ActivityPlan');
const HabitPlan = require('../models/HabitPlan');
const Goal = require('../models/Goal');
const TrainingType = require('../models/TrainingType');
const TrainingPlan = require('../models/TrainingPlan');
const StravaActivity = require('../models/StravaActivity');
const UserHabitSettings = require('../models/UserHabitSettings');
const AdmZip = require('adm-zip');

// Downloads the export of the given user and returns it as an AdmZip instance.
async function downloadExport(app, token) {
  const res = await request(app)
    .get('/api/data/export')
    .set(authHeader(token))
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  return new AdmZip(res.body);
}

function readJson(zip, name) {
  const entry = zip.getEntry(name);
  expect(entry).not.toBeNull();
  return JSON.parse(entry.getData().toString('utf8'));
}

let app;

beforeAll(async () => {
  await startDb();
  app = buildApp();
});

afterEach(async () => {
  await clearDb();
});

afterAll(async () => {
  await stopDb();
});

// ─CSV helpers (unit tests – extracted inline)

function csvRow(values) {
  return values.map(v => {
    const s = v == null ? '' : String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }).join(',');
}

function parseRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseRow(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = values[i] ?? ''; });
    return obj;
  });
}

describe('CSV helper: csvRow', () => {
  it('joins values with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('wraps fields containing commas in double quotes', () => {
    expect(csvRow(['hello,world'])).toBe('"hello,world"');
  });

  it('escapes double quotes inside fields', () => {
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""');
  });

  it('handles null and undefined as empty string', () => {
    expect(csvRow([null, undefined, 0])).toBe(',,0');
  });
});

describe('CSV helper: parseCsv / parseRow', () => {
  it('parses a simple CSV string', () => {
    const result = parseCsv('date,weight,unit\n2024-01-01,80,kg\n2024-01-02,79,kg');
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ date: '2024-01-01', weight: '80', unit: 'kg' });
  });

  it('returns empty array for single-line input (headers only)', () => {
    expect(parseCsv('date,value')).toEqual([]);
  });

  it('handles quoted fields with commas', () => {
    const result = parseCsv('name,note\n"Smith, John","hello world"');
    expect(result[0].name).toBe('Smith, John');
    expect(result[0].note).toBe('hello world');
  });

  it('handles escaped quotes inside fields', () => {
    const result = parseCsv('note\n"say ""hi"""');
    expect(result[0].note).toBe('say "hi"');
  });
});

// ─Export / Import integration tests

describe('GET /api/data/export', () => {
  it('returns a ZIP file', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .get('/api/data/export')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/zip/);
  });

  it('includes weight.csv in the ZIP', async () => {
    const { token, user } = await createUser();
    await WeightLog.create({ userId: user._id, date: new Date('2024-01-01'), weight: 80, unit: 'kg' });

    const res = await request(app)
      .get('/api/data/export')
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const zip = new AdmZip(res.body);
    const entry = zip.getEntry('weight.csv');
    expect(entry).not.toBeNull();
    const content = entry.getData().toString('utf8');
    expect(content).toContain('2024-01-01');
    expect(content).toContain('80');
  });

  it('includes habits.csv in the ZIP', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Water', unitSymbol: 'ml', type: 'amount', version: 1, nameHistory: [] });
    await HabitLog.create({ userId: user._id, habitId: habit._id, date: new Date('2024-01-05'), value: 2000 });

    const res = await request(app)
      .get('/api/data/export')
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const zip = new AdmZip(res.body);
    const entry = zip.getEntry('habits.csv');
    expect(entry).not.toBeNull();
    const content = entry.getData().toString('utf8');
    expect(content).toContain('Water');
    expect(content).toContain('2000');
  });

  it('does not include another user\'s data in the export', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    await WeightLog.create({ userId: other._id, date: new Date('2024-01-01'), weight: 60, unit: 'kg' });

    const res = await request(app)
      .get('/api/data/export')
      .set(authHeader(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const zip = new AdmZip(res.body);
    const content = zip.getEntry('weight.csv').getData().toString('utf8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBe(1); // header only
  });
});

describe('POST /api/data/import', () => {
  it('rejects requests with no file', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('rejects non-ZIP files with an error response', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', Buffer.from('not a zip'), { filename: 'data.txt', contentType: 'text/plain' });
    // multer's fileFilter calls cb(new Error(...)) which Express forwards as 500
    expect([400, 500]).toContain(res.status);
  });

  it('imports weight data from a ZIP', async () => {
    const { token, user } = await createUser();

    const weightCsv = 'date,weight,unit\n2024-01-10,77,kg\n2024-01-11,76.5,kg';
    const zip = new AdmZip();
    zip.addFile('weight.csv', Buffer.from(weightCsv, 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(res.body.weight).toBe(2);

    const logs = await WeightLog.find({ userId: user._id });
    expect(logs.length).toBe(2);
  });

  it('imports habit data from a ZIP and creates missing habit definitions', async () => {
    const { token, user } = await createUser();

    const habitCsv = 'date,habit_name,unit,value\n2024-01-10,Meditation,min,20';
    const zip = new AdmZip();
    zip.addFile('habits.csv', Buffer.from(habitCsv, 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(res.body.habits).toBe(1);

    const habitDef = await HabitDefinition.findOne({ userId: user._id, name: 'Meditation' });
    expect(habitDef).not.toBeNull();
  });

  it('skips rows with invalid dates', async () => {
    const { token } = await createUser();

    const weightCsv = 'date,weight,unit\ninvalid-date,80,kg';
    const zip = new AdmZip();
    zip.addFile('weight.csv', Buffer.from(weightCsv, 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(res.body.weight).toBe(0);
  });
});

// ─Portable export format (format 2)

const VALID_CRITERIA = {
  strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] }
};

describe('GET /api/data/export — portable format', () => {
  it('includes a manifest identifying the archive', async () => {
    const { token } = await createUser();
    const zip = await downloadExport(app, token);
    const manifest = readJson(zip, 'manifest.json');
    expect(manifest.app).toBe('deltis');
    expect(manifest.format).toBe(2);
    expect(typeof manifest.appVersion).toBe('string');
    expect(typeof manifest.apiVersion).toBe('number');
  });

  it('exports own habit definitions but not predefined ones', async () => {
    const { token, user } = await createUser();
    await HabitDefinition.create({ userId: user._id, name: 'Lesen', unitSymbol: 'min', type: 'duration' });
    await HabitDefinition.create({ userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount', isPredefined: true });

    const zip = await downloadExport(app, token);
    const defs = readJson(zip, 'habit_definitions.json');
    expect(defs).toEqual([{ name: 'Lesen', unitSymbol: 'min', type: 'duration' }]);
  });

  it('exports activity types with their custom fields', async () => {
    const { token, user } = await createUser();
    await ActivityType.create({
      userId: user._id, label: 'Klettern', showDistance: false, showDuration: true,
      customFields: [{ key: 'grade', label: 'Grad', type: 'select', options: ['5a', '6a'] }]
    });

    const zip = await downloadExport(app, token);
    const types = readJson(zip, 'activity_types.json');
    expect(types.length).toBe(1);
    expect(types[0].label).toBe('Klettern');
    expect(types[0].showDistance).toBe(false);
    expect(types[0].customFields[0]).toMatchObject({ key: 'grade', label: 'Grad', type: 'select' });
  });

  it('exports training types with criteria', async () => {
    const { token, user } = await createUser();
    await TrainingType.create({ userId: user._id, name: 'Zone 2', description: 'locker', criteria: VALID_CRITERIA });

    const zip = await downloadExport(app, token);
    const types = readJson(zip, 'training_types.json');
    expect(types).toEqual([{ name: 'Zone 2', description: 'locker', criteria: VALID_CRITERIA }]);
  });

  it('exports goals with name-based references instead of ObjectIds', async () => {
    const { token, user } = await createUser();
    const tt = await TrainingType.create({ userId: user._id, name: 'Zone 2', criteria: VALID_CRITERIA });
    const meta = await Goal.create({
      userId: user._id, name: 'Fitness', type: 'meta',
      targetRef: 'meta', targetRefModel: 'Goal', condition: 'min', targetValue: 1
    });
    await Goal.create({
      userId: user._id, name: 'Z2 Läufe', type: 'periodic-strava',
      targetRef: 'strava', targetRefModel: 'StravaActivity',
      condition: 'min', targetValue: 3,
      trainingTypeId: tt._id, parentGoalId: meta._id
    });

    const zip = await downloadExport(app, token);
    const goals = readJson(zip, 'goals.json');
    const child = goals.find(g => g.name === 'Z2 Läufe');
    expect(child.trainingTypeName).toBe('Zone 2');
    expect(child.parentGoalName).toBe('Fitness');
    expect(child.trainingTypeId).toBeUndefined();
    expect(child.parentGoalId).toBeUndefined();
    expect(child._id).toBeUndefined();
    expect(child.userId).toBeUndefined();
    expect(child.targetRef).toBeUndefined();
    expect(child.targetRefName).toBe('strava');
  });

  it('exports training plans and strava activities', async () => {
    const { token, user } = await createUser();
    const tt = await TrainingType.create({ userId: user._id, name: 'Zone 2', criteria: VALID_CRITERIA });
    await TrainingPlan.create({ userId: user._id, trainingTypeId: tt._id, scheduledDate: new Date('2024-04-01'), notes: 'locker' });
    await StravaActivity.create({
      userId: user._id, stravaId: 42, startDate: new Date('2024-04-01T09:00:00Z'),
      sportType: 'Run', movingTime: 3600, distance: 10000, detail: { foo: 'bar' }
    });

    const zip = await downloadExport(app, token);
    const plans = readJson(zip, 'training_plans.json');
    expect(plans).toEqual([{ date: '2024-04-01', training_type: 'Zone 2', criteria: null, notes: 'locker' }]);

    const acts = readJson(zip, 'strava_activities.json');
    expect(acts.length).toBe(1);
    expect(acts[0].stravaId).toBe(42);
    expect(acts[0].detail).toEqual({ foo: 'bar' });
    expect(acts[0]._id).toBeUndefined();
    expect(acts[0].userId).toBeUndefined();
  });

  it('exports hidden habits and hasSelection in settings.json', async () => {
    const { token, user } = await createUser();
    const own = await HabitDefinition.create({ userId: user._id, name: 'Lesen', unitSymbol: 'min', type: 'duration' });
    const predefined = await HabitDefinition.create({ userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount', isPredefined: true });
    await UserHabitSettings.create({
      userId: user._id,
      selectedHabitIds: [own._id],
      hiddenHabitIds: [predefined._id],
      hasSelection: true,
      habitSettings: { [own._id.toString()]: { dailyTarget: 30 } }
    });

    const zip = await downloadExport(app, token);
    const settings = readJson(zip, 'settings.json');
    expect(settings.selectedHabits).toEqual(['Lesen']);
    expect(settings.hiddenHabits).toEqual(['Wasser']);
    expect(settings.hasSelection).toBe(true);
    expect(settings.habitSettings).toEqual({ Lesen: { dailyTarget: 30 } });
  });

  it('exports the current label for activity logs recorded before a rename', async () => {
    const { token, user } = await createUser();
    const type = await ActivityType.create({ userId: user._id, label: 'Radfahren', version: 2 });
    await ActivityLog.create({
      userId: user._id, activityType: 'Cycling', activityTypeRef: type._id,
      activityTypeVersion: 1, date: new Date('2024-02-01'), duration: 45
    });

    const zip = await downloadExport(app, token);
    const content = zip.getEntry('activities.csv').getData().toString('utf8');
    expect(content).toContain('Radfahren');
    expect(content).not.toContain('Cycling');
  });
});

describe('POST /api/data/import — manifest validation', () => {
  it('rejects archives that are not a Deltis export', async () => {
    const { token } = await createUser();
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'other-app', format: 1 }), 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kein Deltis-Export/i);
  });

  it('rejects archives from a newer export format', async () => {
    const { token } = await createUser();
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'deltis', format: 99 }), 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/neueren Deltis-Version/i);
  });

  it('still imports legacy archives without a manifest', async () => {
    const { token, user } = await createUser();
    const zip = new AdmZip();
    zip.addFile('weight.csv', Buffer.from('date,weight,unit\n2024-01-10,77,kg', 'utf8'));

    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(token))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(res.body.weight).toBe(1);
    expect(await WeightLog.countDocuments({ userId: user._id })).toBe(1);
  });
});

// ─Full round-trip: export from user A, import as user B (instance switch)

describe('export → import round-trip (user/instance switch)', () => {
  async function seedFullDataset(user) {
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Lesen', unitSymbol: 'min', type: 'duration' });
    const predefined = await HabitDefinition.create({ userId: null, name: 'Wasser', unitSymbol: 'ml', type: 'amount', isPredefined: true });
    await HabitLog.create({ userId: user._id, habitId: habit._id, habitVersion: 1, date: new Date('2024-03-01'), value: 30 });

    const actType = await ActivityType.create({
      userId: user._id, label: 'Klettern', showDistance: false, showDuration: true,
      customFields: [{ key: 'grade', label: 'Grad', type: 'select', options: ['5a', '6a'] }]
    });
    await ActivityLog.create({
      userId: user._id, activityType: 'Klettern', activityTypeRef: actType._id, activityTypeVersion: 1,
      date: new Date('2024-03-10'), duration: 60, notes: 'Halle, Boulder', customValues: { grade: '6a' }
    });

    await WeightLog.create({ userId: user._id, date: new Date('2024-03-01'), weight: 80, unit: 'kg' });

    await ActivityPlan.create({
      userId: user._id, activityType: 'Klettern', activityTypeRef: actType._id,
      scheduledDate: new Date('2024-03-15'), duration: 90, completed: true
    });
    await HabitPlan.create({
      userId: user._id, habitId: habit._id, habitName: 'Lesen', unitSymbol: 'min',
      scheduledDate: new Date('2024-03-15'), completed: true, loggedValue: 25
    });

    const tt = await TrainingType.create({ userId: user._id, name: 'Zone 2', description: 'locker', criteria: VALID_CRITERIA });
    await TrainingPlan.create({ userId: user._id, trainingTypeId: tt._id, scheduledDate: new Date('2024-03-18'), notes: 'ruhig' });
    await TrainingPlan.create({ userId: user._id, criteria: VALID_CRITERIA, scheduledDate: new Date('2024-03-19'), notes: 'ad-hoc' });

    await StravaActivity.create({
      userId: user._id, stravaId: 4711, startDate: new Date('2024-03-18T08:00:00Z'),
      sportType: 'Run', movingTime: 3600, distance: 10000, detail: { foo: 'bar' }
    });

    const meta = await Goal.create({
      userId: user._id, name: 'Fitness', type: 'meta',
      targetRef: 'meta', targetRefModel: 'Goal', condition: 'min', targetValue: 1
    });
    await Goal.create({
      userId: user._id, name: 'Z2 Läufe', type: 'periodic-strava',
      targetRef: 'strava', targetRefModel: 'StravaActivity',
      condition: 'min', targetValue: 3,
      trainingTypeId: tt._id, parentGoalId: meta._id
    });
    await Goal.create({
      userId: user._id, name: 'Kletter-Ziel', type: 'periodic-activity',
      targetRef: actType._id, targetRefModel: 'ActivityType',
      condition: 'min', targetValue: 2, metric: 'count'
    });

    await UserHabitSettings.create({
      userId: user._id,
      selectedHabitIds: [habit._id],
      hiddenHabitIds: [predefined._id],
      hasSelection: true,
      habitSettings: { [habit._id.toString()]: { dailyTarget: 30 } }
    });
    await User.findByIdAndUpdate(user._id, { $set: { weightUnit: 'lbs' } });
  }

  it('restores the complete dataset for a different user', async () => {
    const { token: tokenA, user: userA } = await createUser({ name: 'A' });
    await seedFullDataset(userA);

    const zip = await downloadExport(app, tokenA);

    const { token: tokenB, user: userB } = await createUser({ name: 'B' });
    const res = await request(app)
      .post('/api/data/import')
      .set(authHeader(tokenB))
      .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body).toMatchObject({
      weight: 1, habits: 1, activities: 1, plans: 4, goals: 3,
      habitDefinitions: 1, activityTypes: 1, trainingTypes: 1, stravaActivities: 1,
      settings: true
    });

    // Definitions restored with full fidelity
    const habitB = await HabitDefinition.findOne({ userId: userB._id, name: 'Lesen' });
    expect(habitB).toMatchObject({ unitSymbol: 'min', type: 'duration' });

    const actTypeB = await ActivityType.findOne({ userId: userB._id, label: 'Klettern' });
    expect(actTypeB.showDistance).toBe(false);
    expect(actTypeB.customFields[0]).toMatchObject({ key: 'grade', label: 'Grad', type: 'select' });
    expect(actTypeB.customFields[0].options).toEqual(['5a', '6a']);

    const ttB = await TrainingType.findOne({ userId: userB._id, name: 'Zone 2' });
    expect(ttB.description).toBe('locker');
    expect(ttB.criteria).toEqual(VALID_CRITERIA);

    // Logs restored and linked to the NEW definitions
    const habitLog = await HabitLog.findOne({ userId: userB._id });
    expect(habitLog.habitId.toString()).toBe(habitB._id.toString());
    expect(habitLog.value).toBe(30);

    const actLog = await ActivityLog.findOne({ userId: userB._id });
    expect(actLog.activityTypeRef.toString()).toBe(actTypeB._id.toString());
    expect(actLog.notes).toBe('Halle, Boulder');
    expect(actLog.customValues).toEqual({ grade: '6a' });

    // Plans
    expect(await ActivityPlan.countDocuments({ userId: userB._id })).toBe(1);
    expect(await HabitPlan.countDocuments({ userId: userB._id })).toBe(1);
    const trainingPlansB = await TrainingPlan.find({ userId: userB._id }).sort({ scheduledDate: 1 });
    expect(trainingPlansB.length).toBe(2);
    expect(trainingPlansB[0].trainingTypeId.toString()).toBe(ttB._id.toString());
    expect(trainingPlansB[1].trainingTypeId).toBeNull();
    expect(trainingPlansB[1].criteria).toEqual(VALID_CRITERIA);

    // Strava activities incl. raw payloads
    const stravaB = await StravaActivity.findOne({ userId: userB._id });
    expect(stravaB.stravaId).toBe(4711);
    expect(stravaB.detail).toEqual({ foo: 'bar' });

    // Goals: hierarchy and training type re-linked to the NEW documents
    const metaB = await Goal.findOne({ userId: userB._id, name: 'Fitness' });
    const childB = await Goal.findOne({ userId: userB._id, name: 'Z2 Läufe' });
    const actGoalB = await Goal.findOne({ userId: userB._id, name: 'Kletter-Ziel' });
    expect(childB.trainingTypeId.toString()).toBe(ttB._id.toString());
    expect(childB.parentGoalId.toString()).toBe(metaB._id.toString());
    expect(String(actGoalB.targetRef)).toBe(actTypeB._id.toString());

    // Settings
    const userBDoc = await User.findById(userB._id);
    expect(userBDoc.weightUnit).toBe('lbs');
    const settingsB = await UserHabitSettings.findOne({ userId: userB._id });
    expect(settingsB.hasSelection).toBe(true);
    expect(settingsB.selectedHabitIds.map(String)).toEqual([habitB._id.toString()]);
    const predefined = await HabitDefinition.findOne({ userId: null, name: 'Wasser' });
    expect(settingsB.hiddenHabitIds.map(String)).toEqual([predefined._id.toString()]);
    expect(settingsB.habitSettings[habitB._id.toString()]).toEqual({ dailyTarget: 30 });
  });

  it('importing the same archive twice does not duplicate data', async () => {
    const { token: tokenA, user: userA } = await createUser({ name: 'A' });
    await seedFullDataset(userA);
    const zip = await downloadExport(app, tokenA);

    const { token: tokenB, user: userB } = await createUser({ name: 'B' });
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/data/import')
        .set(authHeader(tokenB))
        .attach('file', zip.toBuffer(), { filename: 'export.zip', contentType: 'application/zip' });
      expect(res.status).toBe(200);
    }

    expect(await WeightLog.countDocuments({ userId: userB._id })).toBe(1);
    expect(await HabitLog.countDocuments({ userId: userB._id })).toBe(1);
    expect(await ActivityLog.countDocuments({ userId: userB._id })).toBe(1);
    expect(await ActivityPlan.countDocuments({ userId: userB._id })).toBe(1);
    expect(await HabitPlan.countDocuments({ userId: userB._id })).toBe(1);
    expect(await TrainingPlan.countDocuments({ userId: userB._id })).toBe(2);
    expect(await StravaActivity.countDocuments({ userId: userB._id })).toBe(1);
    expect(await Goal.countDocuments({ userId: userB._id })).toBe(3);
    expect(await TrainingType.countDocuments({ userId: userB._id })).toBe(1);
    expect(await ActivityType.countDocuments({ userId: userB._id })).toBe(1);
    expect(await HabitDefinition.countDocuments({ userId: userB._id })).toBe(1);
  });
});
