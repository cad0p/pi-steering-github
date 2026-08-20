# pi-steering-github

GitHub workflow rules for [pi-steering](https://github.com/cad0p/pi-steering): every PR closes at least one issue; PR/issue bodies come from napkin vault body files.

## What it ships

One `Plugin` (`name: "github"`) with six rules and one predicate:

| Rule | Fires on | Blocks when |
| --- | --- | --- |
| `gh-repo-flag-before-subcommand` | `gh -R/--repo <x/y> pr create \| new \| edit \| merge \| issue create \| edit` | the `-R`/`--repo` target is a FOREIGN repo (basename differs from the cwd repo) — redirect: run a foreign subagent maintainer loop until good, then cd into the foreign repo and target it from there |
| `pr-body-from-vault-file` | `gh pr create \| new \| edit` | the body doesn't come from `--body-file <(perl -0777 -pe '<BODY_STRIP>' <file>)` — a process substitution running the pinned perl one-liner (direct paths and inline `--body` are blocked) |
| `pr-create-needs-issue-link` | `gh pr create \| new` | the `--title` value or the body lacks a closing keyword + `#N` |
| `pr-merge-needs-closing-keywords` | `gh pr merge` | the `--subject` value lacks a closing keyword + `#N` |
| `issue-body-from-vault-file` | `gh issue create \| edit` | the body doesn't come from `--body-file` pointing at a `<repo>/issues/` napkin-vault file |
| `gh-repo-create-needs-seed` | `gh repo create \| new` | no seed flag present (`--add-readme`, `--gitignore\|-g`, `--license\|-l`, `--template\|-p`) — a bare create births an EMPTY repo |

| Predicate | Purpose |
| --- | --- |
| `missingVaultBodyFile` | true when `--body-file` is absent, not the pinned `<(perl -0777 -pe '<BODY_STRIP>' <file>)` substitution form, or the path fails the vault check (nonexistent, outside a napkin vault, not under `<repo>/<section>/`) |

All rules are **strict** — no `noOverride: false`, so there is no agent-side override escape hatch. The policy is unconditional.

## Source layout

The package mirrors the canonical `examples/work-item-plugin` layout — one file per rule / predicate / helper concern:

```
src/
├── index.ts                        # plugin assembly + declare global + re-exports
├── integration.test.ts             # end-to-end pipeline tests
├── body-strip.ts                   # the pinned perl body-strip one-liner (leaf)
├── body-strip.test.ts              # perl behavior pins (fixture matrix)
├── helpers/
│   ├── pattern-args.ts             # argText, unquote, findFlagValue, findBodyFileValue, parseBodyFileArg, resolveAgainstCwd
│   ├── pattern-args.test.ts
│   ├── body-keyword.ts             # bodyHasClosingKeyword
│   ├── body-keyword.test.ts
│   └── repo-name.ts                # repoName
├── predicates/
│   ├── index.ts                    # bundle re-exports
│   ├── missing-vault-body-file.ts  # the predicate handler
│   └── missing-vault-body-file.test.ts
└── rules/
    ├── index.ts                    # the rules roster + bundle re-exports
    ├── patterns.ts                 # pattern constants (leaf)
    ├── patterns.test.ts
    ├── command-anchors.test.ts
    ├── gh-repo-flag-before-subcommand.ts + .test.ts
    ├── pr-body-from-vault-file.ts
    ├── pr-create-needs-issue-link.ts
    ├── pr-merge-needs-closing-keywords.ts + .test.ts
    ├── issue-body-from-vault-file.ts
    └── gh-repo-create-needs-seed.ts + .test.ts
```

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

### `gh-repo-flag-before-subcommand`

`gh -R x/y pr create|new|edit|merge` and `gh -R x/y issue create|edit` target a **foreign repo** and are blocked with a redirect: run a foreign subagent maintainer loop until good, then cd into the foreign repo and target it from there. This is the ENTRY step of the foreign flow — the rule sits FIRST in the roster so the redirect is the first thing the agent meets (its `^gh\s+-…` router anchor is disjoint from the other rules' `^gh\s+(?:pr|issue|repo)` anchors, so first-match routing is unaffected).

All four typed forms are covered — `-R x/y`, `--repo x/y`, `--repo=x/y`, `-Rx/y` — plus any other flag-first form (`-v`, `--hostname`) which the router releases (not repo-targeting). The reason echoes the subcommand and the flag+target AS TYPED:

```
The PR you're targeting via -R cad0p/x belongs to a foreign repo.
REQUIREMENT: run a foreign subagent maintainer loop until good,
then cd into the foreign repo and target it from there.
```

- **Fork→upstream flow is allowed**: when the `-R` target's basename equals the cwd repo's basename (origin URL basename, cwd-folder fallback — the existing `repoName` helper), the command passes — `gh -R upstream/foo pr create` from inside the `me/foo` clone is the most common legit `-R` use. Cost accepted: `-R <own-repo> pr merge` from inside the repo is indistinguishable and slips through — these gates are heuristic discipline, not security. For fork workflows, `gh repo set-default upstream` makes gh target upstream by default (no `-R` needed).
- **Fail-closed**: unknown cwd / unresolvable repo / unparsable target → blocked.
- **Read-only `--help`/`-h` never blocks** — token-level carve-out in the rule's `unless` via `hasFlag` from `@cad0p/pi-steering-flags` (a help token inside a quoted value can't falsely exempt). The rule's flag parsing (target extraction, help carve-out) runs entirely on the walker-parsed argv via the flags helpers — the pattern is a pure router, no regex flag parsing.
- **Glued short form `-Rcad0p/x`**: the flags helpers can't see it (walker keeps it as one word) → target unparsable → fail-closed block, even for the own-repo case. Accepted over-block; upstream gap filed as cad0p/pi-steering-flags#11.
- **`repo create|new` is excluded by design**: nothing to cd into — the target is the positional argument (`gh repo create owner/name` works from any cwd, and the seed rule gates the actual create form).
- **Slashless values** (`-R upstream`, a remote-name form) route but are **released** by the `unless` (no `/` → not a foreign owner/repo redirect; the fork→upstream flow passes through unchanged).

### `pr-body-from-vault-file`

`gh pr create|new|edit` must take the body from `--body-file <(perl -0777 -pe '<BODY_STRIP>' <file>)` — a process substitution running the pinned perl one-liner, which strips the note's YAML frontmatter before `gh` uploads it. Direct paths upload the file **verbatim** (frontmatter renders on GitHub) and are blocked, like inline `--body`.

FORM + vault-path check — the substitution must be the pinned form AND the file argument must resolve to a real file inside a napkin vault, under a `<repo>/<section>/` directory (`<repo>` = origin URL basename, cwd-folder fallback). Fail-closed: anything unverifiable (missing flag, unparsable form, walker-unknown cwd, nonexistent path, outside a vault, wrong section/repo) counts as missing. The `<repo>/<section>/` convention is both taught by the rule's reason and enforced here. The closing-keyword content check belongs to `pr-create-needs-issue-link` (responsibility separation). Why vault body files: they are reviewable, persistent, and kb-discoverable — the body is written and reviewed *before* the command runs, so the PR description is a deliberate artifact rather than an inline afterthought.

### `pr-create-needs-issue-link`

`gh pr create|new` must carry a closing keyword (`close`/`closes`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`) + `#N` in **both** the inline `--title` value and the body. The body normally comes from the vault body file, so the check reads the file content (falling back to inline `--body` text).

- **Title keyword** — the squash-merge subject inherits the PR title, so even a web-UI merge with a Title-Only commit policy auto-closes the issue from the commit subject.
- **Body keyword** — drives the GitHub "linked issues" sidebar link and the description-channel auto-close on merge.
- **Multiple issues** — repeat the keyword per issue (`"Closes #A, closes #B"`); `"Closes #A #B"` honors only the first number. A bare `#N` mention never counts; colons and case variants are accepted.
- Draft PRs are gated like any other PR (a tracking issue is the allowed pattern while a draft is open).

### `pr-merge-needs-closing-keywords`

`gh pr merge` must carry a closing keyword + `#N` in the `--subject` value (commit subject) — short `-t` form, `--flag=value` forms. GitHub scans the whole squash commit message for closing keywords, so the commit subject alone closes the issues; the commit body is optional at merge. Read-only `--help`, `--version`, and GitHub's additive `-h` never block, using the token-level `isInfoOnly(args, ["-h"])` helper inside `when.condition`; attached forms (`--help=value`, `--version=1`, `-h=value`) are included, while `-v` remains gated. Because the helper examines walker-parsed argv, quoted values such as `--subject "see --help"` or `"see --version"` can't falsely exempt. An exact quoted value equal to an info token (for example `--subject "--help"`) is indistinguishable from a bare flag after quote removal and is an accepted limitation.

### `issue-body-from-vault-file`

`gh issue create|edit` must take the body from the same pinned perl substitution form (`--body-file <(perl -0777 -pe '<BODY_STRIP>' <file>)`). No keyword requirement — issues close nothing.

### The pinned frontmatter-strip one-liner

Vault notes carry YAML frontmatter; the pinned perl one-liner removes exactly that block before `gh` uploads the content (the H1 is **kept** — it is the note's title):

```bash
perl -0777 -pe 's/^(?:\xEF\xBB\xBF)?---\r?\n(?:.*?\r?\n)?(?:---|\.\.\.)\r?\n(?:\r?\n)*//s' <file>
```

The program is **byte-pinned** by the rule (the tokenizer compares the unquoted program token against the constant; quoting style is free) and its **behavior is pinned by the test suite**, which runs it against the full fixture matrix on every CI platform. Perl is one interpreter everywhere (Linux, macOS, Git Bash), so the behavior is identical on all platforms. The one-liner strips a leading `---` block (after an optional BOM) closed by the next `---` / `...` line, CRLF-tolerant, plus any immediately following blank lines; unterminated or absent frontmatter → the file passes through byte-identical. Mid-document `---` and `##` headings are never touched. Vault files are **never modified** — the one-liner only reads, so notes stay byte-identical.

The substitution is the ONLY accepted form for both PR and issue bodies, on create and edit:

```bash
gh pr create --title "..." --body-file <(perl -0777 -pe '<BODY_STRIP>' <vault>/**/<repo>/prs/2026-08-14-pr1-slug.md)
gh pr edit 46 --body-file <(perl -0777 -pe '<BODY_STRIP>' <vault>/**/<repo>/prs/2026-08-14-pr1-slug.md)
gh issue create --title "..." --body-file <(perl -0777 -pe '<BODY_STRIP>' <vault>/**/<repo>/issues/2026-08-14-issue1-slug.md)
gh issue edit 29 --body-file <(perl -0777 -pe '<BODY_STRIP>' <vault>/**/<repo>/issues/2026-08-14-issue1-slug.md)
```

The glued form `--body-file=<(...)` and the short `-F <(...)` form are accepted too. The inner command is strict — only `perl -0777 -pe '<BODY_STRIP>' <path>` parses (any other tool, program, or token arrangement fails closed).

`<( )` process substitution needs bash ≥ 4 (or zsh): the pi `bash` tool qualifies, as do Git Bash and WSL on Windows. Plain `sh` and Windows `cmd` do not.

### `gh-repo-create-needs-seed`

`gh repo create|new` must carry a seed flag — `--add-readme`, `--gitignore|-g <tpl>`, `--license|-l <kw>`, or `--template|-p <repo>` (long or short form, space or `=` value form). A bare create births an **EMPTY repo** (zero branches, zero commits): `main` can only be born by pushing past the `no-main-commit` gates — the steering-override dance, and the first content lands UNREVIEWED. The seeded flow sends the whole bootstrap through the normal pipeline:

```bash
gh repo create cad0p/<name> --add-readme
# then: git fetch → git checkout -b feat/bootstrap origin/main → commit → push → PR → squash merge
```

The seed commit is the PR's base — the PR diff replaces it, so the first content is reviewed.

Non-seed flags (`--source`, `--push`, `--clone`, `--description`, `--public|--private`, `--remote`, `--team`, …) do **not** exempt: `gh repo create x --source . --push` is blocked too — only a seed flag lets the command through. The rule is a form check (like the body-file rules); gh's own flag validation governs seed/`--source` combos at runtime.

## Predicate

`when.missingVaultBodyFile` takes `{ section: "prs" | "issues" }` and returns `true` (rule blocks) when the command's `--body-file` value is missing, not the pinned `<(perl -0777 -pe '<BODY_STRIP>' <path>)` substitution form (direct paths, inline `--body`, wrong inner commands, extra or missing tokens), or the path fails the vault check: it must resolve to a real file inside a napkin vault (`.napkin/` / `.obsidian/.napkin/` walk-up), under a `<repo>/<section>/` directory (`<repo>` = origin URL basename, cwd-folder fallback). Fail-closed: anything unverifiable (incl. walker-unknown cwd) counts as missing. The `section` argument selects the required `<repo>/<section>/` directory — the convention is taught by the rule reasons AND enforced here.

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
- `findBodyFileValue(ctx)` — value of the first `--body-file` / `-F` occurrence (`""` when absent); handles the walker-split glued form `--body-file=<(...)`.
- `parseBodyFileArg(word)` — classify a body-file value word: `{ kind: "substitution", vaultPath }` \| `{ kind: "direct", path }` \| `null`.
- `resolveAgainstCwd(ctx, path)` — resolve a path against the command's effective cwd (`null` on walker-unknown cwd).
- `bodyHasClosingKeyword(ctx)` — does the body (stripped vault body-file content, or inline `--body`) carry a closing-keyword ref?
- `isInfoOnly(args, extraFlags?)` from `@cad0p/pi-steering-flags` — token-level info-only check for `--help`/`--version` plus additive CLI-specific flags such as `-h`; quote-aware, including attached forms.
- `unquote(text)` / `argText(ctx)` — low-level walker-word utilities.

The pattern constants (`CLOSING_KEYWORD`, `ISSUE_REF`, `TITLE_WITH_REF`, `SUBJECT_WITH_REF`, `BODY_WITH_REF`, `PR_BODY_ANCHOR`, `PR_CREATE_ANCHOR`, `PR_MERGE_ANCHOR`, `ISSUE_BODY_ANCHOR`, `REPO_CREATE_ANCHOR`, `REPO_CREATE_SEED_FLAG`, `REPO_CREATE_PATTERN`, `REPO_FLAG_ANCHOR`) are exported too — they are what the rules ship, pinned by the unit tests. The rule objects (`ghRepoFlagBeforeSubcommand`, …), the `foreignRepoReason` ReasonFn (module-exported from `src/rules/gh-repo-flag-before-subcommand.ts`), and the `repoName` helper (from `src/helpers/repo-name.ts`) are re-exported as well.

## Known limitations

- **Inline `--body` is blocked** by the vault body-file rules by design — the file is the source of truth. If you need inline bodies, disable those rules.
- **`--body-file` content is checked at eval time** by `pr-create-needs-issue-link` (and the merge gate no longer inspects the body at all — the `--subject` channel is sufficient): the file must already contain the closing keyword when the command runs. `pr-merge-needs-closing-keywords` checks only the explicit `--subject` value.
- **Value-region truncation**: pattern matching runs on the walker-normalized command, and a flag's value region ends at the next `\s-` pair. A value containing a literal ` - ` (space-dash-space) truncates the region, so a closing-keyword ref after such a sequence may be missed (rule fires; add the keyword earlier in the value). The `pr-merge-needs-closing-keywords` subject check is immune (argv-based), but the same class still applies to the string-level `--body-file` substitution pins.
- **Exact quoted info tokens**: `isInfoOnly` intentionally removes shell quotes before checking exact argv tokens. Consequently, `--subject "--help"` and `--subject "--version"` are indistinguishable from bare info-only flags and are released; surrounding text such as `"see --help"` and `"see --version"` remains blocked.
- **Quoted-value false exemption (`gh-repo-create-needs-seed`)**: a seed-looking token inside a QUOTED flag value (e.g. `--description "see --license mit"`) falsely exempts the command — the token guard kills only GLUED lookalikes (`-local`, `foo--add-readme`), not space-separated tokens inside quoted values. Deliberately exploitable: an agent could embed a fake seed mention and still birth an empty repo. Accepted — same value-region class as the PR_* patterns; the walker contract is the plugin's foundation.
- **`-R` after the subcommand is not gated by `gh-repo-flag-before-subcommand`**: `gh pr create -R x/y …` still matches the pr anchors (no bypass), but the foreign target isn't redirected (the `-R` flag lands after the subcommand the anchors match). Different, smaller class — follow-up.
- **Slashless `-R <remote>`** (remote-name form, no `/`) routes to the rule but is released by the `unless` (no `/` → not a foreign owner/repo redirect) — the fork→upstream flow passes through unchanged (allowed).
- **`-R x/y repo create` stays ungated** by the redirect (the repo doesn't exist yet — nothing to cd into; `repo create` never needs `-R` since the target is the positional argument, and the seed rule gates the actual create form).
- **`-Rcad0p/x` glued short form** (no space) is fail-closed-blocked even for the own-repo case — `hasFlag`/`getFlagValue` from `@cad0p/pi-steering-flags` can't see the value (walker keeps the glued word intact); the target is unparsable → block. Upstream gap: cad0p/pi-steering-flags#11.

## License

MIT
