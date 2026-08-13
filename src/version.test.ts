import assert from "node:assert/strict";
import { test } from "node:test";

import { isNewerVersion, parseGitHubRelease } from "./version.ts";

test("isNewerVersion compares stable semantic versions numerically", () => {
  assert.equal(isNewerVersion("v0.2.4", "0.2.3"), true);
  assert.equal(isNewerVersion("0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.2.3", "0.2.3"), false);
  assert.equal(isNewerVersion("0.2.2", "0.2.3"), false);
});

test("isNewerVersion rejects malformed and prerelease versions", () => {
  assert.equal(isNewerVersion("latest", "0.2.3"), false);
  assert.equal(isNewerVersion("v0.3.0-beta.1", "0.2.3"), false);
  assert.equal(isNewerVersion("0.3", "0.2.3"), false);
  assert.equal(isNewerVersion("0.3.0", "development"), false);
});

test("parseGitHubRelease accepts only this repository's HTTPS release URLs", () => {
  assert.deepEqual(
    parseGitHubRelease({
      tag_name: "v0.2.4",
      html_url: "https://github.com/humanonlyweb/sqlite-explorer/releases/tag/v0.2.4",
    }),
    {
      version: "0.2.4",
      url: "https://github.com/humanonlyweb/sqlite-explorer/releases/tag/v0.2.4",
    },
  );
  assert.equal(
    parseGitHubRelease({
      tag_name: "v9.9.9",
      html_url: "https://github.com/someone/another-project/releases/tag/v9.9.9",
    }),
    null,
  );
  assert.equal(
    parseGitHubRelease({
      tag_name: "v0.2.4",
      html_url: "http://github.com/humanonlyweb/sqlite-explorer/releases/tag/v0.2.4",
    }),
    null,
  );
  assert.equal(parseGitHubRelease({ tag_name: 24, html_url: null }), null);
});
