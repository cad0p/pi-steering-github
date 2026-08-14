// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Unit tests for the strip helper (`src/strip.ts`) and the CLI
 * (`src/cli.ts`). `stripVaultBody` is pure text-in/text-out;
 * `stripVaultBodyFile` reads a real fixture file; `runCli` writes to
 * captured streams (no process is spawned).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import { runCli } from "./cli.ts";
import { stripVaultBody, stripVaultBodyFile } from "./strip.ts";

const fixtures: string[] = [];

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "github-plugin-strip-"));
  fixtures.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// stripVaultBody
// ---------------------------------------------------------------------------

describe("stripVaultBody", () => {
  it("strips frontmatter and the leading H1", () => {
    assert.equal(
      stripVaultBody("---\ntags: [test]\n---\n# Title\n\nBody text.\n"),
      "Body text.\n",
    );
  });

  it("strips frontmatter only (no H1)", () => {
    assert.equal(
      stripVaultBody("---\ntags: [test]\nstatus: open\n---\nBody text.\n"),
      "Body text.\n",
    );
  });

  it("strips the leading H1 only (no frontmatter)", () => {
    assert.equal(stripVaultBody("# Title\n\nBody text.\n"), "Body text.\n");
  });

  it("returns content with neither frontmatter nor H1 as-is", () => {
    const text = "Body text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("keeps ## headings (only ATX H1 is stripped)", () => {
    const text = "## Section\n\nBody text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("keeps #foo (no space after # is not a heading)", () => {
    const text = "#foo\n\nBody text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("keeps an indented `  #` heading (never stripped)", () => {
    const text = "  # Title\n\nBody text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("keeps an unterminated frontmatter block (fail-safe)", () => {
    const text = "---\ntags: [test]\nBody text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("tolerates CRLF input (strips, rejoins with LF)", () => {
    assert.equal(
      stripVaultBody("---\r\ntags: [test]\r\n---\r\n# Title\r\n\r\nBody.\r\n"),
      "Body.\n",
    );
  });

  it("strips a leading BOM together with the frontmatter", () => {
    assert.equal(
      stripVaultBody("\uFEFF---\ntags: [test]\n---\n# Title\n\nBody.\n"),
      "Body.\n",
    );
  });

  it("keeps a BOM when nothing is stripped", () => {
    const text = "\uFEFFBody text.\n";
    assert.equal(stripVaultBody(text), text);
  });

  it("skips blank lines between frontmatter, H1 and body", () => {
    assert.equal(
      stripVaultBody("---\ntags: [test]\n---\n\n\n# Title\n\n\nBody text.\n"),
      "Body text.\n",
    );
  });

  it("accepts `...` as the frontmatter closer", () => {
    assert.equal(
      stripVaultBody("---\ntags: [test]\n...\n# Title\n\nBody.\n"),
      "Body.\n",
    );
  });

  it("drops a bare `#` line as an H1", () => {
    assert.equal(stripVaultBody("#\n\nBody.\n"), "Body.\n");
  });

  it("drops an empty `# ` heading", () => {
    assert.equal(stripVaultBody("# \n\nBody.\n"), "Body.\n");
  });

  it("handles an empty string", () => {
    assert.equal(stripVaultBody(""), "");
  });

  it("strips a frontmatter-only note to empty", () => {
    assert.equal(stripVaultBody("---\ntags: [test]\n---\n"), "");
  });
});

// ---------------------------------------------------------------------------
// stripVaultBodyFile
// ---------------------------------------------------------------------------

describe("stripVaultBodyFile", () => {
  it("reads a fixture file and strips frontmatter + H1", () => {
    const dir = makeFixtureDir();
    const file = join(dir, "note.md");
    writeFileSync(file, "---\ntags: [test]\n---\n# Title\n\nBody text.\n");
    assert.equal(stripVaultBodyFile(file), "Body text.\n");
  });

  it("leaves the vault file byte-identical (read-only helper)", () => {
    const dir = makeFixtureDir();
    const file = join(dir, "note.md");
    const original = "---\ntags: [test]\n---\n# Title\n\nBody text.\n";
    writeFileSync(file, original);
    stripVaultBodyFile(file);
    assert.equal(readFileSync(file, "utf8"), original);
  });
});

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

/** A capture stream pair: runCli writes here, `read()` returns what a stream got. */
function capture(): {
  stdout: Writable;
  stderr: Writable;
  read: (stream: "stdout" | "stderr") => string;
} {
  const buffers: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };
  const make = (name: "stdout" | "stderr") =>
    new Writable({
      write(chunk, _enc, cb) {
        buffers[name] += chunk.toString();
        cb();
      },
    });
  return {
    stdout: make("stdout"),
    stderr: make("stderr"),
    read: (stream) => buffers[stream] ?? "",
  };
}

describe("runCli", () => {
  it("strip writes the stripped body to stdout, exit 0", () => {
    const dir = makeFixtureDir();
    const file = join(dir, "note.md");
    writeFileSync(file, "---\ntags: [test]\n---\n# Title\n\nBody text.\n");
    const io = capture();
    assert.equal(runCli(["strip", file], io), 0);
    assert.equal(io.read("stdout"), "Body text.\n");
  });

  it("strip writes exactly the file content (no added trailing newline)", () => {
    const dir = makeFixtureDir();
    const file = join(dir, "note.md");
    writeFileSync(file, "# Title\n\nBody without trailing newline");
    const io = capture();
    assert.equal(runCli(["strip", file], io), 0);
    assert.equal(io.read("stdout"), "Body without trailing newline");
  });

  it("strip with a missing file → exit 1 + stderr message", () => {
    const io = capture();
    assert.equal(runCli(["strip", "/nonexistent/note.md"], io), 1);
    assert.match(io.read("stderr"), /cannot strip/);
  });

  it("--help → usage on stdout, exit 0", () => {
    const io = capture();
    assert.equal(runCli(["--help"], io), 0);
    assert.match(io.read("stdout"), /Usage:/);
    assert.match(io.read("stdout"), /pi-steering-github strip <file>/);
  });

  it("-h → usage on stdout, exit 0", () => {
    const io = capture();
    assert.equal(runCli(["-h"], io), 0);
    assert.match(io.read("stdout"), /Usage:/);
  });

  it("no args → usage on stderr, exit 1", () => {
    const io = capture();
    assert.equal(runCli([], io), 1);
    assert.equal(io.read("stdout"), ""); // stdout stays clean
    assert.match(io.read("stderr"), /Usage:/);
  });

  it("unknown subcommand → usage on stderr, exit 1", () => {
    const io = capture();
    assert.equal(runCli(["edit", "x.md"], io), 1);
    assert.match(io.read("stderr"), /unknown command/);
  });
});
