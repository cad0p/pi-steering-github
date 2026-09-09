# Changelog

All notable changes to `pi-steering-github` are documented in this file.

## [Unreleased]

- **Breaking (pre-1.0)**: migrate to core `@cad0p/pi-steering@0.2.0-20260908.1` command-first bash rules (closes #55). Every rule routes on `command: "gh"` + `when.subcommand` sequences; bash `pattern:`/`field:` are gone. The `^gh\s+` anchor family (`LEADING_FLAG_PAIRS`, `PR_BODY_ANCHOR`, `PR_CREATE_ANCHOR`, `PR_MERGE_ANCHOR`, `ISSUE_BODY_ANCHOR`, `REPO_CREATE_ANCHOR`, `REPO_FLAG_ANCHOR`, `REPO_CREATE_PATTERN`, `REPO_CREATE_SEED_FLAG`) is retired and no longer exported. The seed exemption is the declarative `not.flag` leaf (the front negative-lookahead is gone); `foreignRepoTarget` reads the bound `ctx.command` facade and takes core `BooleanLeafArgs`. Deltas, all pinned: quoted-value seed lookalikes now BLOCK (the documented false-exemption hole closes); `-local`/`-p`-glued forms exempt via pflag-faithful table glue (gh rejects both lines at runtime); uppercase `GH` no longer routes (basename-exact); title/body inline reads go last-wins like gh/cobra.
- Own the `gh` CLI descriptor via `Plugin.cliDescriptors` (closes #61): `GH_CLI_DESCRIPTOR` (`globals-anywhere` + the per-binary flag table) backs subcommand extraction, the `flag:` leaf, and the facade.
- Fix the label-only edit over-block (closes #44): the vault-body policy applies to an `edit` only when the command writes the body — `gh issue edit 8845 --add-label bug` and `gh pr edit 46 --title …` pass without the substitution; body-carrying edits stay gated.
- Interim: `infoOnly` + `requiresFlagValue` vendored into this plugin under the same `when` key names — no `@cad0p/pi-steering-flags` publish works with this core yet, so the flags dependency is removed until it republishes with #117 support (then the vendored copies delete and `flagsPlugin` returns; keys and shapes don't change).
- Initial release: the `github` plugin for pi-steering, promoted from the live global-config prototype (2026-08-14) — PR issue-link policy + napkin vault body-file policy.
