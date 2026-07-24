import assert from "node:assert/strict";
import { test } from "node:test";

import { bindCell, likePattern, quoteId, wireCell, wireValue } from "./sql.ts";

test("quoteId doubles embedded quotes so identifiers can't break out", () => {
  assert.equal(quoteId("users"), '"users"');
  assert.equal(quoteId('we"ird'), '"we""ird"');
  assert.equal(quoteId('"; DROP TABLE t; --'), '"""; DROP TABLE t; --"');
});

test("likePattern escapes wildcards so filters match literally", () => {
  assert.equal(likePattern("abc"), "%abc%");
  // The regression this exists for: `_` matched any character, so filtering a
  // column for `user_id` also returned `userXid`.
  assert.equal(likePattern("user_id"), "%user\\_id%");
  assert.equal(likePattern("50%"), "%50\\%%");
  assert.equal(likePattern("a\\b"), "%a\\\\b%");
  assert.equal(likePattern("%"), "%\\%%");
});

test("wireValue keeps precision by degrading huge integers to strings", () => {
  assert.equal(wireValue(42n), 42);
  assert.equal(wireValue(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.equal(wireValue(BigInt(Number.MAX_SAFE_INTEGER) + 1n), "9007199254740992");
  assert.equal(wireValue(BigInt(Number.MIN_SAFE_INTEGER) - 1n), "-9007199254740992");
  assert.equal(wireValue("untouched"), "untouched");
  assert.equal(wireValue(null), null);
});

test("wireCell normalizes every storage class the driver can return", () => {
  assert.equal(wireCell(null), null);
  assert.equal(wireCell(undefined), null);
  assert.equal(wireCell("text"), "text");
  assert.equal(wireCell(1.5), 1.5);
  assert.equal(wireCell(7n), 7);
  assert.deepEqual(wireCell(new Uint8Array([0xde, 0xad])), { blob: "3q0=" });
});

test("bindCell round-trips a BLOB through the JSON bridge without loss", () => {
  const original = new Uint8Array([0, 1, 250, 255, 128]);
  const restored = bindCell(wireCell(original));
  assert.ok(Buffer.isBuffer(restored));
  assert.deepEqual(new Uint8Array(restored), original);
});

test("bindCell passes primitives through untouched", () => {
  assert.equal(bindCell(null), null);
  assert.equal(bindCell("x"), "x");
  assert.equal(bindCell(3), 3);
});
