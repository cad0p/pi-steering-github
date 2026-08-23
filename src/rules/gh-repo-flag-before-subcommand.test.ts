// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `gh-repo-flag-before-subcommand` pins: the normalized-form anchor
 * surface (routes flag-first gated commands; pure router), the
 * `unless` basename-match logic against a recording host, and the
 * dynamic ReasonFn output (byte-pinned).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPO_FLAG_ANCHOR } from "../helpers/patterns.ts";
import {
  foreignRepoReason,
  ghRepoFlagBeforeSubcommand,
} from "./gh-repo-flag-before-subcommand.ts";

function blocked(pattern: string | RegExp, normalized: string): boolean {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return re.test(normalized);
}

describe("github plugin — gh-repo-flag-before-subcommand (normalized form)", () => {
  it("routes flag-first gated commands (pure router: any flag token)", () => {
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

  it("pure router also routes non-repo flags and slashless -R (the unless releases them)", () => {
    // The router deliberately does NOT decide flag identity or the
    // `/` requirement — those live in the `unless` fn (arg layer).
    // Non-repo flags and slashless remote-name forms route but are
    // released by the `unless` (pinned in the unless describe).
    assert.equal(blocked(REPO_FLAG_ANCHOR, "gh -v pr create --title t"), true);
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh --hostname x pr create --title t"),
      true,
    );
    assert.equal(
      blocked(REPO_FLAG_ANCHOR, "gh -R upstream pr create --title t"),
      true,
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

  it("releases non-repo flags the router now routes (-v, --hostname)", async () => {
    // The pure-router anchor routes ANY first flag token; the unless
    // releases commands whose first flag is not the repo-flag family.
    const vCtx = ctxWith("gh -v pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(vCtx), true);
    const hCtx = ctxWith("gh --hostname x pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(hCtx), true);
  });

  it("releases slashless -R upstream (fork remote-name form)", async () => {
    // `gh -R upstream pr create` — the anchor now routes it; the
    // unless releases it (no `/` → not a foreign owner/repo redirect;
    // matches the old anchor's never-routed allowance).
    const ctx = ctxWith("gh -R upstream pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
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

  it("BEHAVIOR DELTA (#34): cross-alias override — last alias wins", async () => {
    // `gh -R <own> … --repo cad0p/other`: gh/cobra collapse repeated
    // spellings of one logical flag to the LAST value, so the command
    // targets `cad0p/other`. The old `??` composition let the
    // FIRST-seen alias (`-R`, own repo) win → basename match → allow
    // (wrong vs gh). Last-wins resolution sees the foreign override →
    // block. This is THE regression pin issue #34 asks for.
    const ctx = ctxWith(
      "gh -R cad0p/pi-steering-github pr create --repo cad0p/other",
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
  });

  it("BEHAVIOR DELTA (#34): trailing valueless alias fail-closes", async () => {
    // A trailing bare `-R` is the LAST occurrence across the aliases;
    // last-wins getFlagValue returns null with NO fallback to the
    // overridden earlier `--repo` value (real pflag errors on it
    // anyway) — fail-closed block. Old code fell through `??` to the
    // earlier valued alias and allowed.
    const ctx = ctxWith("gh --repo cad0p/pi-steering-github pr merge -R", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
  });

  it("BEHAVIOR DELTA (#34): empty attached value as last occurrence fail-closes", async () => {
    // `--repo=` (empty ATTACHED value, distinct from the space-form
    // valueless case above) is the last occurrence → getFlagValue
    // returns "" → fail-closed block. Old code's `-R` call won the
    // `??` and took the basename path (allow for own repo). gh errors
    // on an empty repo anyway — accepted over-block.
    const ctx = ctxWith("gh -R cad0p/pi-steering-github pr create --repo=", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await ghRepoFlagBeforeSubcommand.unless!(ctx), false);
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

  it("cross-alias command echoes the EFFECTIVE (last) flag+target", () => {
    // Right→left scan mirrors getFlagValue's LAST-flag-wins: the
    // overridden early `-R cad0p/a` is NOT echoed — the redirect names
    // what gh will actually target (`--repo cad0p/b`).
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/a pr create --repo cad0p/b"),
    );
    assert.equal(
      reason,
      "The PR you're targeting via --repo cad0p/b belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });

  it("trailing glued empty value echoes the glued word verbatim", () => {
    // First match from the right wins REGARDLESS of form: the glued
    // `--repo=` at the line's end beats the earlier valued `-R` —
    // consistent with the fail-closed block verdict for this command.
    const reason = foreignRepoReason(
      ctxWith("gh -R cad0p/a pr create --repo="),
    );
    assert.equal(
      reason,
      "The PR you're targeting via --repo= belongs to a foreign repo.\n" +
        "REQUIREMENT: run a foreign subagent maintainer loop until good,\n" +
        "then cd into the foreign repo and target it from there.",
    );
  });
});
