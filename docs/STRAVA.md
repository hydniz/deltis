# Strava Integration — Setup & Operations Guide

Deltis can sync activities from Strava per user: full activity details,
heart-rate zones and streams (no GPS tracks). New activities arrive via
webhook (instant) and/or polling (fallback); on first connect the last
7 days are backfilled. Users can then define goals like *"3× cardio per
week"* with their own criteria (sport types, duration, heart-rate ranges,
Strava HR zones, …).

**Architecture note**: the actual Strava-API polling now happens in the
separate [`deltis-strava-integration`](https://github.com/hydniz/deltis-strava-integration)
plugin, not in this server's process — see
[`docs/plugins/MANIFEST.md`](plugins/MANIFEST.md) "The Strava plugin". The
setup steps below (Strava application, callback domain, credentials,
webhook subscription) are unchanged; only `STRAVA_POLL_INTERVAL_MINUTES`
below is now vestigial (the plugin has its own interval instead).

---

## 1. Create the Strava API application

1. Log in at Strava and open <https://www.strava.com/settings/api>.
2. Create an application. Relevant fields:
   - **Authorization Callback Domain** — the bare domain of your instance,
     no protocol, no path, no port. For an instance at
     `https://deltis.jlno.de` enter exactly:

     ```
     deltis.jlno.de
     ```

     `localhost` is additionally always allowed by Strava, so local
     development works with the same application.
3. Note the **Client ID** and **Client Secret**.

## 2. Configure Deltis

Set the credentials either in the admin UI (**Administration → System →
Integrationen** — stored in the database) or via environment variables
(`.env.production` / docker-compose `environment:` — env always wins):

```bash
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=xxxxxxxxxxxxxxxx
# Public URL of the instance — required for OAuth redirects and webhooks
PUBLIC_BASE_URL=https://deltis.jlno.de
# Vestigial (see the architecture note above) — the strava-integration
# plugin's own SYNC_TICK_INTERVAL_MS controls polling now, not this.
STRAVA_POLL_INTERVAL_MINUTES=15
# Auto-generated when the webhook subscription is created — only set manually
# if you want a fixed value:
# STRAVA_WEBHOOK_VERIFY_TOKEN=...
```

## 3. Enable instant sync (webhook, recommended for public instances)

Under **Administration → Integrationen** click **"Webhook-Abo anlegen"**.
Strava validates the callback URL (`https://<host>/api/strava/webhook`)
synchronously — the instance must be publicly reachable over HTTPS at
`PUBLIC_BASE_URL` at that moment. Afterwards Strava pushes new, updated and
deleted activities within seconds.

Self-hosted instances that are **not** reachable from the internet (NAS
behind a firewall) skip this step — the poller keeps everything in sync at
the configured interval.

## 4. Users connect their accounts

Each user connects under **Einstellungen → Strava** ("Mit Strava
verbinden"). Requested scopes: `read,activity:read_all` (includes private
activities). On first connect the activities of the last 7 days are
imported automatically.

---

## What is stored

Per activity (collection `stravaactivities`):

- the complete **detailed activity** payload (`detail`, lossless),
- the **heart-rate zones** payload (`zones`),
- all **streams** except `latlng`: time, heartrate, velocity, distance,
  altitude, cadence, watts, temp, moving, grade (`streams`),
- promoted top-level fields for fast queries (sport type, dates, times,
  distance, HR, …).

GPS tracks (`latlng` streams) are deliberately **not** fetched or stored:
they are large, privacy-sensitive and not needed for any goal criterion.
Access/refresh tokens are stored with `select: false` and never leave the
server or appear in logs.

~3 API requests are spent per synced activity (detail + zones + streams).

---

## Strava API limits — read this before inviting users

### One-athlete limit for new applications

A newly created Strava API application may only be authorized by **one
athlete** — the app owner. Additional users will get an error from Strava
when trying to connect. To raise the limit you must request a capacity
increase from Strava (Settings → API application → athlete capacity /
Strava Developer Program form). Plan for this **before** opening your
instance to other users; approval can take a while.

### Rate limits

Default per application: **100 requests / 15 minutes** and
**1,000 requests / day** (Strava may grant more together with a capacity
increase). Deltis needs ~3 requests per activity plus 1 per activity-list
poll per connected user. Practical guidance:

- With webhooks enabled, raise `STRAVA_POLL_INTERVAL_MINUTES` (e.g. 360) —
  polling is then only a safety net.
- With polling only and many users, keep the interval ≥ 15 minutes.
- On HTTP 429 Deltis aborts the current sync run and resumes with the next
  poll/webhook event (an overlap window prevents gaps).

### Terms of the Strava API Agreement (commercial operation!)

Deltis is self-hostable open source, and you may also run a paid, hosted
instance — but the **Strava API Agreement** imposes conditions that are
your responsibility as the operator of the API application:

- **Privacy of Strava data:** a user's Strava data may only be shown to
  that user. Deltis follows this (activities are strictly per-user) — keep
  it that way in customizations (no leaderboards/feeds from Strava data).
- **Commercial use restrictions:** the API agreement restricts using the
  API for paid products without Strava's consent. If you charge customers
  for a service whose value includes Strava sync, review the current
  agreement (<https://www.strava.com/legal/api>) and contact Strava about a
  partnership/commercial approval before launch.
- **No AI training:** Strava data must not be used to train ML/AI models.
- **Branding:** show "Powered by Strava" / "Compatible with Strava" and
  follow the brand guidelines when displaying Strava data. Deltis ships a
  minimal "Powered by Strava" note; add the official logos per Strava's
  brand assets if you customize the UI.
- **Data deletion:** when a user deauthorizes the app (webhook event or
  "Trennen" in Deltis), stored Strava data should be removed on request —
  the disconnect dialog offers exactly that (purge option).

**Per-instance credentials:** every self-hosted instance must use its
*own* Strava API application (client ID/secret). Do not ship or share one
client secret across instances — capacity and rate limits are per
application, and the secret would leak.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Strava ist nicht konfiguriert" | Client ID/secret missing — set them in the admin UI or `.env` |
| Callback shows `strava=athlete-taken` | The Strava account is already linked to another Deltis user |
| Callback shows `strava=scope` | User unchecked activity permissions on the Strava consent screen |
| Second user cannot authorize at Strava | One-athlete limit — request a capacity increase (see above) |
| Webhook creation fails | `PUBLIC_BASE_URL` wrong or instance not reachable over HTTPS from the internet |
| Activities missing HR criteria matches | Activity has no heart-rate data, or zones require the athlete's HR zones to be configured at Strava |
| Sync stops mid-run | Rate limit (429) — the next poll/webhook resumes; check `lastSyncError` in Einstellungen → Strava |
