import assert from "node:assert/strict";
import { test } from "node:test";

import {
  csvCell,
  dateStamp,
  formatForPath,
  jsonValue,
  serializeRows,
  slugify,
  sqlLiteral,
  toCsvRow,
} from "./serialize.ts";

test("csvCell quotes only when the value would otherwise break the row", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("has,comma"), '"has,comma"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("carriage\rreturn"), '"carriage\rreturn"');
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(false), "false");
  assert.equal(csvCell(123n), "123");
  assert.equal(csvCell(new Uint8Array([1, 2, 3])), "[blob 3 bytes]");
});

test("toCsvRow joins cells without swallowing empties", () => {
  assert.equal(toCsvRow(["a", null, "c"]), "a,,c");
});

test("sqlLiteral emits re-parseable literals for every storage class", () => {
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(undefined), "NULL");
  assert.equal(sqlLiteral(12), "12");
  assert.equal(sqlLiteral(-0.5), "-0.5");
  assert.equal(sqlLiteral(9007199254740993n), "9007199254740993");
  assert.equal(sqlLiteral(true), "1");
  assert.equal(sqlLiteral(false), "0");
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(new Uint8Array([0xff, 0x00])), "X'ff00'");
});

test("jsonValue keeps big integers exact", () => {
  assert.equal(jsonValue(null), null);
  assert.equal(jsonValue(5n), 5);
  assert.equal(jsonValue(BigInt(Number.MAX_SAFE_INTEGER) + 2n), "9007199254740993");
  assert.equal(jsonValue(new Uint8Array([0xde, 0xad])), "3q0=");
});

const ROWS = [
  { columns: ["id", "name"], row: [1, "Ada"] },
  { columns: ["id", "name"], row: [2, 'Bob "The Comma", Jr'] },
];

test("serializeRows writes a CSV header once and uses CRLF", () => {
  assert.equal(
    serializeRows("csv", "people", ROWS),
    'id,name\r\n1,Ada\r\n2,"Bob ""The Comma"", Jr"',
  );
});

test("serializeRows emits one JSON object per line for jsonl", () => {
  assert.equal(
    serializeRows("jsonl", "people", ROWS),
    '{"id":1,"name":"Ada"}\n{"id":2,"name":"Bob \\"The Comma\\", Jr"}',
  );
});

test("serializeRows emits a single array for json", () => {
  assert.deepEqual(JSON.parse(serializeRows("json", "people", ROWS)), [
    { id: 1, name: "Ada" },
    { id: 2, name: 'Bob "The Comma", Jr' },
  ]);
});

test("serializeRows quotes identifiers and values in SQL inserts", () => {
  assert.equal(
    serializeRows("sql", 'peo"ple', [ROWS[0]]),
    'INSERT INTO "peo""ple" ("id", "name") VALUES (1, \'Ada\');',
  );
});

test("serializeRows on an empty result yields an empty string", () => {
  assert.equal(serializeRows("csv", "t", []), "");
  assert.equal(serializeRows("json", "t", []), "[]");
});

test("formatForPath picks the format from the extension, defaulting to CSV", () => {
  assert.equal(formatForPath("/tmp/a.sql"), "sql");
  assert.equal(formatForPath("/tmp/a.JSON"), "json");
  assert.equal(formatForPath("/tmp/a.jsonl"), "jsonl");
  assert.equal(formatForPath("/tmp/a.ndjson"), "jsonl");
  assert.equal(formatForPath("/tmp/a.csv"), "csv");
  assert.equal(formatForPath("/tmp/no-extension"), "csv");
});

test("slugify always yields a usable filename", () => {
  assert.equal(slugify("My Table"), "my-table");
  assert.equal(slugify("--weird__name--"), "weird-name");
  assert.equal(slugify("???"), "export");
});

test("dateStamp zero-pads month and day", () => {
  assert.equal(dateStamp(new Date(2026, 0, 5)), "01-05-2026");
  assert.equal(dateStamp(new Date(2026, 11, 31)), "12-31-2026");
});
