# Publishing a Deltis Plugin

Deltis has two plugin catalogs, both served from the same central store
(`deltis-store.jlno.de`, backed by
[`deltis-store-backend`](https://github.com/hydniz/deltis-store-backend)) —
every self-hosted instance talks to this one store regardless of where it's
deployed, so the review guarantees below hold for every installation.

## Verified Store

The verified store only ever contains plugins **hydniz has personally
reviewed**, version by version. The flow:

1. Submit your plugin's source repository and the git ref you want reviewed.
2. hydniz reviews the code at that ref.
3. On approval, the reviewed version is **rebuilt from that exact source and
   republished under hydniz's own registry namespace** — the artifact users
   install is always the one that was reviewed, never whatever happens to be
   at a third party's registry/repo at install time.
4. The new version appears in the verified catalog with a review date and
   the reviewed commit.

Only hydniz can publish to the verified store. This is a manual,
per-version gate by design — there is no automated "publish" path.

## Community Store

The community store is just an index of GitHub repositories that each
contain a valid `deltis-plugin.json` (see
[`docs/plugins/MANIFEST.md`](MANIFEST.md)) at their root. Nothing is
rebuilt or rehosted — the store backend only:

- Validates the manifest against the schema.
- Records repo metadata (description, stars, latest tagged release).
- Re-checks periodically so a repo that goes stale/removed drops out of the
  catalog.

**No code review happens for community plugins.** Every community listing —
in the catalog and again on the install/consent screen — carries a
non-dismissable warning that this is unreviewed third-party code, and
installing it is only advisable if you trust the author.

To submit: `POST` your repo URL to the community store's submission
endpoint (see the store backend's own README) with a tag pointing at the
commit containing your manifest.

## Either way

- Both catalogs use the exact same install pipeline, sandbox
  (container-per-plugin, capability-scoped Host API — see
  [`docs/plugins/MANIFEST.md`](MANIFEST.md)) and two-level consent flow. The
  *only* difference between the two stores is review status and where the
  artifact came from.
- Bump `version` (and re-declare `capabilities` if they changed) for every
  release — a capability change always re-triggers consent for every
  instance/user that already installed/granted an earlier version.
- Keep `id` stable forever once published — it's how installs, grants and
  updates are tracked.
