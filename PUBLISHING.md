# Publishing

**Status: BOOTSTRAPPED** — first release pending (PR #1). Ships as `@cad0p/pi-steering-github`.

## How releases work

This repo carries the `cad0p/semver-calver-release` workflows (`release.yml`, `validate-package-version.yml`, `validate-release-pr.yml`):

- **Push to `main` with code changes** → hybrid SemVer+CalVer prerelease (`0.1.0-YYYYMMDD.N`), tagged + GitHub prerelease, published to npm with the `next` dist-tag, draft changelog PR on `release/from-v0.1.0` updated.
- **Curated base release** (e.g. `0.1.1`): edit CHANGELOG on `release/from-v0.1.0`, bump `package.json`, merge the draft PR. Floating tags (`v0`, `v0.1`) move on base releases only.
- **Validation**: `validate-package-version` and `validate-release-pr` are required status checks on the `main` ruleset (cloned from cad0p/pi-napkin).

## npm publishing mechanics

- **OIDC trusted publishing** (npmjs.com → Access Tokens → GitHub Actions) is configured for `@cad0p/pi-steering-github`: owner `cad0p`, repository `pi-steering-github`, workflow `release.yml`. No npm tokens/secrets needed.
- The `npm-publish` action fetches the OIDC token (`audience=npm`) itself, sets the version from the release tag, runs `npm install` (pnpm on the runner for `prepare: pnpm build`), and publishes `--access public` (`--tag next` for prereleases).
- **First publish is manual**: npm OIDC cannot create brand-new package names (E404 on PUT). One manual `npm publish` (via the `npm trust github …` 5-minute window or `--auth-type=web`) creates `@cad0p/pi-steering-github`, then OIDC works forever. See the fleet runbook: goldmine `open-source/github/pi-steering/guides/npm-publish-runbook`.
- Depends on `@cad0p/pi-steering` (peer, the engine) and `@cad0p/pi-napkin` (runtime — `isNapkinVaultDir` for the vault body-file rules). No `github:` specs.
- `publishConfig.access: public` is set in the manifest.
