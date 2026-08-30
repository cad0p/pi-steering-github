# Changelog

All notable changes to `pi-steering-github` are documented in this file.

## [Unreleased]

- Initial release: the `github` plugin for pi-steering, promoted from the live global-config prototype (2026-08-14) — PR issue-link policy + napkin vault body-file policy.
- Feature: the two body-file rules' block reason is now a dynamic diagnostic (closes #43) — a `--body-file` substitution that deviates from the pinned perl one-liner reports the byte-exact divergence (byte offset + `- expected:` / `+ got:` span pair) for program byte-swaps, the positional token report for token-count deviations, and the full-line command pair for far-apart edits / different tools; byte-exact forms keep the canonical static recipe verbatim. Verdicts unchanged.
