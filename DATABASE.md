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
Repräsentiert einen Benutzer. Login erfolgt per Benutzername + Passwort (nach Migration).

| Feld              | Typ        | Beschreibung                                                                      |
|-------------------|------------|-----------------------------------------------------------------------------------|
| `_id`             | ObjectId   | Primärschlüssel                                                                   |
| `uuid`            | String     | Ursprünglicher Zugangscode (aus `.env` VALID_UUIDS); nach Migration gesperrt      |
| `username`        | String     | Benutzername für den Login (≥3 Zeichen, unique, lowercase); wird bei Migration gesetzt |
| `passwordHash`    | String     | bcrypt-Hash des Benutzerpassworts (+ Pepper); `select: false`, nie in API-Responses |
| `name`            | String     | Anzeigename des Benutzers                                                         |
| `isAdmin`         | Boolean    | Admin-Flag                                                                        |
| `adminSecretHash` | String     | bcrypt-Hash des Admin-Secrets; `select: false`                                    |
| `weightUnit`      | String     | Bevorzugte Gewichtseinheit (`kg` oder `lbs`)                                      |
| `selectedHabitIds`| ObjectId[] | **→ HabitDefinition[]** Aktiv ausgewählte Gewohnheiten                           |
| `createdAt`       | Date       | Erstellungszeitpunkt                                                              |

**Auth-Token-Format** (Bearer-Header):

| Zustand                        | Token-Format                    |
|--------------------------------|---------------------------------|
| Migration (noch kein Username) | `<uuid>`                        |
| Normaler Login                 | `<username>:<password>`         |
| Admin-Login                    | `<username>:<admin-secret>`     |

UUID-Login wird serverseitig dauerhaft abgelehnt (`UUID_BLOCKED`), sobald `username` gesetzt ist.

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

### Admin-Passwort zurücksetzen – `scripts/reset-admin-password.js`

Setzt das Admin-Passwort direkt in der Datenbank zurück, ohne dass das aktuelle Passwort
bekannt sein muss. Nützlich bei vergessenem Admin-Secret.

**Was es tut:**
1. Verbindet sich mit MongoDB über `MONGODB_URI` aus `.env`
2. Sucht den Admin-Account (Feld `isAdmin: true`)
3. Zeigt UUID und Username des gefundenen Accounts zur Bestätigung an
4. Fragt zweimal nach dem neuen Passwort (kein Echo im Terminal)
5. Hasht das Passwort mit bcrypt (12 Runden) und speichert es als `adminSecretHash`

**Verwendung:**

```bash
# Interaktiv (empfohlen) – Passwort wird versteckt eingegeben
node scripts/reset-admin-password.js

# Alternativ per npm-Script
npm run admin:reset-password

# Non-interaktiv (Skripte, Pipelines)
node scripts/reset-admin-password.js --password "NeuesPasswort123"

# Via stdin (Passwort taucht nicht in der Prozessliste auf)
echo "NeuesPasswort123" | node scripts/reset-admin-password.js
```

> **Hinweis:** Das Skript nutzt **kein Pepper** – `adminSecretHash` wird immer ohne Pepper
> gehasht, nur `passwordHash` (reguläre Nutzer) verwendet den konfigurierten Pepper.
> Das Reset-Skript muss daher nicht angepasst werden, wenn sich der Pepper ändert.

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
