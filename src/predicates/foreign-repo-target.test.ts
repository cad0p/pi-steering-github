// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `foreignRepoTarget` pins: the handler logic moved 1:1 from the
 * former inline `unless` describe of `gh-repo-flag-before-
 * subcommand` and return-INVERTED (the closure returned true to
 * release; a registered predicate returns true to FIRE = BLOCK).
 *
 * The quoted-help / `--help=` carve-out pins deliberately do NOT
 * live here: the carve-out left the handler (it is the rule's
 * `not.infoOnly` leaf now), so a moved assertion would flip sign and
 * test nothing — they stay at the composed-rule level in the rule's
 * test file. The delta-1 `--version` rows below pin that the handler
 * itself is INDIFFERENT to version tokens; the user-visible block→
 * allow flip for gated invocations carrying them is composed by the
 * not-leaf and pinned end-to-end in `../integration.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext } from "@cad0p/pi-steering";
import { foreignRepoTarget } from "./foreign-repo-target.ts";

describe("github plugin — foreignRepoTarget (basename match / fail-closed)", () => {
  // Stub ctx with walker args + a repoName-resolving cwd. `repoName`
  // itself is NOT stubbed — it runs the real origin-URL query via
  // ctx.exec against a recording host (integration-level fidelity at
  // unit cost). A null-resolving host answers nothing (fallback: cwd
  // folder name). The handler is invoked with bare `true`, mirroring
  // the enabled leaf (`foreignRepoTarget: true` ≡ spread `{}`).
  function ctxWith(
    command: string,
    opts: { cwd?: string; remote?: string | null } = {},
  ): PredicateContext {
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
      tool: "bash",
      input: { args },
      exec,
    } as unknown as PredicateContext;
  }

  it("bare false never fires (step-0 guard, even on would-block argv)", async () => {
    // Handlers receive the leaf value verbatim: `foreignRepoTarget:
    // false` must disable the gate WITHOUT running the argv logic —
    // this argv alone would block (foreign target).
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash");
    assert.equal(await foreignRepoTarget(false, ctx), false);
  });

  it("releases the fork→upstream flow: target basename == cwd repo basename", async () => {
    // `gh -R upstream/pi-steering-github pr create` from inside the
    // `cad0p/pi-steering-github` clone — the most common legit `-R`
    // use.
    const ctx = ctxWith(
      "gh -R upstream/pi-steering-github pr create --title t",
      {
        remote: "https://github.com/cad0p/pi-steering-github.git",
      },
    );
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("releases non-repo flags the router routes (-v, --hostname)", async () => {
    // The pure-router anchor routes ANY first flag token; the
    // predicate releases commands whose first flag is not the
    // repo-flag family.
    const vCtx = ctxWith("gh -v pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, vCtx), false);
    const hCtx = ctxWith("gh --hostname x pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, hCtx), false);
  });

  it("releases slashless -R upstream (fork remote-name form)", async () => {
    // `gh -R upstream pr create` — no `/` → not a foreign owner/repo
    // redirect.
    const ctx = ctxWith("gh -R upstream pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("releases a different-owner same-basename target (fork)", async () => {
    const ctx = ctxWith("gh -R other/pi-steering-github pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("fires on a foreign target (basename mismatch)", async () => {
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("fails closed when the cwd repo is unresolvable (repoName = 'unknown' sentinel)", async () => {
    // Walker-unknown cwd: repoName's cwd-folder fallback yields the
    // literal string "unknown" (NOT null) — fail-closed, fire.
    const ctx = ctxWith("gh -R cad0p/other pr merge --squash", {
      cwd: "unknown",
      remote: null,
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("releases --repo=x/y (glued long form) same-basename — getFlagValue sees it", async () => {
    const ctx = ctxWith(
      "gh --repo=cad0p/pi-steering-github pr merge --squash",
      {
        remote: "https://github.com/cad0p/pi-steering-github.git",
      },
    );
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("releases own-repo glued short form -Rcad0p/x (basename match)", async () => {
    // Glue-aware resolution (upstream cad0p/pi-steering-flags#11,
    // `{ gluedShorts: ["R"] }` opt-in): `-Rcad0p/pi-steering-github`
    // resolves → basename equality → release. The pre-#36 parser
    // allowed this too — the #36-era fail-closed over-block delta
    // converges back to zero.
    const ctx = ctxWith("gh -Rcad0p/pi-steering-github pr create --title t", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("fires on a foreign glued short form -Rcad0p/other", async () => {
    // Glue awareness cuts both ways: a FOREIGN owner/repo in glued
    // short form now RESOLVES instead of fail-closing on null —
    // basename mismatch → fire.
    const ctx = ctxWith("gh -Rcad0p/other pr merge --squash", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("BEHAVIOR DELTA (#34): glued member loses to later bare alias", async () => {
    // `gh -Rcad0p/other … --repo cad0p/pi-steering-github`: LAST-wins
    // spans mixed forms — the trailing bare `--repo` overrides the
    // earlier glued occurrence → own repo → release.
    const ctx = ctxWith(
      "gh -Rcad0p/other pr create --repo cad0p/pi-steering-github",
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("BEHAVIOR DELTA (#34): glued member wins over earlier attached alias", async () => {
    // Mirror direction: trailing glued `-Rcad0p/other` overrides the
    // earlier attached `--repo=` own-repo value → foreign → fire.
    const ctx = ctxWith(
      "gh --repo=cad0p/pi-steering-github pr merge -Rcad0p/other",
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("fails closed: glued occurrence then trailing valueless -R", async () => {
    // #34 semantics are form-agnostic: the trailing BARE `-R` is the
    // last occurrence → exact-match valueless → null, NO fallback to
    // the overridden glued value → fire.
    const ctx = ctxWith("gh -Rcad0p/pi-steering-github pr merge -R", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("releases glued slashless -Rupstream (fork remote-name form)", async () => {
    // Glued short form of the slashless remote-name flow: `-Rupstream`
    // resolves to `upstream` → no `/` → step-4 release.
    const ctx = ctxWith("gh -Rupstream pr merge", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("fails closed on empty attached short-form value -R=", async () => {
    // Attached branch outranks glued: `-R=` matches the `-R=` prefix
    // → value "" (NOT a glued decomposition of letter R) → step-3
    // fail-close. gh errors on an empty repo anyway.
    const ctx = ctxWith("gh -Rcad0p/pi-steering-github pr merge -R=", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("accepted limitation: slashless lookalike value word releases via step 4", async () => {
    // Declaring ["R"] decomposes ANY `-R<rest>` word at any position:
    // a quoted body value like `-m "-Rebased onto main"` (walker keeps
    // it one word; the helper's space-split below approximates it)
    // hijacks resolution to the slashless target "ebased" → step-4
    // RELEASE — so a body word can never cause a false block. (It can
    // MASK a real foreign target behind it — heuristic discipline,
    // same class as the fork→upstream tolerance.)
    const ctx = ctxWith("gh -Rcad0p/other pr edit 46 -m -Rebased onto main", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("accepted limitation: slashful lookalike value word over-blocks", async () => {
    // The dangerous twin of the pin above: a SLASHFUL body value
    // (`-m "-Rfoo/bar ref"`) hijacks resolution to `foo/bar` →
    // basename mismatch → FIRE despite the leading own-repo target.
    // Fail-closed direction, accepted under the ShellCheck-norm
    // opt-in contract (flags#11 semantics 1+4).
    const ctx = ctxWith(
      "gh -Rcad0p/pi-steering-github pr edit 46 -m -Rfoo/bar ref",
      {
        remote: "https://github.com/cad0p/pi-steering-github.git",
      },
    );
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("BEHAVIOR DELTA (#36 delta 1): bare --version leaves the handler indifferent", async () => {
    // The help/version carve-out lives in the rule's `not.infoOnly`
    // leaf, NOT here — so the handler's verdict for a --version-
    // carrying command is exactly what the plain target/basename
    // rails produce (own-repo basename match → release). The
    // user-visible block→allow flip for FOREIGN targets carrying
    // --version happens because the not-leaf allows before this
    // handler is ever consulted — pinned end-to-end in
    // integration.test.ts.
    const ctx = ctxWith("gh -R cad0p/pi-steering-github pr create --version", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("BEHAVIOR DELTA (#36 delta 1): attached --version=1 likewise", async () => {
    const ctx = ctxWith(
      "gh -R cad0p/pi-steering-github pr create --version=1",
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await foreignRepoTarget(true, ctx), false);
  });

  it("BEHAVIOR DELTA (#34): cross-alias override — last alias wins", async () => {
    // `gh -R <own> … --repo cad0p/other`: gh/cobra collapse repeated
    // spellings of one logical flag to the LAST value, so the command
    // targets `cad0p/other`. The old `??` composition let the
    // FIRST-seen alias (`-R`, own repo) win → basename match →
    // release (wrong vs gh). Last-wins resolution sees the foreign
    // override → fire. This is THE regression pin issue #34 asks
    // for.
    const ctx = ctxWith(
      "gh -R cad0p/pi-steering-github pr create --repo cad0p/other",
      { remote: "https://github.com/cad0p/pi-steering-github.git" },
    );
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("BEHAVIOR DELTA (#34): trailing valueless alias fail-closes", async () => {
    // A trailing bare `-R` is the LAST occurrence across the aliases;
    // last-wins getFlagValue returns null with NO fallback to the
    // overridden earlier `--repo` value (real pflag errors on it
    // anyway) — fail-closed fire. Old code fell through `??` to the
    // earlier valued alias and allowed.
    const ctx = ctxWith("gh --repo cad0p/pi-steering-github pr merge -R", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });

  it("BEHAVIOR DELTA (#34): empty attached value as last occurrence fail-closes", async () => {
    // `--repo=` (empty ATTACHED value, distinct from the space-form
    // valueless case above) is the last occurrence → getFlagValue
    // returns "" → fail-closed fire. Old code's `-R` call won the
    // `??` and took the basename path (release for own repo). gh
    // errors on an empty repo anyway — accepted over-block.
    const ctx = ctxWith("gh -R cad0p/pi-steering-github pr create --repo=", {
      remote: "https://github.com/cad0p/pi-steering-github.git",
    });
    assert.equal(await foreignRepoTarget(true, ctx), true);
  });
});
