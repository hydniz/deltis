# Plugins — `/api/plugins` and `/api/plugin-host/v1`

Two separate surfaces:

- **`/api/plugins`** — normal cookie-authenticated endpoints used by admins
  (browse catalogs, install/enable/uninstall) and by any user (grant/revoke
  their own access to an installed plugin).
- **`/api/plugin-host/v1`** — the internal API a *running plugin container*
  calls, authenticated with a per-install bearer token instead of a user
  cookie. See [`docs/plugins/MANIFEST.md`](../plugins/MANIFEST.md) for the
  full capability model this all enforces.

---

## Admin: catalog browsing

### `GET /api/plugins/catalog/:store`
`:store` is `verified` or `community`. Admin-only. Proxies the configured
plugin store's catalog listing (`PLUGIN_STORE_BASE_URL`, default
`https://deltis-store.jlno.de`).

### `GET /api/plugins/catalog/:store/:id`
Plugin detail including its manifest, plus `capabilityDescriptions` — the
German plain-language text shown on the consent screen for each declared
capability.

---

## Admin: install lifecycle

### `GET /api/plugins/installed`
Lists every `PluginInstall` on this instance, each with
`compatibilityWarnings: string[]` computed live against the running core
version (see [`docs/plugins/MANIFEST.md`](../plugins/MANIFEST.md#compatibility-checking)) —
empty when there's nothing to warn about.

### `POST /api/plugins/install`
Body: `{ "source": "verified"|"community", "manifest": {...}, "sourceRef": "v1.0.0" }`

The manifest is re-validated server-side regardless of what the store
already checked (defense in depth — a client-supplied manifest is never
trusted at face value). On success, provisions the plugin's container (see
[`docs/plugins/MANIFEST.md`](../plugins/MANIFEST.md) "Runtime & isolation")
and stores the install.

**Response `201`** — the created `PluginInstall` (never includes the raw
bearer token — only its hash is ever persisted).
**`400`** invalid source/manifest (with `details: string[]`).
**`409`** a plugin with this `id` is already installed.
**`502`** container provisioning failed.

### `PUT /api/plugins/:pluginId/enabled`
Body: `{ "enabled": boolean }`. Starts/stops the plugin's container
accordingly.

### `DELETE /api/plugins/:pluginId`
Removes the container, the install record, and every user's grant for it.

---

## Any user: per-user grant

### `GET /api/plugins/available`
Installed + enabled plugins, each with `capabilities` (described in
German), `granted` — whether *the calling user* has granted this plugin
access to their own data yet — and `compatibilityWarnings: string[]`.

### `POST /api/plugins/:pluginId/grant`
Grants the plugin access to the calling user's data, snapshotting the
install's current capability list. `404` if the plugin isn't installed or
is disabled.

### `DELETE /api/plugins/:pluginId/grant`
Revokes the calling user's grant (idempotent).

---

## Plugin Host API (`/api/plugin-host/v1`) — called by plugin containers only

Every request requires:

| Header | Meaning |
|---|---|
| `Authorization: Bearer <token>` | The per-install token handed to the container at provisioning time. |
| `X-Plugin-Id` | The manifest `id` this token belongs to. |
| `X-Plugin-User-Id` | The Deltis user this request acts on behalf of — required on every data route, checked against that user's own grant. |

`401` invalid/missing token or disabled install · `400` missing
`X-Plugin-User-Id` · `403` capability not granted to the plugin, or the
target user hasn't granted this plugin.

| Method & path | Capability required | Notes |
|---|---|---|
| `GET /habits` | `habits:read` | Excludes soft-deleted (trashed) habits. |
| `POST /habits` | `habits:write` | Body: `name`, `unitSymbol` (required), `type` (`amount`\|`duration`\|`boolean`, default `amount`). |
| `POST /habits/logs` | `habits:write` | Body: `habitId`, `date`, `value` (required). `404` if `habitId` doesn't belong to the granting user. |
| `GET /activities` | `activities:read` | Query: `startDate`, `endDate`, `limit` (max 500). |
| `POST /activities` | `activities:write` | Body: `activityType`, `date` (required), `duration`, `distance`, `notes`, `customValues`. Stored with `source: "plugin:<id>"` so the UI can always show what a plugin wrote. |
| `GET /goals` | `goals:read` | Active goals only. |
| `POST /goals` | `goals:write` | Body: `name`, `type`, `targetRef`, `targetRefModel`, `condition`, `targetValue` (required), `unitSymbol`, `metric`, `intervalValue`, `intervalUnit`. Only the single-condition "common case" shape — see [`docs/plugins/MANIFEST.md`](../plugins/MANIFEST.md) "Known limitations". |
| `GET /planner` | `planner:read` | Query: `startDate`, `endDate`. |
| `POST /planner` | `planner:write` | Body: `activityType`, `scheduledDate` (required), `duration`, `distance`, `notes`. Stored with `source: "plugin"`. |
| `GET /weight` | `weight:read` | Query: `limit` (max 500). |
| `POST /weight` | `weight:write` | Body: `date`, `weight` (required), `unit` (default `kg`). |
| `GET /user` | `user:read` | Returns `{ id, name, username }` only — never the password hash or any other secret. |
| `POST /notifications` | `notifications:send` | Body: `{ title }`. Accepted (`202`) but not yet delivered to any device — no push backend exists yet. |

The `ui:*`/`background:*` capabilities still have no Host API route — see
[`docs/plugins/MANIFEST.md`](../plugins/MANIFEST.md) "Known limitations".
