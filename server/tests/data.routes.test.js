const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const WeightLog = require('../models/WeightLog');
const HabitLog = require('../models/HabitLog');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');
const AdmZip = require('adm-zip');

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

// ─── CSV helpers (unit tests – extracted inline) ──────────────────────────────

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

// ─── Export / Import integration tests ────────────────────────────────────────

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
