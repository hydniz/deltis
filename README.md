# Habit Tracker

Persönlicher Aktivitäten- und Gewohnheiten-Tracker als PWA.

## Voraussetzungen

- **Node.js** (v18+)
- **MongoDB** (lokal oder Cloud)

## MongoDB installieren (Ubuntu/Debian)

```bash
# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Repository hinzufügen
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Installieren
sudo apt-get update && sudo apt-get install -y mongodb-org

# Starten
sudo systemctl start mongod
sudo systemctl enable mongod
```

## Setup

```bash
# Abhängigkeiten installieren
npm run install:all

# .env anpassen (UUIDs und MongoDB-URL)
nano .env
```

## .env Konfiguration

```
MONGODB_URI=mongodb://localhost:27017/habit_tracker
PORT=3001
NODE_ENV=development

# Gültige Login-UUIDs (kommagetrennt)
VALID_UUIDS=f47ac10b-58cc-4372-a567-0e02b2c3d479,550e8400-e29b-41d4-a716-446655440001,6ba7b810-9dad-11d1-80b4-00c04fd430c9
```

## Starten (Entwicklung)

```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001/api

## Starten (Produktion)

```bash
npm run build
npm start
```

App läuft dann auf http://localhost:3001

## Benutzer-UUIDs

Die vordefinierten UUIDs aus der `.env` sind deine Login-Schlüssel:

| UUID | Beschreibung |
|------|--------------|
| `f47ac10b-58cc-4372-a567-0e02b2c3d479` | Benutzer 1 |
| `550e8400-e29b-41d4-a716-446655440001` | Benutzer 2 |
| `6ba7b810-9dad-11d1-80b4-00c04fd430c9` | Benutzer 3 |

Neue Benutzer: UUID zur `VALID_UUIDS` Liste in `.env` hinzufügen und Server neu starten.

## Features

- Login per UUID ohne Passwort
- Aktivitäten tracken (Gym, Joggen, Radfahren, ...)
- Wochenplaner für Aktivitäten
- Gewohnheiten tracken mit Graphen (Screen Time, Kreatin, Wasser, ...)
- Gewichtsverlauf mit Chart
- Ziele (wöchentlich & langfristig mit Zwischenschritten)
- Mehrbenutzerbetrieb
- PWA (als App installierbar)
