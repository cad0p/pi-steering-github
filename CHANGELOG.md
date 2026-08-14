# Changelog

All notable changes to `pi-steering-github` are documented in this file.

## [Unreleased]

- **Breaking**: vault body files must be uploaded through the strip helper — `--body-file <(pi-steering-github strip <vault-file>)` — which removes the note's YAML frontmatter + leading H1 before `gh` uploads the content. Direct `--body-file` vault paths now block (they uploaded frontmatter + H1 verbatim). Ships the `pi-steering-github strip` bin; vault notes stay byte-identical (the rules only read).
- Initial release: the `github` plugin for pi-steering, promoted from the live global-config prototype (2026-08-14) — PR issue-link policy + napkin vault body-file policy.
