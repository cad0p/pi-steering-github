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
  foreignRepoReason,
  ghRepoCreateNeedsSeed,
  ghRepoFlagBeforeSubcommand,
  ISSUE_BODY_ANCHOR,
  ISSUE_REF,
  issueBodyFromVaultFile,
  PR_BODY_ANCHOR,
  PR_CREATE_ANCHOR,
  PR_MERGE_ANCHOR,
  prBodyFromVaultFile,
  prCreateNeedsIssueLink,
  prMergeNeedsClosingKeywords,
  REPO_CREATE_PATTERN,
  REPO_FLAG_ANCHOR,
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
    assert.equal(ghRepoFlagBeforeSubcommand.pattern, REPO_FLAG_ANCHOR);
    assert.equal(prBodyFromVaultFile.pattern, PR_BODY_ANCHOR);
    assert.equal(prCreateNeedsIssueLink.pattern, PR_CREATE_ANCHOR);
    assert.equal(prMergeNeedsClosingKeywords.pattern, PR_MERGE_ANCHOR);
    assert.equal(issueBodyFromVaultFile.pattern, ISSUE_BODY_ANCHOR);
    assert.equal(ghRepoCreateNeedsSeed.pattern, REPO_CREATE_PATTERN);
  });

  it("rules array ships in roster order (first-match-wins routing)", () => {
    assert.deepEqual(
      rules.map((r) => r.name),
      [
        "gh-repo-flag-before-subcommand",
        "pr-body-from-vault-file",
        "pr-create-needs-issue-link",
        "pr-merge-needs-closing-keywords",
        "issue-body-from-vault-file",
        "gh-repo-create-needs-seed",
      ],
    );
  });
});

describe("github plugin — gh-repo-flag-before-subcommand (normalized form)", () => {
  it("routes -R/--repo BEFORE the subcommand with a /-containing target", () => {
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr create --title t"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr new x"), true);
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr edit 46 x"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --repo cad0p/x pr create --title t"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --repo=cad0p/x issue create --title t"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -Rcad0p/x issue edit 3"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R ghe.example.com/org/repo pr edit 46"),
      true,
    );
    // MUST-BLOCK repro pin: the EXACT issue #19 under-block repro
    // (keyword in --subject). A roster reorder can't silently
    // re-open the hole: this line pins that the new rule fires
    // regardless of keywords.
    assert.equal(
      blocked(
        REPO_FLAG_ANCHOR,
        "gh -R cad0p/x pr merge --squash --subject fix: x (closes #12)",
      ),
      true,
    );
  });

  it("does not route slashless remotes, read-only forms, excluded subcommands, or -R after the subcommand", () => {
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R upstream pr create --title t"),
      false,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr view 12"), false);
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x issue list"), false);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x issue close 3"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo create foo"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo new foo"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh pr create -R cad0p/x --title t"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "echo gh -R cad0p/x pr create --title t"),
      false,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x repo clone x"),
      false,
    );
  });

  it("the anchor is a pure router: --help/-h and non-repo flags still route, the UNLESS decides", () => {
    // The anchor does NOT decide help — the token-level `unless`
    // carve-out does (so a `--help` inside a quoted value never
    // falsely exempts). These route to the rule and are allowed by
    // the `unless` fn.
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --help"),
      true,
    );
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge -h"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --help"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash -h"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --helper"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash -hx"),
      true,
    );
    // --help=value is not a help flag token — routes; unless fails
    // to carve out (hasFlag matches --help= via its attached-value
    // prefix, so it DOES exempt — harmless invalid invocation; the
    // behavior delta vs the old regex is pinned in the unless tests).
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R cad0p/x pr merge --squash --help="),
      true,
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
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
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
    assert.equal(blocked(PR_MERGE_ANCHOR, "echo gh pr merge --squash"), false);
    assert.equal(blocked(PR_BODY_ANCHOR, "echo gh pr create --title x"), false);
  });
});

describe("github plugin — pr-merge-needs-closing-keywords (normalized form)", () => {
  // The rule now anchors PR_MERGE_ANCHOR only; the help carve-out
  // and the subject check live in `when.condition` on the
  // walker-parsed argv (token-level, quote-aware) — exercised
  // end-to-end in `../integration.test.ts`. This describe pins the
  // ANCHOR surface (which commands route to the rule at all).
  it("anchors pr merge only (all forms route to the rule)", () => {
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --squash"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge 123 -s -t x"), true);
    // The anchor itself does NOT decide help — the condition does.
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr merge --help"), true);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr create --title x"), false);
    assert.equal(blocked(PR_MERGE_ANCHOR, "gh pr view 46"), false);
  });

  it("the rule gates via when.condition only (no string-level unless)", () => {
    const rule = prMergeNeedsClosingKeywords as unknown as {
      unless?: unknown;
      when?: { condition?: unknown };
    };
    assert.equal(
      rule.unless,
      undefined,
      "no unless — the help carve-out must be token-level, not string-level",
    );
    assert.equal(
      typeof rule.when?.condition,
      "function",
      "help carve-out + subject keyword check must live in when.condition",
    );
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

describe("github plugin — gh-repo-flag-before-subcommand unless (basename match)", () => {
  // Stub ctx with walker args + a repoName-resolving cwd. `repoName`
  // itself is NOT stubbed — it runs the real origin-URL query via
  // ctx.exec against a recording host (integration-level fidelity at
  // unit cost). A null-resolving host answers nothing (fallback: cwd
  // folder name).
  function ctxWith(
    command: string,
    opts: { cwd?: string; remote?: string | null } = {},
  ): Parameters<typeof ghRepoFlagBeforeSubcommand.unless>[0] {
    const cwd = opts.cwd ?? "/home/me/pi-steering-github";
    const args = command.split(/\s+/).map((text) => ({ text }));
    const exec =
      opts.remote === null
        ? () =>
            Promise.resolve({
              stdout: "",
              stderr: "",
              code: 1,
              killed: false,
            })
        : (_cmd: string, _a: string[]) =>
            Promise.resolve({
              stdout: opts.remote ?? "",
              stderr: "",
              code: 0,
              killed: false,
            });
    return {
      cwd,
      input: { args },
      exec: exec as unknown as Parameters<
        typeof ghRepoFlagBeforeSubcommand.unless
      >[0]["exec"],
    } as unknown as Parameters<typeof ghRepoFlagBeforeSubcommand.unless>[0];
  }

  it("allows the fork→upstream flow: target basename == cwd repo basename", async () => {
    // `gh -R upstream/pi-steering-github pr create` from inside the
    // `cad0p/pi-steering-github` clone — the most common legit `-R`
    // use.
    const ctx = ctxWith(
      "gh -R upstream/pi-steering-github pr create --title t",
      {
        remote: "https://github.com/cad0p/pi-steering-github.git",
      },
    );
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), true);
  });

  it("allows a different-owner same-basename target (fork)", async () => {
    const ctx = ctxWith("gh -R other/pi-steering-github pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), true);
  });

  it("blocks a foreign target (basename mismatch)", async () => {
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
  });

  it("blocks when the cwd repo is unresolvable (repoName = 'unknown' sentinel)", async () => {
    // Walker-unknown cwd: repoName's cwd-folder fallback yields the
    // literal string "unknown" (NOT null) — fail-closed, block.
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash", {
      cwd: "unknown",
      remote: null,
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
  });

  it("allows --repo=x/y (glued long form) same-basename — getFlagValue sees it", async () => {
    const ctx = ctxWith(
      "gh --repo=cad0p/pi-steering-github pr merge --squash",
      {
        remote: "https://github.com/cad0p/pi-steering-github.git",
      },
    );
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), true);
  });

  it("BEHAVIOR DELTA: own-repo glued short form -Rcad0p/x now BLOCKS (fail-closed)", async () => {
    // `getFlagValue` cannot see `-Rcad0p/x` (the walker keeps it as
    // ONE word; the flags helpers match bare `-R` / `--repo=` only).
    // Target unparsable → cannot prove same-repo → block. Accepted
    // over-block (upstream gap cad0p/pi-steering-flags#11). This
    // pins the delta vs the old `parseRepoFlagTarget` (which allowed).
    const ctx = ctxWith("gh -Rcad0p/pi-steering-github pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
  });

  it("help carve-out is token-level: bare --help/-h allow, quoted-value and glued do NOT", async () => {
    // Bare help tokens → allow (read-only introspection).
    const helpCtx = ctxWith("gh -R cad0p/other pr merge --help", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(helpCtx), true);
    const hCtx = ctxWith("gh -R cad0p/other pr merge -h", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(hCtx), true);
    // A `--help` inside a QUOTED VALUE is a real gated command —
    // must NOT exempt (the old regex negative-lookahead had this
    // hole; the token-level carve-out does not).
    const quotedCtx = ctxWith(
      'gh -R cad0p/other pr merge --subject "see --help"',
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(quotedCtx), false);
    // Glued lookalikes are not help tokens.
    const helperCtx = ctxWith("gh -R cad0p/other pr merge --squash --helper", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(helperCtx), false);
    const hxCtx = ctxWith("gh -R cad0p/other pr merge --squash -hx", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(hxCtx), false);
  });

  it("BEHAVIOR DELTA: --help= now EXEMPTS (hasFlag attached-value prefix match)", async () => {
    // `hasFlag(args, "--help")` treats `--help=` as the attached-value
    // form of `--help` (startsWith `--help=`) → carve-out fires. The
    // old token-boundary regex blocked `--help=`. `--help=` is an
    // invalid gh invocation (errors, never mutates) — harmless; pin
    // the flip so it can't change silently.
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash --help=", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), true);
  });
});

describe("github plugin — gh-repo-flag-before-subcommand ReasonFn (dynamic)", () => {
  function ctxWith(command: string): Parameters<typeof foreignRepoReason>[0] {
    const args = command.split(/\s+/).map((text) => ({ text }));
    return { input: { args } } as unknown as Parameters<
      typeof foreignRepoReason
    >[0];
  }

  it("PR form: echoes the -R flag+target AS TYPED + the redirect requirement", () => {
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/x pr create --title t"),
    );
    assert.equal(
      reason,
      "The PR you're targeting via -R cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("issue form: 'The issue …'", () => {
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/x issue create --title t"),
    );
    assert.equal(
      reason,
      "The issue you're targeting via -R cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("--repo=x/y glued form echoes the flag as typed", () => {
    // The walker keeps `--repo=x/y` glued as ONE word.
    const reason = foreignRepoReason(
      ctxWith("gh --repo=cad0p/x issue create --title t"),
    );
    assert.equal(
      reason,
      "The issue you're targeting via --repo=cad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("-Rx/y glued form echoes the flag as typed", () => {
    // The walker keeps `-Rx/y` glued as ONE word.
    const reason = foreignRepoReason(ctxWith("gh -Rcad0p/x issue edit 3"));
    assert.equal(
      reason,
      "The issue you're targeting via -Rcad0p/x belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
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

  it("issue-body-from-vault-file reason (foreign-issue line removed — D5)", () => {
    assert.equal(
      issueBodyFromVaultFile.reason,
      "Issue bodies must come from a body file in the napkin vault:\n" +
        '  gh issue create --title "..." --body-file ' +
        `<(perl -0777 -pe '${BODY_STRIP}' ` +
        "<vault>/**/<repo>/issues/YYYY-MM-DD-issue<N>-<slug>.md)\n",
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
