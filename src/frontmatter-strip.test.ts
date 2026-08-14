// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Behavior pins for the pinned perl frontmatter-strip one-liner
 * (`FRONTMATTER_STRIP`).
 *
 * The body-file rules accept EXACTLY `<(perl -0777 -pe '<program>'
 * <path>)` — the program token is byte-pinned by the predicate, and
 * THIS suite pins what that fixed byte-string DOES: it spawns perl
 * with the pinned program against a fixture matrix and asserts the
 * exact output. Perl is one interpreter across platforms, so the
 * behavior pins hold identically on Linux and macOS CI.
 *
 * The strip contract (only frontmatter is removed — the H1 stays):
 *   - frontmatter = an opening `---` on line 1 (after an optional
 *     BOM) closed by the next line that is exactly `---` or `...`
 *   - the block AND any immediately following blank/whitespace-only
 *     lines are removed
 *   - CRLF input keeps its line endings on the remaining lines
 *   - unterminated frontmatter / no frontmatter / mid-document `---`
 *     → output byte-identical to input
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { FRONTMATTER_STRIP } from "./predicates/missing-vault-body-file.ts";

const fixtures: string[] = [];

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "frontmatter-strip-"));
  fixtures.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Run the pinned program against `input` (same argv shape the predicate uses). */
function strip(input: string): string {
  const dir = makeFixtureDir();
  const file = join(dir, "note.md");
  writeFileSync(file, input);
  const res = spawnSync("perl", ["-0777", "-pe", FRONTMATTER_STRIP, file], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `perl failed: ${res.stderr}`);
  return res.stdout;
}

describe("FRONTMATTER_STRIP — pinned perl one-liner behavior", () => {
  it("strips frontmatter + H1 stays (basic note)", () => {
    assert.equal(
      strip("---\ntags: [a]\n---\n# Title\n\nBody.\n"),
      "# Title\n\nBody.\n",
    );
  });

  it("strips frontmatter from a body-only note", () => {
    assert.equal(strip("---\na: 1\n---\nBody only.\n"), "Body only.\n");
  });

  it("passes a note without frontmatter through byte-identical", () => {
    const input = "# Title\n\nNo frontmatter.\n";
    assert.equal(strip(input), input);
  });

  it("passes unterminated frontmatter through byte-identical", () => {
    const input = "---\ntags: [a]\n";
    assert.equal(strip(input), input);
  });

  it("strips CRLF frontmatter and preserves CRLF on the remaining lines", () => {
    assert.equal(
      strip("---\r\ntags: [a]\r\n---\r\n# Title\r\n\r\nBody.\r\n"),
      "# Title\r\n\r\nBody.\r\n",
    );
  });

  it("strips a BOM along with the frontmatter", () => {
    assert.equal(strip("\uFEFF---\ntags: [a]\n---\nBody.\n"), "Body.\n");
  });

  it("accepts the ... YAML closer", () => {
    assert.equal(strip("---\na: 1\n...\nBody.\n"), "Body.\n");
  });

  it("leaves a mid-document --- alone (not on line 1)", () => {
    const input = "# T\n\n---\nnot frontmatter\n---\n";
    assert.equal(strip(input), input);
  });

  it("passes an empty file through", () => {
    assert.equal(strip(""), "");
  });

  it("leaves a leading blank line before --- alone (not frontmatter)", () => {
    const input = "\n---\na: 1\n---\nBody.\n";
    assert.equal(strip(input), input);
  });

  it("skips blank lines right after the closer", () => {
    assert.equal(strip("---\na: 1\n---\n\n\nBody.\n"), "Body.\n");
  });

  it("skips whitespace-only lines right after the closer", () => {
    assert.equal(strip("---\n   \n---\nBody.\n"), "Body.\n");
  });

  it("handles an empty frontmatter block (closer on line 2)", () => {
    assert.equal(strip("---\n---\nBody.\n"), "Body.\n");
  });

  it("handles BOM + CRLF + ... closer combined", () => {
    assert.equal(
      strip("\uFEFF---\r\ntags: [a]\r\n...\r\nB1\r\nB2\r\n"),
      "B1\r\nB2\r\n",
    );
  });

  it("keeps the H1 (only frontmatter is stripped)", () => {
    assert.equal(
      strip("---\na: 1\n---\n# Kept Title\n\nBody.\n"),
      "# Kept Title\n\nBody.\n",
    );
  });

  it("keeps ## headings and #foo untouched", () => {
    assert.equal(
      strip("---\na: 1\n---\n## Section\n\n#foo\n"),
      "## Section\n\n#foo\n",
    );
  });
});
