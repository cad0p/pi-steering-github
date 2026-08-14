# pi-steering-github

GitHub workflow rules for [pi-steering](https://github.com/cad0p/pi-steering): every PR closes at least one issue; PR/issue bodies come from napkin vault body files.

Ported from the live prototype that ran in the global pi-steering config (first live validation 2026-08-14, pi-steering PR #46 session: create gate fired, agent complied in 7s). Reason strings are byte-identical to the prototype — agents in the wild rely on them.

## What it ships

One `Plugin` (`name: "github"`) with four rules and one predicate:

| Rule | Fires on | Blocks when |
| --- | --- | --- |
| `pr-body-from-vault-file` | `gh pr create \| new \| edit` | the body doesn't come from `--body-file` pointing at a `<repo>/prs/` napkin-vault file (inline `--body` is blocked) |
| `pr-create-needs-issue-link` | `gh pr create \| new` | the `--title` value or the body lacks a closing keyword + `#N` |
| `pr-merge-needs-closing-keywords` | `gh pr merge` | `--subject` or `--body` lacks a closing keyword + `#N` |
| `issue-body-from-vault-file` | `gh issue create \| edit` | the body doesn't come from `--body-file` pointing at a `<repo>/issues/` napkin-vault file |

| Predicate | Purpose |
| --- | --- |
| `missingVaultBodyFile` | true when `--body-file` is absent, unreadable, outside a napkin vault, or not under `<repo>/<section>/` inside the vault (fail-closed) |

All rules are **strict** — no `noOverride: false`, so there is no agent-side override escape hatch. The policy is unconditional.

## Install

```bash
pnpm add @cad0p/pi-steering-github
```

`@cad0p/pi-steering-github` declares `@cad0p/pi-steering` as a `peerDependency` and pulls `@cad0p/pi-napkin` as a **runtime dependency** (the vault rules use its `./steering` subpath for napkin-vault detection — compiled JS since 0.7.0-20260814.0). Non-napkin users can disable the two vault body-file rules (see [Disabling](#disabling)) — the `@cad0p/pi-napkin` dep stays but is inert.

## Usage

```ts
// .pi/steering/index.ts
import { defineConfig } from "@cad0p/pi-steering";
import githubPlugin from "@cad0p/pi-steering-github";

export default defineConfig({
  plugins: [githubPlugin],
});
```

Listing the plugin feeds its rule/predicate names into `defineConfig`'s type unions, so `disabledRules` typos fail at compile time.

## Rules

### `pr-body-from-vault-file`

`gh pr create|new|edit` must take the body from `--body-file` pointing at a file **inside a napkin vault** under a `<repo>/prs/` directory. Inline `--body` is blocked entirely.

Placement only — no content check. The closing-keyword content check belongs to `pr-create-needs-issue-link` (responsibility separation). Why vault body files: they are reviewable, persistent, and kb-discoverable — the body is written and reviewed *before* the command runs, so the PR description is a deliberate artifact rather than an inline afterthought.

### `pr-create-needs-issue-link`

`gh pr create|new` must carry a closing keyword (`close`/`closes`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`) + `#N` in **both** the inline `--title` value and the body. The body normally comes from the vault body file, so the check reads the file content (falling back to inline `--body` text).

- **Title keyword** — the squash-merge subject inherits the PR title, so even a web-UI merge with a Title-Only commit policy auto-closes the issue from the commit subject.
- **Body keyword** — drives the GitHub "linked issues" sidebar link and the description-channel auto-close on merge.
- **Multiple issues** — repeat the keyword per issue (`"Closes #A, closes #B"`); `"Closes #A #B"` honors only the first number. A bare `#N` mention never counts; colons and case variants are accepted.
- Draft PRs are gated like any other PR (a tracking issue is the allowed pattern while a draft is open).

### `pr-merge-needs-closing-keywords`

`gh pr merge` must carry a closing keyword + `#N` in **both** the `--subject` value (commit subject) and the `--body` value (commit body) — either flag order, short `-t`/`-b` forms, `--flag=value` forms. Passing both explicitly protects against PR title/body edits between creation and merge; GitHub parses both channels even with a Title-Only commit policy.

### `issue-body-from-vault-file`

`gh issue create|edit` must take the body from `--body-file` inside a napkin vault under a `<repo>/issues/` directory. No keyword requirement — issues close nothing.

## Predicate

`when.missingVaultBodyFile` takes `{ section: "prs" | "issues" }` and returns `true` (rule blocks) when the command's `--body-file` value is missing, unreadable, outside a napkin vault, or not under `<repo>/<section>/` inside the vault. `<repo>` is the origin URL basename of the git repo the command runs in (falling back to the cwd folder name when the remote is unresolvable). Fail-closed: anything unverifiable counts as missing — including a walker-unknown cwd (`cd "$X" && gh pr create ...`).

## Disabling

Strict rules are still individually disableable at the config level:

```ts
export default defineConfig({
  plugins: [githubPlugin],
  // Keep the issue-link policy but allow inline --body anywhere.
  disabledRules: ["pr-body-from-vault-file", "issue-body-from-vault-file"],
});
```

**Non-napkin users** (no obsidian vault) should disable the two vault body-file rules and keep the keyword rules — `pr-create-needs-issue-link` then falls back to inline `--body` text, and `pr-merge-needs-closing-keywords` is self-contained:

```ts
disabledRules: ["pr-body-from-vault-file", "issue-body-from-vault-file"],
```

## Helpers (escape-hatch)

When the built-in predicate isn't enough, reach for the exported helpers inside `when.condition`:

- `findFlagValue(ctx, flags)` — value of the first occurrence of a flag (space or `=` form), unquoted.
- `resolveAgainstCwd(ctx, path)` — resolve a path against the command's effective cwd (`null` on walker-unknown cwd).
- `bodyHasClosingKeyword(ctx)` — does the body (vault body-file content, or inline `--body`) carry a closing-keyword ref?
- `repoName(ctx, cwd)` — origin URL basename, cwd-basename fallback.
- `unquote(text)` / `argText(ctx)` — low-level walker-word utilities.

The pattern constants (`CLOSING_KEYWORD`, `ISSUE_REF`, `TITLE_WITH_REF`, `SUBJECT_WITH_REF`, `BODY_WITH_REF`, `PR_BODY_ANCHOR`, `PR_CREATE_ANCHOR`, `PR_MERGE_PATTERN`, `ISSUE_BODY_ANCHOR`) are exported too — they are what the rules ship, pinned by the unit tests.

## Known limitations

- **Inline `--body` is blocked** by the vault body-file rules by design — the file is the source of truth. If you need inline bodies, disable those rules.
- **`--body-file` content is checked at eval time** by `pr-create-needs-issue-link` / `pr-merge-needs-closing-keywords`: the file must already contain the closing keyword when the command runs. `pr-merge-needs-closing-keywords` additionally has no `--body-file` support — merge commit messages must be passed explicitly via `--subject` / `--body`.
- **Value-region truncation**: pattern matching runs on the walker-normalized command, and a flag's value region ends at the next `\s-` pair. A value containing a literal ` - ` (space-dash-space) truncates the region, so a closing-keyword ref after such a sequence may be missed (rule fires; add the keyword earlier in the value).

## License

MIT
