# Plugins & Add-ons

Deltis can be extended with user-programmed plugins that integrate deeply
with the core app (reading/writing habits, activities, goals, contributing
dashboard widgets, receiving webhooks, …) while keeping every plugin at
**minimal privilege** by default — a plugin only ever gets exactly the
capabilities it declared and a user explicitly accepted.

- **Writing a plugin?** Start with
  [`docs/plugins/MANIFEST.md`](plugins/MANIFEST.md) (the manifest schema and
  full capability vocabulary) and
  [`docs/plugins/PUBLISHING.md`](plugins/PUBLISHING.md) (verified vs.
  community store submission).
- **REST reference** for the admin/install/grant endpoints and the internal
  Plugin Host API a running plugin talks to: [`docs/api/plugins.md`](api/plugins.md).

## The short version

- Every plugin runs as its **own isolated Docker container** — no direct
  database, filesystem or host access. It can only reach Deltis through a
  capability-scoped internal API.
- Consent is **all-or-nothing but fully transparent**: before install (and
  again before any individual user starts using it with their own data),
  you see the exact plain-language list of what it can do, and either accept
  all of it or don't install it. There is no partial grant.
- Installing a plugin instance-wide (an admin action) does **not** expose
  any user's personal data — each user must separately grant it to their
  own account, exactly like connecting a personal Strava account today.
- Two catalogs, both served from the same central, hydniz-managed store
  (`deltis-store.jlno.de`) regardless of where your instance is hosted:
  - **Verified** — every version hand-reviewed by hydniz and rebuilt onto
    hydniz's own infrastructure before it's installable.
  - **Community** — an index of GitHub repos, unreviewed, clearly and
    repeatedly flagged as such.
- Strava is being migrated to this system as the first verified plugin —
  see [`docs/plugins/PUBLISHING.md`](plugins/PUBLISHING.md).
