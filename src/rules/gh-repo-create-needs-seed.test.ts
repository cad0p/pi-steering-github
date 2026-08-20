// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `gh-repo-create-needs-seed` pins (normalized form).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPO_CREATE_PATTERN } from "./patterns.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — gh-repo-create-needs-seed (normalized form)", () => {
  // Any seed flag exempts: long or short form, ` ` or `=` value
  // form, before or after the name. The `--add-readme --source .
  // --push` combo is ALLOWED (seed present) — gh's own flag
  // validation governs the combo at runtime; form check only,
  // consistent with the body-file rules' philosophy.
  it("allows any seed flag (--add-readme / --gitignore|-g / --license|-l / --template|-p)", () => {
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --add-readme"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create --add-readme x"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --gitignore Node"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -g Node"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --gitignore=Node"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --license mit"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -l mit"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --license=mit"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --template owner/repo"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -p owner/repo"),
      false,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --template=owner/repo"),
      false,
    );
    assert.equal(
      blocked(
        REPO_CREATE_PATTERN,
        "gh repo create x --add-readme --source . --push",
      ),
      false,
    );
  });

  it("blocks bare creates and non-seed flag combos", () => {
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo create x"), true);
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --source . --push"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --source=. --push"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -s . -r upstream"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --public --clone"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x --clone"),
      true,
    );
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -t myteam --public"),
      true,
    );
  });

  // Token guard: `-local`/`-public`/`foo--add-readme` never match as
  // seeds — the seed flag must be its own token. (Space-separated
  // seed lookalikes INSIDE a quoted value falsely exempt — known
  // limitation, documented in the README and the rule doc comment.)
  it("token guard kills glued lookalikes (-local, -public, foo--add-readme)", () => {
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo create x -local"), true);
    assert.equal(
      blocked(REPO_CREATE_PATTERN, "gh repo create x -public"),
      true,
    );
    assert.equal(
      blocked(
        REPO_CREATE_PATTERN,
        "gh repo create x --description foo--add-readme",
      ),
      true,
    );
  });

  // Accepted limitation (README "Known limitations"): the guard kills
  // only GLUED lookalikes — a space-separated seed token inside a
  // quoted flag value (quotes stripped in the normalized form) still
  // counts as a seed and falsely exempts. Deliberate, pinned so the
  // behavior can't change silently; same value-region class as the
  // PR_* patterns.
  it("accepted false exemption: seed token inside a quoted flag value", () => {
    assert.equal(
      blocked(
        REPO_CREATE_PATTERN,
        "gh repo create x --description see --license mit",
      ),
      false,
    );
  });
});
