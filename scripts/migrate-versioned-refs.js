#!/usr/bin/env node
/**
 * Migration: Versionierte Referenzen initialisieren
 *
 * Muss einmalig ausgeführt werden, um bestehende Datenbankeinträge auf das neue
 * Schema zu heben, das Namensänderungen von Aktivitätstypen und Gewohnheiten
 * historisch nachverfolgt.
 *
 * Was dieses Skript tut:
 *   1. ActivityTypes:    version=1 und nameHistory=[] setzen (falls noch nicht vorhanden)
 *   2. HabitDefinitions: version=1 und nameHistory=[] setzen (falls noch nicht vorhanden)
 *   3. ActivityLogs:     activityTypeVersion=1 setzen; fehlende activityTypeRef per
 *                        Namensabgleich nachziehen
 *   4. ActivityPlans:    dasselbe wie ActivityLogs
 *   5. HabitLogs:        habitVersion=1 setzen (falls noch nicht vorhanden)
 *
 * Verwendung:
 *   node scripts/migrate-versioned-refs.js
 *
 * Voraussetzung: MONGODB_URI ist in der .env-Datei konfiguriert.
 * Empfehlung:    Vorher ein Backup erstellen mit ./backup.sh
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const ActivityType = require('../server/models/ActivityType');
const HabitDefinition = require('../server/models/HabitDefinition');
const ActivityLog = require('../server/models/ActivityLog');
const ActivityPlan = require('../server/models/ActivityPlan');
const HabitLog = require('../server/models/HabitLog');

const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const RED   = '\x1b[31m';
const BOLD  = '\x1b[1m';
const NC    = '\x1b[0m';

const ok   = (msg) => console.log(`${GREEN}✓${NC} ${msg}`);
const info = (msg) => console.log(`${CYAN}→${NC} ${msg}`);
const err  = (msg) => console.error(`${RED}✗${NC} ${msg}`);

async function migrate() {
  console.log('');
  console.log(`${BOLD}=== Migration: Versionierte Referenzen ===${NC}`);
  console.log('');

  info('Verbinde mit MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  ok('Verbunden\n');

  // ── 1. ActivityTypes ──────────────────────────────────────────────────────

  info('1. ActivityTypes: Version initialisieren...');
  const atVersioned = await ActivityType.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } }
  );
  const atHistory = await ActivityType.updateMany(
    { nameHistory: { $exists: false } },
    { $set: { nameHistory: [] } }
  );
  ok(`   ${atVersioned.modifiedCount} ActivityTypes mit version=1 initialisiert`);
  ok(`   ${atHistory.modifiedCount} ActivityTypes mit nameHistory=[] initialisiert`);

  // ── 2. HabitDefinitions ───────────────────────────────────────────────────

  info('\n2. HabitDefinitions: Version initialisieren...');
  const hdVersioned = await HabitDefinition.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } }
  );
  const hdHistory = await HabitDefinition.updateMany(
    { nameHistory: { $exists: false } },
    { $set: { nameHistory: [] } }
  );
  ok(`   ${hdVersioned.modifiedCount} HabitDefinitions mit version=1 initialisiert`);
  ok(`   ${hdHistory.modifiedCount} HabitDefinitions mit nameHistory=[] initialisiert`);

  // ── 3. ActivityLogs ───────────────────────────────────────────────────────

  info('\n3. ActivityLogs: Version-Referenz setzen...');

  // Logs mit vorhandener Ref: activityTypeVersion=1 setzen
  const alWithRef = await ActivityLog.updateMany(
    {
      activityTypeRef: { $exists: true, $ne: null },
      activityTypeVersion: { $exists: false }
    },
    { $set: { activityTypeVersion: 1 } }
  );
  ok(`   ${alWithRef.modifiedCount} ActivityLogs (mit Ref) auf version=1 gesetzt`);

  // Logs ohne Ref: per Namensabgleich zuordnen
  const logsWithoutRef = await ActivityLog.find({
    $or: [{ activityTypeRef: null }, { activityTypeRef: { $exists: false } }]
  }).lean();

  let alMatched = 0;
  let alUnmatched = 0;
  for (const log of logsWithoutRef) {
    if (!log.activityType) { alUnmatched++; continue; }
    const type = await ActivityType.findOne({ userId: log.userId, label: log.activityType }).select('_id version');
    if (type) {
      await ActivityLog.updateOne(
        { _id: log._id },
        { $set: { activityTypeRef: type._id, activityTypeVersion: type.version || 1 } }
      );
      alMatched++;
    } else {
      alUnmatched++;
    }
  }
  ok(`   ${alMatched} von ${logsWithoutRef.length} Logs ohne Ref per Name zugeordnet`);
  if (alUnmatched > 0) {
    console.log(`   ${alUnmatched} Logs konnten nicht zugeordnet werden (kein passender Aktivitätstyp)`);
  }

  // ── 4. ActivityPlans ──────────────────────────────────────────────────────

  info('\n4. ActivityPlans: Version-Referenz setzen...');

  const apWithRef = await ActivityPlan.updateMany(
    {
      activityTypeRef: { $exists: true, $ne: null },
      activityTypeVersion: { $exists: false }
    },
    { $set: { activityTypeVersion: 1 } }
  );
  ok(`   ${apWithRef.modifiedCount} ActivityPlans (mit Ref) auf version=1 gesetzt`);

  const plansWithoutRef = await ActivityPlan.find({
    $or: [{ activityTypeRef: null }, { activityTypeRef: { $exists: false } }]
  }).lean();

  let apMatched = 0;
  let apUnmatched = 0;
  for (const plan of plansWithoutRef) {
    if (!plan.activityType) { apUnmatched++; continue; }
    const type = await ActivityType.findOne({ userId: plan.userId, label: plan.activityType }).select('_id version');
    if (type) {
      await ActivityPlan.updateOne(
        { _id: plan._id },
        { $set: { activityTypeRef: type._id, activityTypeVersion: type.version || 1 } }
      );
      apMatched++;
    } else {
      apUnmatched++;
    }
  }
  ok(`   ${apMatched} von ${plansWithoutRef.length} Plänen ohne Ref per Name zugeordnet`);
  if (apUnmatched > 0) {
    console.log(`   ${apUnmatched} Pläne konnten nicht zugeordnet werden`);
  }

  // ── 5. HabitLogs ──────────────────────────────────────────────────────────

  info('\n5. HabitLogs: habitVersion setzen...');
  const hlResult = await HabitLog.updateMany(
    { habitVersion: { $exists: false } },
    { $set: { habitVersion: 1 } }
  );
  ok(`   ${hlResult.modifiedCount} HabitLogs auf habitVersion=1 gesetzt`);

  // ── Fertig ─────────────────────────────────────────────────────────────────

  console.log('');
  ok(`${BOLD}Migration abgeschlossen!${NC}`);
  console.log('');

  await mongoose.disconnect();
}

migrate().catch(e => {
  err('Fehler: ' + e.message);
  console.error(e);
  process.exit(1);
});
