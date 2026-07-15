#!/usr/bin/env node
// Seeds a reusable demo dataset for showcases: multiple accounts with
// per-user settings, ~10 weeks of habit/activity/weight history (so heatmaps
// and charts look alive), goals and planner entries for the current week.
//
// Usage:
//   node scripts/seed-demo.js            – seed into an EMPTY database
//   node scripts/seed-demo.js --reset    – wipe existing user data first
//
// Inside the Docker deployment (uses the container's env, incl. pepper):
//   docker compose exec app node scripts/seed-demo.js --reset
//
// IMPORTANT: run the script in the same environment as the app server —
// password hashes include the configured pepper. Migration state and admin
// system config (SystemConfig) are never touched.
//
// Demo accounts (password for all: demo1234):
//   admin – Alex Admin (administrator)
//   lena  – sporty showcase: activities, targets, heatmap gradations, goals
//   jonas – health showcase: quit-smoking max-targets, relapses in heatmap
//   mia   – brand-new account that still shows the onboarding wizard

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const pw = require('../server/utils/password');
const User = require('../server/models/User');
const ActivityType = require('../server/models/ActivityType');
const ActivityLog = require('../server/models/ActivityLog');
const ActivityPlan = require('../server/models/ActivityPlan');
const HabitDefinition = require('../server/models/HabitDefinition');
const HabitLog = require('../server/models/HabitLog');
const HabitPlan = require('../server/models/HabitPlan');
const UserHabitSettings = require('../server/models/UserHabitSettings');
const WeightLog = require('../server/models/WeightLog');
const Goal = require('../server/models/Goal');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/habit_tracker';
const DEMO_PASSWORD = 'demo1234';
const WEEKS = 10;

// Same list as the server's startup seed — keeps the script usable against a
// database the server has never touched.
const PREDEFINED_HABITS = [
  { name: 'Screen Time', unitSymbol: 'h', type: 'duration' },
  { name: 'Kreatin', unitSymbol: 'g', type: 'amount' },
  { name: 'Zigaretten', unitSymbol: 'Stück', type: 'amount' },
  { name: 'Wasser', unitSymbol: 'ml', type: 'amount' },
  { name: 'Schlaf', unitSymbol: 'h', type: 'duration' },
  { name: 'Meditation', unitSymbol: 'min', type: 'duration' },
  { name: 'Koffein', unitSymbol: 'mg', type: 'amount' },
  { name: 'Alkohol', unitSymbol: 'Gläser', type: 'amount' },
];

// Deterministic PRNG — repeated runs produce the same data shapes.
let prngState = 42;
function rand() {
  prngState = (prngState * 1664525 + 1013904223) % 4294967296;
  return prngState / 4294967296;
}
const randBetween = (min, max) => min + rand() * (max - min);
const randInt = (min, max) => Math.round(randBetween(min, max));
const chance = (p) => rand() < p;

// Date helpers — everything is relative to "today" so the feed, planner and
// heatmaps always look current when the demo is (re)seeded.
function daysAgo(n, hour = 12) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
const weekdayOf = (n) => daysAgo(n).getDay(); // 0 = Sunday … 6 = Saturday

async function wipeUserData() {
  await Promise.all([
    User.deleteMany({}),
    ActivityType.deleteMany({}),
    ActivityLog.deleteMany({}),
    ActivityPlan.deleteMany({}),
    HabitDefinition.deleteMany({}),
    HabitLog.deleteMany({}),
    HabitPlan.deleteMany({}),
    UserHabitSettings.deleteMany({}),
    WeightLog.deleteMany({}),
    Goal.deleteMany({}),
  ]);
}

async function seedPredefinedHabits() {
  const byName = {};
  for (const h of PREDEFINED_HABITS) {
    byName[h.name] = await HabitDefinition.findOneAndUpdate(
      { name: h.name, userId: null },
      { ...h, userId: null, isPredefined: true, version: 1, nameHistory: [] },
      { upsert: true, new: true }
    );
  }
  return byName;
}

async function createUser({ username, name, isAdmin = false, onboardingPending = false }, passwordHash) {
  return User.create({
    uuid: crypto.randomUUID(),
    username,
    name,
    passwordHash,
    isAdmin,
    mustChangePassword: false,
    onboardingPending,
    onboardedAt: onboardingPending ? null : daysAgo(WEEKS * 7),
  });
}

async function createTypes(userId, defs) {
  const types = {};
  for (const def of defs) {
    types[def.label] = await ActivityType.create({
      ...def, userId, version: 1, nameHistory: [],
    });
  }
  return types;
}

const logActivity = (userId, type, dayOffset, fields = {}) => ({
  userId,
  activityType: type.label,
  activityTypeRef: type._id,
  activityTypeVersion: 1,
  date: daysAgo(dayOffset),
  customValues: {},
  ...fields,
});

const logHabit = (userId, def, dayOffset, value) => ({
  userId,
  habitId: def._id,
  habitVersion: 1,
  date: daysAgo(dayOffset, 0),
  value,
});

// ── Persona: Lena — sporty all-rounder ─────────────────────────────────────
// Shows: schedules, min-targets with partial fulfilment (heatmap gradations),
// a boolean habit, goals (periodic + long-term with milestones), planner.
async function seedLena(passwordHash, predefined) {
  const lena = await createUser({ username: 'lena', name: 'Lena' }, passwordHash);

  const types = await createTypes(lena._id, [
    {
      label: 'Gym', showDuration: true, showDistance: false,
      customFields: [{ key: 'workoutPlan', label: 'Trainingsplan', type: 'select', options: ['Push', 'Pull', 'Legs'] }],
    },
    { label: 'Joggen', showDuration: true, showDistance: true, customFields: [] },
    { label: 'Yoga', showDuration: true, showDistance: false, customFields: [] },
  ]);

  // Custom boolean habit
  const dehnen = await HabitDefinition.create({
    userId: lena._id, name: 'Dehnen', unitSymbol: '✓', type: 'boolean',
    isPredefined: false, version: 1, nameHistory: [],
  });

  const wasser = predefined['Wasser'];
  const schlaf = predefined['Schlaf'];
  const meditation = predefined['Meditation'];

  await UserHabitSettings.create({
    userId: lena._id,
    selectedHabitIds: [wasser._id, schlaf._id, meditation._id, dehnen._id],
    hasSelection: true,
    habitSettings: {
      [wasser._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'min', targetValue: 2000 },
      [schlaf._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'min', targetValue: 7 },
      [meditation._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [1, 3, 5], scheduleDate: null, targetCondition: 'min', targetValue: 10 },
      [dehnen._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'none', targetValue: 0 },
    },
  });

  // ~10 weeks of activities: Joggen Mo+Do, Gym Di+Fr (Push/Pull/Legs), Yoga So
  const activities = [];
  const plans = ['Push', 'Pull', 'Legs'];
  for (let day = 1; day <= WEEKS * 7; day++) {
    const wd = weekdayOf(day);
    if ((wd === 1 || wd === 4) && chance(0.9)) {
      activities.push(logActivity(lena._id, types['Joggen'], day, {
        duration: randInt(28, 50), distance: +randBetween(4.5, 9).toFixed(1),
      }));
    }
    if ((wd === 2 || wd === 5) && chance(0.85)) {
      activities.push(logActivity(lena._id, types['Gym'], day, {
        duration: randInt(55, 80),
        customValues: { workoutPlan: plans[randInt(0, 2)] },
      }));
    }
    if (wd === 0 && chance(0.7)) {
      activities.push(logActivity(lena._id, types['Yoga'], day, { duration: randInt(20, 45) }));
    }
  }
  await ActivityLog.insertMany(activities);

  // Habit logs with realistic gaps and partial fulfilment
  const habitLogs = [];
  for (let day = 0; day <= WEEKS * 7; day++) {
    const wd = weekdayOf(day);
    if (chance(0.92)) habitLogs.push(logHabit(lena._id, wasser, day, randInt(9, 27) * 100)); // 900–2700 ml
    if (chance(0.95)) habitLogs.push(logHabit(lena._id, schlaf, day, +randBetween(5.5, 8.5).toFixed(1)));
    if ([1, 3, 5].includes(wd) && chance(0.85)) {
      habitLogs.push(logHabit(lena._id, meditation, day, randInt(5, 20)));
    }
    if (chance(0.6)) habitLogs.push(logHabit(lena._id, dehnen, day, 1));
  }
  await HabitLog.insertMany(habitLogs);

  // Weight trending down: 68.5 → ~66.5 kg
  const weights = [];
  for (let day = 0; day <= WEEKS * 7; day++) {
    const wd = weekdayOf(day);
    if (wd === 1 || wd === 4) {
      weights.push({
        userId: lena._id,
        date: daysAgo(day, 7),
        weight: +(66.5 + day * 0.028 + randBetween(-0.3, 0.3)).toFixed(1),
        unit: 'kg',
      });
    }
  }
  await WeightLog.insertMany(weights);

  await Goal.create({
    userId: lena._id,
    name: 'Zweimal pro Woche laufen',
    type: 'periodic-activity',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: types['Joggen']._id,
    targetRefModel: 'ActivityType',
    condition: 'min',
    targetValue: 2,
    metric: 'count',
    conditions: [{ metric: 'count', condition: 'min', targetValue: 2, valueScope: 'total', aggregation: 'sum' }],
  });
  await Goal.create({
    userId: lena._id,
    name: 'Halbmarathon-Vorbereitung',
    description: 'Longrun Schritt für Schritt auf 21 km steigern.',
    type: 'long-term-activity',
    targetRef: types['Joggen']._id,
    targetRefModel: 'ActivityType',
    condition: 'min',
    targetValue: 21,
    unitSymbol: 'km',
    metric: 'distance',
    conditions: [{ metric: 'distance', condition: 'min', targetValue: 21, unitSymbol: 'km', valueScope: 'perActivity', aggregation: 'max' }],
    startDate: daysAgo(WEEKS * 7),
    endDate: daysAgo(-8 * 7),
    startValue: 8,
    intermediateSteps: [
      { date: daysAgo(14), targetValue: 12, description: 'Zwölf Kilometer am Stück' },
      { date: daysAgo(-4 * 7), targetValue: 16, description: 'Sechzehn-Kilometer-Marke' },
    ],
  });

  // Planner: current week (yesterday completed, upcoming open)
  await ActivityPlan.create({
    userId: lena._id,
    activityType: 'Joggen',
    activityTypeRef: types['Joggen']._id,
    activityTypeVersion: 1,
    scheduledDate: daysAgo(1),
    duration: 40, distance: 7,
    completed: true,
    customValues: {},
  });
  await ActivityPlan.create({
    userId: lena._id,
    activityType: 'Gym',
    activityTypeRef: types['Gym']._id,
    activityTypeVersion: 1,
    scheduledDate: daysAgo(0),
    duration: 60,
    notes: 'Leg Day',
    completed: false,
    customValues: {},
  });
  await HabitPlan.create({
    userId: lena._id,
    habitId: meditation._id,
    habitName: meditation.name,
    unitSymbol: meditation.unitSymbol,
    habitType: meditation.type,
    scheduledDate: daysAgo(-1),
    completed: false,
  });

  return lena;
}

// ── Persona: Jonas — quitting smoking ──────────────────────────────────────
// Shows: max-targets (0 allowed), relapses as dimmed heatmap cells, an
// improving trend over the weeks, a periodic habit goal.
async function seedJonas(passwordHash, predefined) {
  const jonas = await createUser({ username: 'jonas', name: 'Jonas' }, passwordHash);

  const types = await createTypes(jonas._id, [
    { label: 'Wandern', showDuration: true, showDistance: true, customFields: [] },
    { label: 'Radfahren', showDuration: true, showDistance: true, customFields: [] },
  ]);

  const zigaretten = predefined['Zigaretten'];
  const koffein = predefined['Koffein'];
  const wasser = predefined['Wasser'];

  await UserHabitSettings.create({
    userId: jonas._id,
    selectedHabitIds: [zigaretten._id, koffein._id, wasser._id],
    hasSelection: true,
    habitSettings: {
      [zigaretten._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'max', targetValue: 0 },
      [koffein._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'max', targetValue: 200 },
      [wasser._id]: { missingDayMode: 'none', defaultValue: 0, scheduleDays: [], scheduleDate: null, targetCondition: 'min', targetValue: 1500 },
    },
  });

  // Weekend hikes and occasional rides
  const activities = [];
  for (let day = 1; day <= WEEKS * 7; day++) {
    const wd = weekdayOf(day);
    if (wd === 6 && chance(0.75)) {
      activities.push(logActivity(jonas._id, types['Wandern'], day, {
        duration: randInt(90, 240), distance: +randBetween(6, 16).toFixed(1),
      }));
    }
    if (wd === 3 && chance(0.4)) {
      activities.push(logActivity(jonas._id, types['Radfahren'], day, {
        duration: randInt(30, 75), distance: +randBetween(10, 28).toFixed(1),
      }));
    }
  }
  await ActivityLog.insertMany(activities);

  // Smoking: bad in the oldest weeks, mostly clean recently — with relapses
  const habitLogs = [];
  for (let day = 0; day <= WEEKS * 7; day++) {
    const progress = 1 - day / (WEEKS * 7); // 0 = oldest … 1 = today
    const relapseChance = 0.85 - progress * 0.7; // 85% → 15%
    const cigarettes = chance(relapseChance) ? randInt(1, 6) : 0;
    habitLogs.push(logHabit(jonas._id, zigaretten, day, cigarettes));
    if (chance(0.9)) habitLogs.push(logHabit(jonas._id, koffein, day, randInt(8, 40) * 10));
    if (chance(0.8)) habitLogs.push(logHabit(jonas._id, wasser, day, randInt(8, 24) * 100));
  }
  await HabitLog.insertMany(habitLogs);

  const weights = [];
  for (let day = 0; day <= WEEKS * 7; day += 7) {
    weights.push({
      userId: jonas._id,
      date: daysAgo(day, 8),
      weight: +(82 + randBetween(-0.6, 0.6)).toFixed(1),
      unit: 'kg',
    });
  }
  await WeightLog.insertMany(weights);

  await Goal.create({
    userId: jonas._id,
    name: 'Rauchfreie Woche',
    type: 'periodic-habit',
    intervalValue: 1,
    intervalUnit: 'week',
    targetRef: zigaretten._id,
    targetRefModel: 'HabitDefinition',
    condition: 'max',
    targetValue: 0,
    unitSymbol: zigaretten.unitSymbol,
    metric: 'value',
    conditions: [{ metric: 'value', condition: 'max', targetValue: 0, unitSymbol: zigaretten.unitSymbol, valueScope: 'total', aggregation: 'sum' }],
  });

  return jonas;
}

async function main() {
  const reset = process.argv.includes('--reset');

  console.log(`→ Connecting to ${MONGODB_URI.replace(/\/\/[^/@]+@/, '//***:***@')}`);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  const existingUsers = await User.countDocuments();
  if (existingUsers > 0 && !reset) {
    console.error(`✗ Database already contains ${existingUsers} users.`);
    console.error('  Run with --reset to wipe all user data and reseed.');
    process.exit(1);
  }
  if (reset) {
    console.log('→ Removing existing user data (migrations & system config are kept) …');
    await wipeUserData();
  }

  console.log('→ Upserting predefined habits …');
  const predefined = await seedPredefinedHabits();

  console.log('→ Hashing demo password …');
  const passwordHash = await pw.hash(DEMO_PASSWORD);

  console.log('→ Creating accounts & sample data …');
  await createUser({ username: 'admin', name: 'Alex Admin', isAdmin: true }, passwordHash);
  await seedLena(passwordHash, predefined);
  await seedJonas(passwordHash, predefined);
  await createUser({ username: 'mia', name: 'Mia', onboardingPending: true }, passwordHash);

  console.log(`
════════════════════════════════════════════════════════
  Demo data seeded successfully (password for all accounts: ${DEMO_PASSWORD})

  admin  – Alex Admin   administrator
  lena   – Lena         sporty showcase: targets, heatmap, planner
  jonas  – Jonas        quit-smoking showcase: max targets, relapses
  mia    – Mia          fresh account → shows the onboarding wizard
════════════════════════════════════════════════════════`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('✗ Seeding failed:', err.message);
  process.exit(1);
});
