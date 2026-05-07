# Datenbank-Dokumentation – Habit Tracker

MongoDB-Datenbank: `habit_tracker`  
ODM: Mongoose 8

---

## Relationsübersicht

```
User ──────────────────────────────────────────────────────────┐
 │                                                             │
 ├──< ActivityType          (userId → User)                    │
 │       │ (version + nameHistory)                             │
 │       └──< ActivityLog   (activityTypeRef + version → AT)  │
 │       └──< ActivityPlan  (activityTypeRef + version → AT)  │
 │                                                             │
 ├──< HabitDefinition       (userId → User, nullable)         │
 │       │ (version + nameHistory)                             │
 │       └──< HabitLog      (habitId + habitVersion → HD)     │
 │                                                             │
 ├──< WeightLog             (userId → User)                    │
 │                                                             │
 ├──< Goal                  (userId → User)                    │
 │       └── targetRef ──→  ActivityType  (polymorphe Ref)    │
 │                    ──→  HabitDefinition (polymorphe Ref)    │
 │                                                             │
 └── selectedHabitIds[] ──→ HabitDefinition[]                 │
```

---

## Versionierte Referenzen (Namenshistorie)

ActivityType und HabitDefinition unterstützen Namensänderungen ohne Datenverlust.
Wenn ein Name geändert wird, wird die alte Version in `nameHistory` archiviert und
`version` hochgezählt. Logs und Pläne speichern die Version zum Zeitpunkt der Erfassung.

### Konzept

```
ActivityType { label: "Laufen", version: 2, nameHistory: [{ name: "Joggen", version: 1, ... }] }
ActivityLog  { activityTypeRef: <id>, activityTypeVersion: 1 }
              → historicalLabel: "Joggen"  (weil version 1 ≠ aktuelle version 2)
```

Das Backend berechnet beim Lesen des Logs automatisch `historicalLabel`, falls der
gespeicherte Versionsstand vom aktuellen Namen abweicht. Das Frontend zeigt dann:
**Laufen (Joggen)** – aktueller Name mit damaligem Namen in Klammern.

---

## Modelle

### User
Repräsentiert einen Benutzer. Login erfolgt ausschließlich per UUID.

| Feld              | Typ        | Relation / Beschreibung                                  |
|-------------------|------------|----------------------------------------------------------|
| `_id`             | ObjectId   | Primärschlüssel                                          |
| `uuid`            | String     | Eindeutiger Login-Schlüssel (aus `.env` VALID_UUIDS)    |
| `name`            | String     | Anzeigename des Benutzers                                |
| `weightUnit`      | String     | Bevorzugte Gewichtseinheit (`kg` oder `lbs`)             |
| `selectedHabitIds`| ObjectId[] | **→ HabitDefinition[]** Aktiv ausgewählte Gewohnheiten  |
| `createdAt`       | Date       | Erstellungszeitpunkt                                     |

---

### ActivityType
Benutzerdefinierte Aktivitätstypen (z.B. „Gym", „Joggen 5k"). Werden beim ersten Abruf
pro Benutzer mit Standardwerten vorbelegt. Unterstützt Namensänderungen mit Versionshistorie.

| Feld           | Typ        | Relation / Beschreibung                                               |
|----------------|------------|-----------------------------------------------------------------------|
| `_id`          | ObjectId   | Primärschlüssel                                                       |
| `userId`       | ObjectId   | **→ User** Eigentümer (required)                                     |
| `label`        | String     | Aktueller Anzeigename                                                |
| `version`      | Number     | Aktuelle Versionnummer (beginnt bei 1, steigt bei Umbenennung)       |
| `nameHistory`  | Array      | Archiv alter Namen (siehe unten)                                     |
| `showDistance` | Boolean    | Zeigt Distanzfeld im Eingabeformular                                 |
| `showDuration` | Boolean    | Zeigt Dauerfeld im Eingabeformular                                   |
| `customFields` | Array      | Eigene Felder (Objekte mit `key`, `label`, `type`, `unit`, `options`)|
| `createdAt`    | Date       | —                                                                     |

**`nameHistory[]`-Einträge**:

| Feld        | Typ    | Beschreibung                                  |
|-------------|--------|-----------------------------------------------|
| `name`      | String | Historischer Name                             |
| `version`   | Number | Versionnummer, zu der dieser Name gültig war  |
| `validFrom` | Date   | Beginn der Gültigkeit                         |
| `validUntil`| Date   | Ende der Gültigkeit (Zeitpunkt der Umbenennung)|

**`customFields[].type`**: `'number'` (Zahleneingabe mit Einheit) oder `'select'` (Auswahlliste)

---

### ActivityLog
Protokolliert eine absolvierte Aktivität.

| Feld                  | Typ      | Relation / Beschreibung                                      |
|-----------------------|----------|--------------------------------------------------------------|
| `_id`                 | ObjectId | Primärschlüssel                                              |
| `userId`              | ObjectId | **→ User** Eigentümer (required)                            |
| `activityType`        | String   | Label-String der Aktivität (Abwärtskompatibilität)          |
| `activityTypeRef`     | ObjectId | **→ ActivityType** Direkte Referenz                         |
| `activityTypeVersion` | Number   | Version des ActivityType zum Zeitpunkt der Erfassung        |
| `date`                | Date     | Datum der Aktivität                                          |
| `duration`            | Number   | Dauer in Minuten (optional)                                  |
| `distance`            | Number   | Distanz in Kilometern (optional)                             |
| `notes`               | String   | Freitextnotizen (optional)                                   |
| `customValues`        | Mixed    | Key-Value-Map für benutzerdefinierte Felder des ActivityType |
| `createdAt`           | Date     | —                                                            |

**Indizes**: `{ userId, date }` · `{ userId, activityTypeRef, date }`

Das Backend berechnet beim Lesen `historicalLabel`, falls `activityTypeVersion` vom
aktuellen `ActivityType.version` abweicht.

---

### ActivityPlan
Geplante (noch nicht absolvierte) Aktivität.

| Feld                  | Typ      | Relation / Beschreibung                                  |
|-----------------------|----------|----------------------------------------------------------|
| `_id`                 | ObjectId | Primärschlüssel                                          |
| `userId`              | ObjectId | **→ User** Eigentümer (required)                        |
| `activityType`        | String   | Label-String der Aktivität (Abwärtskompatibilität)      |
| `activityTypeRef`     | ObjectId | **→ ActivityType** Direkte Referenz                     |
| `activityTypeVersion` | Number   | Version des ActivityType zum Zeitpunkt der Planung      |
| `scheduledDate`       | Date     | Geplantes Datum                                          |
| `duration`            | Number   | Geplante Dauer in Minuten (optional)                     |
| `distance`            | Number   | Geplante Distanz in Kilometern (optional)                |
| `completed`           | Boolean  | Wurde der Plan abgehakt?                                 |
| `notes`               | String   | Notizen (optional)                                       |
| `createdAt`           | Date     | —                                                        |

**Index**: `{ userId, scheduledDate }`

---

### HabitDefinition
Definition einer Gewohnheit – entweder vordefiniert (userId = null) oder benutzerdefiniert.
Unterstützt Namensänderungen mit Versionshistorie (analog zu ActivityType).

| Feld           | Typ      | Relation / Beschreibung                                            |
|----------------|----------|--------------------------------------------------------------------|
| `_id`          | ObjectId | Primärschlüssel                                                    |
| `userId`       | ObjectId | **→ User** (nullable – `null` bei vordefinierten Gewohnheiten)    |
| `name`         | String   | Aktueller Anzeigename                                             |
| `version`      | Number   | Aktuelle Versionnummer (beginnt bei 1)                            |
| `nameHistory`  | Array    | Archiv alter Namen (gleiche Struktur wie bei ActivityType)        |
| `unitSymbol`   | String   | Einheitenbezeichnung (z.B. `g`, `h`, `ml`, `Stück`)              |
| `type`         | String   | `'amount'` (Menge), `'duration'` (Dauer) oder `'boolean'`        |
| `isPredefined` | Boolean  | `true` bei systemseitig angelegten Gewohnheiten                   |
| `createdAt`    | Date     | —                                                                  |

**Vordefinierte Gewohnheiten** (userId = null, unveränderlich):
Screen Time, Kreatin, Zigaretten, Wasser, Schlaf, Meditation, Koffein, Alkohol

Eigene Gewohnheiten können über `PUT /api/habits/definitions/:id` umbenannt werden.

---

### HabitLog
Tageswert für eine Gewohnheit. Pro Benutzer und Gewohnheit wird nur ein Eintrag pro Tag
gespeichert (Upsert).

| Feld          | Typ      | Relation / Beschreibung                       |
|---------------|----------|-----------------------------------------------|
| `_id`         | ObjectId | Primärschlüssel                               |
| `userId`      | ObjectId | **→ User** Eigentümer (required)             |
| `habitId`     | ObjectId | **→ HabitDefinition** (required, populated)  |
| `habitVersion`| Number   | Version der HabitDefinition zum Erfassungszeitpunkt |
| `date`        | Date     | Datum des Eintrags (auf Tagesbeginn normiert) |
| `value`       | Number   | Eingetragener Wert in der Einheit der Habit   |
| `createdAt`   | Date     | —                                             |

**Index**: `{ userId, habitId, date }`

---

### WeightLog
Gewichtseintrag des Benutzers.

| Feld       | Typ      | Relation / Beschreibung             |
|------------|----------|-------------------------------------|
| `_id`      | ObjectId | Primärschlüssel                     |
| `userId`   | ObjectId | **→ User** Eigentümer (required)   |
| `date`     | Date     | Datum der Messung                   |
| `weight`   | Number   | Gewicht                             |
| `unit`     | String   | `'kg'` oder `'lbs'`                |
| `createdAt`| Date     | —                                   |

**Index**: `{ userId, date }`

---

### Goal
Ein Ziel des Benutzers – periodisch oder langfristig, für Aktivitäten oder Gewohnheiten.

| Feld                | Typ      | Relation / Beschreibung                                                          |
|---------------------|----------|----------------------------------------------------------------------------------|
| `_id`               | ObjectId | Primärschlüssel                                                                  |
| `userId`            | ObjectId | **→ User** Eigentümer (required)                                                |
| `name`              | String   | Bezeichnung des Ziels                                                            |
| `description`       | String   | Optionale Beschreibung                                                           |
| `type`              | String   | `'periodic-activity'` · `'periodic-habit'` · `'weekly-activity'` · etc.        |
| `targetRef`         | Mixed    | **→ ActivityType oder HabitDefinition** (polymorphe Referenz, ObjectId)        |
| `targetRefModel`    | String   | Bestimmt das Zielmodell: `'ActivityType'` oder `'HabitDefinition'`             |
| `condition`         | String   | `'min'` · `'max'` · `'exact'`                                                   |
| `targetValue`       | Number   | Zielwert                                                                         |
| `unitSymbol`        | String   | Einheit (z.B. `Mal`, `g`, `h`)                                                  |
| `conditions`        | Array    | Multi-Bedingungen mit `conditionOperator` (`AND`/`OR`)                          |
| `startDate`         | Date     | Startdatum (nur langfristige Ziele)                                              |
| `endDate`           | Date     | Enddatum (nur langfristige Ziele)                                                |
| `startValue`        | Number   | Ausgangswert beim Start (optional)                                               |
| `intermediateSteps` | Array    | Manuelle Zwischenziele `[{ date, targetValue, description }]`                   |
| `isActive`          | Boolean  | Aktiv-Flag (soft delete über `isActive: false`)                                 |
| `createdAt`         | Date     | —                                                                                |

**Index**: `{ userId, isActive }`

Goals referenzieren ActivityType/HabitDefinition immer per ID und zeigen stets den
aktuellen Namen – keine Versionshistorie bei Goals.

---

## Populate-Übersicht (Mongoose)

| Route                        | populate()                                                        |
|------------------------------|-------------------------------------------------------------------|
| `GET /api/activities`        | `activityTypeRef` → label, version, nameHistory, showDistance, customFields |
| `GET /api/planner`           | `activityTypeRef` → label, version, nameHistory, showDistance, customFields |
| `GET /api/habits/logs`       | `habitId` → name, version, nameHistory, unitSymbol, type         |
| `GET /api/goals`             | manuell via `enrichGoal()` → `targetName` im Response            |

`nameHistory` wird serverseitig verarbeitet und **nicht** an den Client weitergegeben.
Stattdessen wird ggf. ein berechnetes `historicalLabel` zurückgegeben.

---

## Indexierungsstrategie

Alle Queries nutzen `userId` als ersten Filterterm – daher ist `userId` in allen
Compound-Indizes an erster Stelle. Zeitbasierte Sortierungen (`date: -1`, `scheduledDate: 1`)
sind als sekundäres Feld enthalten, um Index-Scans ohne Collection-Scan zu ermöglichen.

---

## Tools

### Backup – `./backup.sh`

Erstellt einen komprimierten Snapshot der MongoDB-Datenbank.

**Was es tut:**
1. Prüft, ob der MongoDB-Container (`habit-tracker-mongo`) läuft
2. Setzt eine Lock-Datei (`.backup.lock`), die den Server veranlasst, alle Schreibzugriffe
   mit HTTP 503 abzulehnen
3. Wartet 2 Sekunden, damit laufende Requests abgeschlossen werden
4. Führt `mongodump --gzip --archive` im Container aus
5. Kopiert das Archiv nach `./backups/habit_tracker_<TIMESTAMP>.archive.gz`
6. Entfernt die Lock-Datei

**Verwendung:**
```bash
./backup.sh
```

**Ausgabe:** Dateipfad und Größe des Backups sowie Wiederherstellungshinweis.

> Das Backup lässt die App lesend erreichbar – nur Schreibzugriffe werden geblockt.

---

### Restore – `./restore.sh`

Stellt einen Datenbankzustand aus einem Backup wieder her.

**Was es tut:**
1. Ohne Argument: listet alle verfügbaren Backups in `./backups/` auf
2. Mit Argument: stellt das angegebene Archiv wieder her
   - Stoppt die App (MongoDB bleibt aktiv)
   - Kopiert das Archiv in den Container
   - Führt `mongorestore --drop` aus (überschreibt bestehende Daten!)
   - Startet die App neu

**Verwendung:**
```bash
./restore.sh                                    # Backups auflisten
./restore.sh backups/habit_tracker_XYZ.archive.gz  # Wiederherstellen
```

> **Warnung:** `--drop` löscht alle aktuellen Daten vor der Wiederherstellung.
> Die Bestätigung mit `ja` ist erforderlich.

---

### Migration – `scripts/migrate-versioned-refs.js`

Einmalig auszuführendes Skript, das bestehende Datenbankeinträge auf das Schema
der versionierten Referenzen aktualisiert.

**Wann nötig:** Nach dem ersten Deployment der Namenshistorie-Funktion, oder wenn
Einträge ohne `version`/`activityTypeVersion`/`habitVersion` vorhanden sind.

**Was es tut:**
1. Setzt `version=1` und `nameHistory=[]` auf allen ActivityTypes (falls fehlend)
2. Setzt `version=1` und `nameHistory=[]` auf allen HabitDefinitions (falls fehlend)
3. Setzt `activityTypeVersion=1` auf ActivityLogs mit vorhandener `activityTypeRef`
4. Ordnet ActivityLogs ohne `activityTypeRef` per Namensabgleich einem ActivityType zu
5. Dasselbe für ActivityPlans
6. Setzt `habitVersion=1` auf allen HabitLogs (falls fehlend)

**Verwendung:**
```bash
# Erst Backup erstellen!
./backup.sh

# Dann Migration ausführen
node scripts/migrate-versioned-refs.js
```

**Sicher wiederholbar:** Das Skript prüft immer `$exists: false` vor dem Setzen –
bereits migrierte Felder werden nicht überschrieben.
