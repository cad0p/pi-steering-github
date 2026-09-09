// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Value pins for the gh CLI descriptor (`./descriptors.ts`, #61
 * acceptance: "tail finalized …, value-pinned").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GH_ADD_README_FLAG,
  GH_BODY_FILE_FLAG,
  GH_BODY_FLAG,
  GH_CLI_DESCRIPTOR,
  GH_GITIGNORE_FLAG,
  GH_HELP_FLAG,
  GH_HOSTNAME_FLAG,
  GH_LICENSE_FLAG,
  GH_REPO_FLAG,
  GH_SUBJECT_FLAG,
  GH_TEMPLATE_FLAG,
  GH_TITLE_FLAG,
  GH_VERSION_FLAG,
} from "./descriptors.ts";

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

  it("entry consts are the table values (single source — table and rules can't drift)", () => {
    const flags = GH_CLI_DESCRIPTOR.flags;
    assert.equal(flags.repo, GH_REPO_FLAG);
    assert.equal(flags.hostname, GH_HOSTNAME_FLAG);
    assert.equal(flags.bodyFile, GH_BODY_FILE_FLAG);
    assert.equal(flags.body, GH_BODY_FLAG);
    assert.equal(flags.title, GH_TITLE_FLAG);
    assert.equal(flags.subject, GH_SUBJECT_FLAG);
    assert.equal(flags.addReadme, GH_ADD_README_FLAG);
    assert.equal(flags.gitignore, GH_GITIGNORE_FLAG);
    assert.equal(flags.license, GH_LICENSE_FLAG);
    assert.equal(flags.template, GH_TEMPLATE_FLAG);
    assert.equal(flags.help, GH_HELP_FLAG);
    assert.equal(flags.version, GH_VERSION_FLAG);
  });
});
