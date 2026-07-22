# Deltis Plugin Manifest (`deltis-plugin.json`)

Every Deltis plugin ships a `deltis-plugin.json` manifest at the root of its
repository. The manifest is the single source of truth for what a plugin is
and what it may access — nothing a plugin does is possible without first
being declared here, validated, and explicitly accepted by a user.

The validator lives at `server/services/pluginManifest.js` in the
[`deltis`](https://github.com/hydniz/deltis) repo, and is duplicated in
[`deltis-store-backend`](https://github.com/hydniz/deltis-store-backend) for
submission-time validation. Keep both in sync if you change this document.

## Shape

```json
{
  "manifestVersion": 1,
  "id": "strava-integration",
  "name": "Strava",
  "version": "1.0.0",
  "description": "Synchronisiert Aktivitäten von Strava.",
  "author": "hydniz",
  "homepage": "https://github.com/hydniz/deltis-strava-integration",
  "capabilities": [
    "habits:read",
    "activities:write",
    "goals:read",
    "network:api.strava.com",
    "network:www.strava.com",
    "ui:dashboard-widget",
    "ui:settings-panel",
    "ui:goal-criteria-provider",
    "background:webhook-receiver",
    "notifications:send"
  ],
  "runtime": {
    "type": "docker",
    "image": "ghcr.io/hydniz/deltis-strava-integration:1.0.0"
  },
  "compatibility": {
    "testedCoreVersion": "0.6.0",
    "minHostApiVersion": 1
  }
}
```

| Field | Type | Rules |
|---|---|---|
| `manifestVersion` | integer | Must be `1`. |
| `id` | string | Lowercase kebab-case, 3–64 chars (`a-z0-9-`), must not start with `-`. Stable identity of the plugin — never changes across versions. |
| `name` | string | Display name shown to users. |
| `version` | string | Semver (`MAJOR.MINOR.PATCH[-prerelease]`). |
| `description` | string | One sentence, shown on the consent screen and in the catalog. |
| `author` | string | Your name/handle. |
| `homepage` | string | Optional link to the plugin's repo/docs. |
| `capabilities` | string[] | Non-empty, no duplicates, every entry from the vocabulary below. This is exactly what the "accept all or cancel" consent screen shows the user — nothing more is ever granted. |
| `runtime.type` | string | Currently only `"docker"`. |
| `runtime.image` | string | A valid Docker image reference. For the verified store this is the image *hydniz rebuilt and republished* after review — never a third party's arbitrary registry at install time. |
| `compatibility` | object | Optional. See "Compatibility checking" below. |
| `compatibility.testedCoreVersion` | string | Optional. Semver of the Deltis core version this plugin version was last tested against. |
| `compatibility.minHostApiVersion` | integer | Optional. Minimum Plugin Host API version (`GET /api` → `pluginHostApiVersion`) this plugin needs. |

## Capability vocabulary

A plugin only gets what it declares here — nothing is implicit, nothing is
inherited. Declaring a capability is necessary but not sufficient: an
instance admin must still install the plugin, and each individual end user
must still separately grant it before it can touch *their* data (see
"Two-level consent" below).

| Capability | Grants |
|---|---|
| `habits:read` | Read the granting user's habit definitions and logged entries. |
| `habits:write` | Create habits / log entries for the granting user. |
| `activities:read` | Read the granting user's logged activities. |
| `activities:write` | Create/modify activities for the granting user. |
| `goals:read` | Read the granting user's goals and progress. |
| `goals:write` | Create/modify goals for the granting user. |
| `planner:read` | Read the granting user's weekly plan. |
| `planner:write` | Add entries to the granting user's weekly plan. |
| `weight:read` | Read the granting user's weight history. |
| `weight:write` | Log weight entries for the granting user. |
| `user:read` | Read the granting user's name and username. **Never** the password hash, pepper, session tokens or any other secret — these are not exposed to any capability, ever. |
| `ui:dashboard-widget` | Contribute a widget to the dashboard (rendered in a sandboxed iframe, never with direct DOM/session access to the main app). |
| `ui:settings-panel` | Contribute a panel under Settings → Integrations. |
| `ui:goal-criteria-provider` | Offer custom conditions in the goal-creation flow (the same seam Strava's criteria builder already uses today). |
| `background:cron` | Run on a recurring schedule inside the plugin's own container. |
| `background:webhook-receiver` | Receive webhooks from an external service (the plugin's own container exposes the receiver — Deltis does not proxy arbitrary inbound traffic to it). |
| `notifications:send` | Send the granting user a notification. |
| `network:<domain>` | Outbound network access to exactly `<domain>` (e.g. `network:api.strava.com`). One capability per distinct host — there is no wildcard. |

## Two-level consent

Installing a plugin and using it with your own data are two separate steps:

1. **Instance install** (admin-only): an admin browses the catalog, reviews
   the capability list, and installs the plugin instance-wide. This
   provisions the plugin's container — it does **not** expose any user's
   data yet.
2. **Per-user grant**: each individual user who wants to use the plugin
   reviews the same capability list and grants it themselves, scoped to
   their own account only — exactly how connecting a personal Strava account
   works today. An admin installing a plugin never silently exposes another
   user's habits, activities, goals, etc.

Both steps use the same UI pattern: **accept all capabilities, or cancel** —
there is no partial-acceptance option. What's granted is always exactly the
manifest's `capabilities` array; enforcement is fully granular underneath
regardless of the simple yes/no consent UI. Any capability change on a
plugin update re-triggers both levels of consent.

## Compatibility checking

Deltis and a plugin can each check whether they're compatible with the
other:

- **Core → plugin**: on every server boot and on every call to
  `GET /api/plugins/installed` / `GET /api/plugins/available`,
  `server/services/pluginCompatibility.js` compares each installed plugin's
  declared `compatibility.testedCoreVersion`/`minHostApiVersion` against the
  running core's actual version and Plugin Host API version
  (`GET /api` → `pluginHostApiVersion`). A mismatch produces a German warning
  string — surfaced in both API responses (`compatibilityWarnings: string[]`)
  and the server log (`server/utils/logger.js`, category `plugins`) — but
  never blocks the plugin from running. Omitting `compatibility` entirely is
  valid; it just means no automated check is possible for that plugin.
- **Plugin → core**: a plugin container can perform the same check itself by
  calling the ordinary, unauthenticated `GET /api` root endpoint (reachable
  from inside the plugin network at `http://deltis-app:<port>/api/`, the
  same host the Plugin Host API URL env var points at) and comparing the
  returned `pluginHostApiVersion`/`version` against its own manifest before
  relying on Host API behaviour.

Always bump `compatibility.testedCoreVersion` (and re-test) when you release
a new plugin version — this is what "written in the repo" compatibility
tracking means in practice: the manifest in *your* repo is the record of
what you actually tested.

## Runtime & isolation

A plugin runs as its own Docker container on an isolated bridge network
(`deltis-plugins-net`), with no host mounts, no privileged mode, and no
route to the app's default network (where MongoDB lives). It has exactly one
way to reach Deltis: the **Plugin Host API**
(`/api/plugin-host/v1`, see [`docs/api/plugins.md`](../api/plugins.md)),
authenticated with a per-install bearer token, which enforces the plugin's
granted capabilities on every request.

## Known limitations (current phase)

- **Network egress is not yet firewalled at the Docker layer.** A plugin's
  `network:<domain>` capabilities are recorded, shown to the user, and
  intended to define an egress allowlist — but the container-level
  enforcement of that allowlist (e.g. a per-plugin egress proxy or Docker
  network policy) is not implemented yet. Treat this as a hardening
  requirement before running untrusted community plugins in production.
- **Every data capability now has a working Host API route** (`habits:read/write`,
  `activities:read/write`, `goals:read` and a narrow `goals:write` — creates
  only the same single-condition "common case" goal the web/Android basic
  create form supports, not the full meta-goal/Strava-criteria/multi-condition
  surface — `planner:read/write`, `weight:read/write`, `user:read`) plus
  `notifications:send` (accepted but not yet delivered to any device — no
  push backend exists yet for web/Android). The `ui:*`/`background:*`
  capabilities still have no Host API route — there is nothing to call for
  them until the sandboxed-UI and scheduling infrastructure exists.
- **No frontend plugin-management UI yet** — installing/granting currently
  requires calling `/api/plugins/*` directly. The consent screen, sandboxed
  iframe rendering for `ui:*` capabilities, and the Android-side experience
  are tracked as follow-up work.
