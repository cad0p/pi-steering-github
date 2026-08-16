// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the github plugin's pattern constants (pattern
 * contract). Import the constants from `./rules.ts` directly: the
 * module loads cleanly under plain node (`node --test
 * --experimental-strip-types`) — the `@cad0p/pi-napkin/steering`
 * subpath ships compiled JS (`dist/steering`) since 0.7.0-20260814.0,
 * so there is no raw `.ts` under node_modules to trip the type
 * stripper.
 *
 * The rule `pattern` fields ARE the exported constants (shared
 * reference), so these tests pin the exact behavior the rules ship:
 * a change to a constant is a change to the rule. Full-pipeline tests
 * (real defineConfig + loadHarness + vault fixtures) live in
 * `../integration.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BODY_STRIP } from "./predicates/missing-vault-body-file.ts";
import {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ghRepoCreateNeedsSeed,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  issueBodyFromVaultFile,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_PATTERN,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  REPO_CREATE_PATTERN,
  rules,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./rules.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — pattern constants", () => {
  it("closing-keyword family and issue-ref are exported for pinning", () => {
    assert.match(CLOSING_KEYWORD, /close/);
    assert.match(ISSUE_REF, /#\\d/);
    assert.match(TITLE_WITH_REF, /--title/);
    assert.match(SUBJECT_WITH_REF, /--subject/);
    assert.match(BODY_WITH_REF, /--body/);
  });

  it("rule pattern fields are the shared anchors (shared reference)", () => {
    // House pinning style (mirrors the git plugin): the rules
    // reference the exported constants, so a change to a constant is
    // a change to the rule — no drift between test surface and
    // shipped behavior.
    assert.equal(prBodyFromVaultFile.pattern, PR_BODY_ANCHOR);
    assert.equal(prCreateNeedsIssueLink.pattern, PR_CREATE_ANCHOR);
    assert.equal(prMergeNeedsClosingKeywords.pattern, PR_MERGE_PATTERN);
    assert.equal(issueBodyFromVaultFile.pattern, ISSUE_BODY_ANCHOR);
    assert.equal(ghRepoCreateNeedsSeed.pattern, REPO_CREATE_PATTERN);
  });

  it("rules array ships in roster order (first-match-wins routing)", () => {
    assert.deepEqual(
      rules.map((r) => r.name),
      [
        "pr-body-from-vault-file",
        "pr-create-needs-issue-link",
        "pr-merge-needs-closing-keywords",
        "issue-body-from-vault-file",
        "gh-repo-create-needs-seed",
      ],
    );
  });
});

describe("github plugin — command anchors (normalized form)", () => {
  it("pr-body-from-vault-file anchors pr create/new/edit only", () => {
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr create --title x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr new --title x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr edit 46 --body x"), true);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh pr view 46"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "gh issue create --title x"), false);
  });

  it("pr-create-needs-issue-link anchors pr create/new only", () => {
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr create --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr new --title x"), true);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr edit 46 --title x"), false);
    assert.equal(blocked(PR_CREATE_ANCHOR, "gh pr merge --squash"), false);
  });

  it("pr-merge-needs-closing-keywords anchors pr merge only", () => {
    assert.equal(blocked(PR_MERGE_PATTERN, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_PATTERN, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_PATTERN, "gh pr view 46"), false);
  });

  it("issue-body-from-vault-file anchors issue create/edit only", () => {
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue create --title x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue edit 29 --body x"), true);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue close 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh issue view 29"), false);
    assert.equal(blocked(ISSUE_BODY_ANCHOR, "gh pr create --title x"), false);
  });

  it("gh-repo-create-needs-seed anchors repo create/new only (new is the alias)", () => {
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo create x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo new x"), true);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo view x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh repo clone x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "gh pr create --title x"), false);
    assert.equal(blocked(REPO_CREATE_PATTERN, "echo gh repo create x"), false);
  });

  it("does not fire on non-gh basenames (echo …)", () => {
    assert.equal(blocked(PR_MERGE_PATTERN, "echo gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "echo gh pr create --title x"), false);
  });
});

describe("github plugin — pr-merge-needs-closing-keywords (normalized form)", () => {
  // Normalized form of:
  //   gh pr merge --squash --subject "feat: x (closes #12)" --body "Closes #12"
  it("allows keyword in BOTH --subject and --body", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        "gh pr merge --squash --subject fix: x (closes #12) --body Closes #12",
      ),
      false,
    );
  });

  // Normalized form of: gh pr merge 123 -s -t "fix: y (closes #7)" -b "Closes #7"
  it("allows -t/-b short flags with a PR number argument", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        "gh pr merge 123 -s -t fix: y (closes #7) -b Closes #7",
      ),
      false,
    );
  });

  // Normalized form of:
  //   gh pr merge --auto --squash --subject="feat (RESOLVES: #4)" --body="Resolves: #4"
  it("allows --flag=value glued forms, colons and case variants", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        'gh pr merge --auto --squash --subject="feat (RESOLVES: #4)" --body="Resolves: #4"',
      ),
      false,
    );
  });

  // Normalized form of: gh pr merge --squash --subject "fix: x (closes #12)" --body "Closes #12, closes #15"
  it("allows multiple issues with keyword per issue", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        "gh pr merge --squash --subject fix: x (closes #12) --body Closes #12, closes #15",
      ),
      false,
    );
  });

  // Normalized form of: gh pr merge --squash --body "Closes #12"
  it("blocks without --subject (commit-subject channel required)", () => {
    assert.equal(
      blocked(PR_MERGE_PATTERN, "gh pr merge --squash --body Closes #12"),
      true,
    );
  });

  // Normalized form of: gh pr merge --squash --subject "fix: x (closes #12)"
  it("allows --subject only (commit-body channel optional — the subject closes)", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        "gh pr merge --squash --subject fix: x (closes #12)",
      ),
      false,
    );
  });

  // Normalized form of:
  //   gh pr merge --squash --subject "fix: x (closes #12)" --body-file message.md
  it("allows --body-file when --subject carries the keyword", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        "gh pr merge --squash --subject fix: x (closes #12) --body-file message.md",
      ),
      false,
    );
  });

  // Normalized form of:
  //   gh pr merge --squash --subject "fix: x (see #12)" --body "see #12"
  it("blocks bare issue mentions without the keyword (mention != close)", () => {
    assert.equal(
      blocked(
        PR_MERGE_PATTERN,
        'gh pr merge --squash --subject "fix: x (see #12)" --body "see #12"',
      ),
      true,
    );
  });

  // Normalized form of: gh pr merge --squash
  it("blocks without any closing keyword", () => {
    assert.equal(blocked(PR_MERGE_PATTERN, "gh pr merge --squash"), true);
  });
});

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

describe("github plugin — reason strings (byte-identity pins)", () => {
  // The keyword-rule reason strings are byte-identical to the live
  // global-config prototype (verified at ship time 2026-08-14 by an
  // independent reviewer comparing both modules field-by-field); the
  // two body-file rules were reworded in the pinned-perl work (issue
  // #3) to teach the pinned perl body-strip substitution. Agents in
  // the wild receive these verbatim in block reasons, and the global
  // config's integration tests match rule NAMES only — so these
  // literals are the only CI pin keeping the full reason text from
  // drifting. A future reword MUST update this test in the same
  // commit (and ideally the goldmine changelog note).
  it("pr-body-from-vault-file reason", () => {
    assert.equal(
      prBodyFromVaultFile.reason,
      "PR bodies must come from a body file in the napkin vault:\n" +
        '  gh pr create --title "..." --body-file ' +
        `<(perl -0777 -pe '${BODY_STRIP}' ` +
        "<vault>/**/<repo>/prs/YYYY-MM-DD-pr<N>-<slug>.md)\n",
    );
  });

  it("pr-create-needs-issue-link reason", () => {
    assert.equal(
      prCreateNeedsIssueLink.reason,
      "A PR must close at least one issue — put the closing keyword in BOTH the " +
        "title and body:\n" +
        '  e.g: title: "feat: x (closes #12)"; body: contains "Closes #12"\n' +
        "- Title keyword: makes the issue(s) auto-close.\n" +
        "- Body keyword: only links the issue(s) to the PR on a Title-Only squash merge.\n" +
        '- Multiple issues: repeat the keyword per issue — "Closes #A, closes #B" — ' +
        '"Closes #A #B" honors only the first number.',
    );
  });

  it("pr-merge-needs-closing-keywords reason", () => {
    assert.equal(
      prMergeNeedsClosingKeywords.reason,
      "Merging requires a closing keyword in the squash commit subject " +
        "— every PR must close at least one issue:\n" +
        '  gh pr merge --squash --subject "feat: x (closes #12)"\n' +
        '- Repeat the keyword per issue — "Closes #A #B" honors only the first number.\n',
    );
  });

  it("issue-body-from-vault-file reason", () => {
    assert.equal(
      issueBodyFromVaultFile.reason,
      "Issue bodies must come from a body file in the napkin vault:\n" +
        '  gh issue create --title "..." --body-file ' +
        `<(perl -0777 -pe '${BODY_STRIP}' ` +
        "<vault>/**/<repo>/issues/YYYY-MM-DD-issue<N>-<slug>.md)\n" +
        "- If foreign issue: cd to the repo you want to file the issue; " +
        "REQUIREMENT: have a foreign subagent maintainer loop before filing",
    );
  });

  it("gh-repo-create-needs-seed reason", () => {
    assert.equal(
      ghRepoCreateNeedsSeed.reason,
      "gh repo create must seed the repo — a bare create births an EMPTY repo (no branches, no commits), " +
        "forcing UNREVIEWED first content. Use seed flags and seek explicit user approval for PR merge.\n" +
        "  gh repo create cad0p/<name> --add-readme\n" +
        "- Seed flags: --add-readme (recommended), --license <x>, --gitignore <x>, --template <repo>.\n" +
        "- The seed commit is the PR's base — the PR diff replaces the README.",
    );
  });
});
