// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `gh-repo-create-needs-seed` — `gh repo create|new` must carry a
 * seed flag (`--add-readme`, `--gitignore|-g`, `--license|-l`,
 * `--template|-p`, long or short form, ` ` or `=` value form). A
 * bare create births an EMPTY repo (zero branches, zero commits):
 * `main` can only be born by pushing past the `no-main-commit`
 * gates — the steering-override dance and UNREVIEWED first content.
 * The seeded flow sends the whole bootstrap through the normal
 * pipeline (fetch → feature branch → commit → push → PR → squash
 * merge); the seed commit is the PR's base, so the PR diff replaces
 * it and the first content is reviewed.
 *
 * Known limitation (deliberate): a seed-looking token inside a
 * QUOTED flag value (e.g. `--description "see --license mit"`)
 * falsely exempts — the `(?:^|\s)` guard kills only GLUED
 * lookalikes; same value-region class as the PR_* patterns, and the
 * walker contract is the plugin's foundation. A FLAG-FIRST create
 * (`gh -R x/y repo create foo`) also stays ungated: this anchor is
 * deliberately NOT widened with `LEADING_FLAG_PAIRS` (#41 scope —
 * no acceptance bullet covers it; candidate follow-up).
 *
 * Strict — no override (schema default).
 */

import type { Rule } from "@cad0p/pi-steering";
import { REPO_CREATE_PATTERN } from "../helpers/patterns.ts";

export const ghRepoCreateNeedsSeed = {
  name: "gh-repo-create-needs-seed",
  tool: "bash",
  field: "command",
  pattern: REPO_CREATE_PATTERN,
  reason:
    "gh repo create must seed the repo — a bare create births an EMPTY repo (no branches, no commits), " +
    "forcing UNREVIEWED first content. Use seed flags and seek explicit user approval for PR merge.\n" +
    "  gh repo create cad0p/<name> --add-readme\n" +
    "- Seed flags: --add-readme (recommended), --license <x>, --gitignore <x>, --template <repo>.\n" +
    "- The seed commit is the PR's base — the PR diff replaces the README.",
} as const satisfies Rule;
