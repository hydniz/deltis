# Sicherheit & Authentifizierung

Dokumentation des Authentifizierungssystems, der Passwort-Sicherheit und der
verfügbaren Administrationswerkzeuge.

---

## Authentifizierungsmodell

### Reguläre Nutzer

Nach der einmaligen Migration melden sich Nutzer mit **Benutzername + Passwort** an.

| Phase          | Login-Methode                        | Token-Format im Bearer-Header  |
|----------------|--------------------------------------|--------------------------------|
| Migration      | UUID (kein Passwort erforderlich)    | `<uuid>`                       |
| Nach Migration | Benutzername + Passwort              | `<username>:<password>`        |

Die UUID wird **dauerhaft gesperrt**, sobald ein Benutzername gesetzt wurde. Der Server
lehnt UUID-Logins dann mit `HTTP 401 / code: UUID_BLOCKED` ab.

### Admin

| Login-Methode                    | Token-Format                      |
|----------------------------------|-----------------------------------|
| Benutzername + Admin-Secret      | `<username>:<admin-secret>`       |

Das Admin-Secret ist unabhängig vom regulären Nutzerpasswort und wird separat in
`adminSecretHash` gespeichert. Es unterliegt **nicht** dem Pepper-Mechanismus.

### Migrations-Ablauf (Bestandsnutzer)

1. Nutzer gibt UUID im Login-Feld ein, Passwort-Feld bleibt leer
2. Erfolgreicher Login (Server: kein `passwordHash` → Migration-Modus)
3. Modal erscheint: Benutzername + Passwort wählen (Admin: nur Benutzername)
4. Nach Speichern: UUID ist gesperrt, `localStorage`-Token wird auf `username:password` aktualisiert
5. Alle künftigen Logins: Benutzername + Passwort

---

## Passwort-Sicherheit: Pepper

### Was ist ein Pepper?

Ein **Pepper** ist ein servergespeichertes Geheimnis, das vor dem Hashing an jedes
Passwort angehängt wird:

```
gespeicherter Hash = bcrypt( plaintext + pepper, rounds=12 )
```

Im Gegensatz zum Salt (zufällig, pro Passwort, in der DB gespeichert) ist der Pepper
**nicht in der Datenbank** enthalten. Selbst wenn ein Angreifer die vollständige
Datenbank erbeutet, kann er Passwörter nicht offline cracken – dazu bräuchte er
zusätzlich den Pepper.

### Pepper konfigurieren

In der `.env`-Datei eine der folgenden Optionen setzen:

#### Option A: Datei (empfohlen)

```env
PEPPER_FILE=/run/secrets/habit_tracker_pepper
```

Pepper-Datei erzeugen (einmalig):

```bash
# 48 Bytes = 64 Base64-Zeichen, kryptografisch sicher
openssl rand -base64 48 > /run/secrets/habit_tracker_pepper
chmod 600 /run/secrets/habit_tracker_pepper
```

Der Pfad sollte **außerhalb** des Projektverzeichnisses liegen und nicht in Git landen.

#### Option B: Umgebungsvariable

```env
PASSWORD_PEPPER=dein_sehr_langes_zufaelliges_geheimnis_hier
```

Weniger sicher als Option A, da der Wert in Prozesslisten und Logs auftauchen kann.

#### Kein Pepper (nicht empfohlen)

Ohne Konfiguration startet der Server mit einer Warnung. Passwörter werden nur mit
bcrypt ohne Pepper gehasht. Funktional korrekt, aber schwächer gegen DB-Leaks.

### Wichtige Hinweise

> **KRITISCH: Den Pepper niemals ändern oder löschen**, solange Nutzerkonten existieren.
> Alle bestehenden Passwort-Hashes werden ungültig und Nutzer können sich nicht mehr anmelden.
> Bei notwendiger Rotation müssten alle Nutzer ihre Passwörter zurücksetzen.

> **Docker/NAS:** Bei Docker Deployments kann der Pepper über Docker Secrets bereitgestellt
> werden (z. B. `/run/secrets/habit_tracker_pepper`) – die Datei wird dann automatisch
> in den Container gemountet ohne im Image oder in der Compose-Datei aufzutauchen.

---

## Admin-Passwort zurücksetzen

Falls das Admin-Passwort vergessen wurde, kann es direkt gegen die Datenbank zurückgesetzt
werden – ohne Kenntnis des aktuellen Passworts.

### Voraussetzungen

- Zugriff auf das Dateisystem des Servers (SSH oder lokal)
- `MONGODB_URI` in `.env` muss auf die laufende Datenbank zeigen
- Node.js und die Projektabhängigkeiten (`npm install`) müssen installiert sein

### Verwendung

**Interaktiv** (empfohlen – Passwort wird nicht angezeigt):

```bash
node scripts/reset-admin-password.js
```

Ausgabe:
```
── Admin-Passwort zurücksetzen ──────────────────────────
Datenbank: mongodb://localhost:27017/habit_tracker

Admin-Account gefunden:
  UUID:     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Username: admin

Neues Admin-Passwort:  
Passwort bestätigen:   
Admin-Passwort wurde erfolgreich zurückgesetzt.
```

**Per npm-Script:**

```bash
npm run admin:reset-password
```

**Non-interaktiv** (Skripte, CI, Pipelines):

```bash
# Als Argument (taucht in Prozessliste auf – vermeiden in geteilten Umgebungen)
node scripts/reset-admin-password.js --password "NeuesPasswort123"

# Via stdin (sicherer – Passwort nicht in Prozessliste)
echo "NeuesPasswort123" | node scripts/reset-admin-password.js
```

### Anforderungen ans Passwort

- Mindestens **8 Zeichen**
- Keine weiteren Einschränkungen

### Technischer Hinweis

Das Reset-Skript verwendet **kein Pepper** – `adminSecretHash` wird immer mit reinem
bcrypt gehasht (wie vom Admin-Setup und der bestehenden Admin-Auth erwartet).
Nur `passwordHash` (reguläre Nutzer) enthält den Pepper. Das Skript funktioniert daher
unabhängig von der Pepper-Konfiguration.

---

## API-Endpunkte (Auth)

| Methode | Pfad                   | Auth | Beschreibung                                           |
|---------|------------------------|------|--------------------------------------------------------|
| `GET`   | `/api/auth/me`         | ✓    | Gibt das eigene User-Objekt zurück                     |
| `PUT`   | `/api/auth/me`         | ✓    | Aktualisiert Name und Gewichtseinheit                  |
| `PUT`   | `/api/auth/me/username`| ✓    | Setzt Benutzernamen (+ Passwort beim ersten Mal)       |
| `PUT`   | `/api/auth/me/password`| ✓    | Ändert das Passwort (erfordert aktuelles Passwort)     |

### `PUT /api/auth/me/username`

Beim ersten Aufruf (kein `passwordHash` vorhanden): setzt Benutzername **und** Passwort.
Bei nachfolgenden Aufrufen: ändert nur den Benutzernamen.

**Body:**
```json
{
  "username": "max_muster",
  "password": "MeinPasswort123"
}
```

Benutzername-Validierung: `^[a-z0-9_.\-]+$`, 3–30 Zeichen, unique (case-insensitive gespeichert).

### `PUT /api/auth/me/password`

Nur für reguläre Nutzer (nicht Admin – Admins nutzen `/api/admin/password`).

**Body:**
```json
{
  "currentPassword": "AltesPasswort",
  "newPassword": "NeuesPasswort123"
}
```

Nach erfolgreichem Ändern muss der Client den `localStorage`-Token auf
`username:neuesPasswort` aktualisieren (der `AuthContext` erledigt das automatisch über
`changePassword()`).
