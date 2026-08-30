# Changelog

All notable changes to this project will be documented in this file.

## [calver-released]

<!-- USER-EDITABLE SECTION START -->
<!-- Add your curated release notes here. -->
<!-- USER-EDITABLE SECTION END -->

### 🚀 Features

- Gh repo create must seed the repo — bootstraps go through PRs (closes #7)
- Strip frontmatter and heading from vault body files on gh upload (closes #3)
- Glue-aware -R target resolution — drop the glued-short over-block (closes #27)
- *(rules)* Foreign-target gate follows -R/--repo presence, not command shape (closes #39)
- *(rules)* Lift the REPO_FLAG_ANCHOR leading-flag cap (? → *) — route any number of leading flag(+value) pairs (closes #41)
- *(rules)* Dynamic byte-diff block reason for the body-file rules (closes #43)

### 🐛 Bug Fixes

- Correct reason-string quirks — issues/ path hint + merge grammar (closes #4)
- Restore vault path validation in missingVaultBodyFile (closes #12)
- *(rules)* Merge gate requires the closing keyword in --subject only (closes #15)
- (closes #17) pr-merge gate must not block gh pr merge --help
- *(rules)* Ship gh-repo-flag-before-subcommand — roster missing the -R gate (closes #19)

### 🚜 Refactor

- *(rules)* Adopt @cad0p/pi-steering-flags for the -R redirect gate (closes #19)
- Adopt token-level info-only carve-out (closes #24)
- Src/ per-item layout (work-item-plugin structure) (closes #31)
- *(rules)* Declarative merge gate + cross-alias last-wins repo target (closes #23, closes #34)
- *(rules)* Extract foreignRepoTarget registered predicate, declarative repo target gate (closes #36)

### 📚 Documentation

- Fix stale H1-kept comments — the H1 is stripped too (closes #3)


## [Unreleased]

- Initial release: the `github` plugin for pi-steering, promoted from the live global-config prototype (2026-08-14) — PR issue-link policy + napkin vault body-file policy.
