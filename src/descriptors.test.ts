// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Value pins for the gh CLI descriptor (`./descriptors.ts`, #61
 * acceptance: "tail finalized …, value-pinned").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GH_CLI_DESCRIPTOR } from "./descriptors.ts";

describe("github plugin — gh CLI descriptor", () => {
  it("pins the descriptor by value (position policy + full flag table)", () => {
    assert.deepEqual(GH_CLI_DESCRIPTOR, {
      positionPolicy: "globals-anywhere",
      flags: {
        repo: { aliases: ["-R", "--repo"], takesValue: true },
        hostname: { aliases: ["--hostname"], takesValue: true },
        bodyFile: { aliases: ["--body-file", "-F"], takesValue: true },
        body: { aliases: ["--body", "-b"], takesValue: true },
        title: { aliases: ["--title", "-t"], takesValue: true },
        subject: { aliases: ["--subject", "-t"], takesValue: true },
        addReadme: { aliases: ["--add-readme"], takesValue: false },
        gitignore: { aliases: ["--gitignore", "-g"], takesValue: true },
        license: { aliases: ["--license", "-l"], takesValue: true },
        template: { aliases: ["--template", "-p"], takesValue: true },
        help: { aliases: ["-h", "--help"], takesValue: false },
        version: { aliases: ["--version"], takesValue: false },
      },
    });
  });

  it("the table owns every flag entry: exactly the twelve keys, no sideways consts", () => {
    // Doctrine alignment (core git-descriptor shape): entries live
    // INLINE in the table — there are no standalone exported
    // `GH_*_FLAG` consts for the table and the rules to drift apart.
    // Consumers read `GH_CLI_DESCRIPTOR.flags.<key>` (or a
    // destructured `ghFlags` alias). This pin guards the key set; the
    // value pin above guards every aliases/takesValue row.
    assert.deepEqual(Object.keys(GH_CLI_DESCRIPTOR.flags).sort(), [
      "addReadme",
      "body",
      "bodyFile",
      "gitignore",
      "help",
      "hostname",
      "license",
      "repo",
      "subject",
      "template",
      "title",
      "version",
    ]);
  });
});
