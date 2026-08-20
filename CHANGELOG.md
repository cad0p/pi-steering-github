# Changelog

All notable changes to `pi-steering-github` are documented in this file.

## [Unreleased]

- Internal: restructured `src/` to the canonical `examples/work-item-plugin` layout — one file per rule / predicate / helper concern (`src/rules/*`, `src/helpers/*`). Zero behavior change, zero public-API change (pure structural refactor, mirrors cad0p/pi-steering#63).
- Initial release: the `github` plugin for pi-steering, promoted from the live global-config prototype (2026-08-14) — PR issue-link policy + napkin vault body-file policy.
