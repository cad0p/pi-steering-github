// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the github plugin's content-pattern constants.
 * Import the constants from `./patterns.ts` directly: the module
 * loads cleanly under plain node (`node --test
 * --experimental-strip-types`).
 *
 * Command routing is structural now (`command: "gh"` +
 * `when.subcommand` sequences on the rules — core #117, closes #55):
 * the retired `^gh\s+` anchor family has no pins here. Routing truth
 * tables live at the engine level in `../integration.test.ts` (real
 * defineConfig + loadHarness) and the descriptor value pin in
 * `../descriptors.test.ts`. What remains pinned here are the
 * VALUE-content patterns the keyword rules test flag values against.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BODY_WITH_REF,
  CLOSING_KEYWORD,
  ISSUE_REF,
  SUBJECT_WITH_REF,
  TITLE_WITH_REF,
} from "./patterns.ts";

describe("github plugin — content patterns", () => {
  it("closing-keyword family and issue-ref are exported for pinning", () => {
    assert.match(CLOSING_KEYWORD, /close/);
    assert.match(ISSUE_REF, /#\\d/);
    assert.match(TITLE_WITH_REF, /--title/);
    assert.match(SUBJECT_WITH_REF, /--subject/);
    assert.match(BODY_WITH_REF, /--body/);
  });

  it("title/subject/body value patterns require the ref inside the value region", () => {
    const titleRe = new RegExp(TITLE_WITH_REF, "i");
    assert.equal(titleRe.test('--title "feat: x (closes #12)"'), true);
    assert.equal(titleRe.test("--title plain"), false);
    const subjectRe = new RegExp(SUBJECT_WITH_REF, "i");
    assert.equal(subjectRe.test('--subject "feat: x (fixes #7)"'), true);
    assert.equal(subjectRe.test("--subject plain"), false);
    const bodyRe = new RegExp(BODY_WITH_REF, "i");
    assert.equal(bodyRe.test('--body "see resolves #3"'), true);
    assert.equal(bodyRe.test("--body plain"), false);
  });
});
