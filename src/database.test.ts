import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { SqliteDatabase } from "./database.ts";
import type { TableQuery } from "./protocol.ts";

const Driver = createRequire(import.meta.url)("better-sqlite3");

let dir: string;
let file: string;
let db: SqliteDatabase;

const query = (over: Partial<TableQuery> = {}): TableQuery => ({
  table: "t",
  page: 0,
  pageSize: 100,
  sort: null,
  filters: [],
  ...over,
});

before(() => {
  dir = mkdtempSync(join(tmpdir(), "sqlite-explorer-test-"));
  file = join(dir, "t.db");
});

after(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  db?.close();
  rmSync(file, { force: true });
  // SqliteDatabase opens with fileMustExist, so seed the file with the driver directly.
  const raw = new Driver(file);
  raw.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, blob BLOB);
    INSERT INTO t (name, qty, blob) VALUES
      ('alpha', 1, NULL),
      ('user_id', 2, NULL),
      ('100%', 3, NULL),
      ('userXid', 4, NULL);
    CREATE TABLE nr (a TEXT, b TEXT, PRIMARY KEY (a, b)) WITHOUT ROWID;
    INSERT INTO nr VALUES ('x', 'y');
  `);
  raw.close();
  db = new SqliteDatabase(file, false);
});

const rowsOf = (q = query()) => db.getTableData(q, true).result.rows;
// Columns are [id, name, qty, blob] — the rowid is stripped before rows are returned.
const namesOf = (q = query()) => rowsOf(q).map((r) => r[1]);

describe("filters", () => {
  test("underscore is matched literally, not as a wildcard", () => {
    const names = namesOf(query({ filters: [{ column: "name", value: "user_id" }] }));
    assert.deepEqual(names, ["user_id"]); // must NOT include 'userXid'
  });

  test("percent is matched literally", () => {
    const names = namesOf(query({ filters: [{ column: "name", value: "100%" }] }));
    assert.deepEqual(names, ["100%"]);
  });

  test("a bare percent matches only rows containing one", () => {
    const names = namesOf(query({ filters: [{ column: "name", value: "%" }] }));
    assert.deepEqual(names, ["100%"]);
  });

  test("ordinary substrings still match", () => {
    const names = namesOf(query({ filters: [{ column: "name", value: "user" }] }));
    assert.deepEqual(names, ["user_id", "userXid"]);
  });
});

describe("schema", () => {
  test("captures the CREATE statement", () => {
    const t = db.readSchema("t.db").tables.find((x) => x.name === "t");
    assert.ok(t?.ddl?.startsWith("CREATE TABLE t"));
  });

  test("flags WITHOUT ROWID tables as having no rowid", () => {
    const tables = db.readSchema("t.db").tables;
    assert.equal(tables.find((x) => x.name === "t")?.hasRowId, true);
    assert.equal(tables.find((x) => x.name === "nr")?.hasRowId, false);
  });
});

describe("undo", () => {
  test("restores the previous cell value", () => {
    const undo = db.updateCell("t", 1, "name", "CHANGED");
    assert.equal(rowsOf()[0][1], "CHANGED");
    db.applyUndo(undo);
    assert.equal(rowsOf()[0][1], "alpha");
  });

  test("round-trips through redo", () => {
    const undo = db.updateCell("t", 1, "name", "CHANGED");
    const { undo: redo } = db.applyUndo(undo);
    assert.ok(redo);
    assert.equal(rowsOf()[0][1], "alpha");
    db.applyUndo(redo);
    assert.equal(rowsOf()[0][1], "CHANGED");
  });

  test("restores a NULL rather than an empty string", () => {
    const undo = db.updateCell("t", 1, "blob", "not-null-anymore");
    db.applyUndo(undo);
    assert.equal(rowsOf()[0][3], null);
  });

  test("undoing an insert removes exactly that row", () => {
    const { undo } = db.insertRow("t", { name: "temp", qty: 99 });
    assert.equal(rowsOf().length, 5);
    assert.ok(undo);
    db.applyUndo(undo);
    assert.equal(rowsOf().length, 4);
    assert.ok(!namesOf().includes("temp"));
  });

  test("undoing a delete restores rows at their original rowids", () => {
    const original = db.getTableData(query(), true);
    const { undo } = db.deleteRows("t", [2, 3]);
    assert.ok(undo);
    assert.equal(rowsOf().length, 2);

    db.applyUndo(undo);
    const restored = db.getTableData(query(), true);
    assert.deepEqual(restored.result.rows, original.result.rows);
    assert.deepEqual(restored.result.rowids, original.result.rowids);
  });

  test("a BLOB survives the delete/undo round trip byte-for-byte", () => {
    const bytes = Buffer.from([0, 1, 250, 255, 128]);
    db.updateCell("t", 1, "blob", { blob: bytes.toString("base64") });
    const stored = rowsOf()[0][3];
    assert.ok(stored instanceof Uint8Array);
    assert.deepEqual(Buffer.from(stored), bytes);

    const { undo } = db.deleteRows("t", [1]);
    assert.ok(undo);
    db.applyUndo(undo);
    const afterUndo = rowsOf()[0][3];
    assert.ok(afterUndo instanceof Uint8Array);
    assert.deepEqual(Buffer.from(afterUndo), bytes);
  });

  test("multi-column row edits revert every column", () => {
    const undo = db.updateRow("t", 1, { name: "x", qty: 999 });
    assert.deepEqual(rowsOf()[0].slice(0, 3), [1, "x", 999]);
    db.applyUndo(undo);
    assert.deepEqual(rowsOf()[0].slice(0, 3), [1, "alpha", 1]);
  });
});

describe("cascading deletes", () => {
  // A cascade removes rows we never snapshotted. Restoring only the parent would
  // look like a successful undo while the children stay gone, so no undo is offered.
  const seedCascade = () => {
    db.close();
    const cascadeFile = join(dir, "cascade.db");
    rmSync(cascadeFile, { force: true });
    const raw = new Driver(cascadeFile);
    raw.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE
      );
      INSERT INTO parent (id, name) VALUES (1, 'p'), (2, 'q');
      INSERT INTO child (parent_id) VALUES (1), (1), (1);
    `);
    raw.close();
    db = new SqliteDatabase(cascadeFile, false);
  };

  test("offers no undo when the delete cascaded", () => {
    seedCascade();
    const { changes, undo } = db.deleteRows("parent", [1]);
    assert.equal(changes, 1);
    assert.equal(undo, undefined);
  });

  test("previewDelete reports the blast radius without writing", () => {
    seedCascade();
    const preview = db.previewDelete("parent", [1]);
    assert.equal(preview.direct, 1);
    assert.equal(preview.collateral, 3);
    assert.deepEqual(preview.tables, ["child"]);

    const remaining = db
      .getTableData({ ...query(), table: "parent" }, true)
      .result.rows.map((r) => r[1]);
    assert.deepEqual(remaining, ["p", "q"], "preview must not delete anything");
  });

  test("previewDelete reports no collateral for a childless row", () => {
    seedCascade();
    const preview = db.previewDelete("parent", [2]);
    assert.equal(preview.direct, 1);
    assert.equal(preview.collateral, 0);
    assert.deepEqual(preview.tables, []);
  });

  test("still offers undo when nothing cascaded", () => {
    seedCascade();
    const { undo } = db.deleteRows("parent", [2]); // row 2 has no children
    assert.ok(undo);
    db.applyUndo(undo);
    const names = db
      .getTableData({ ...query(), table: "parent" }, true)
      .result.rows.map((r) => r[1]);
    assert.deepEqual(names, ["p", "q"]);
  });
});

describe("read-only mode", () => {
  test("rejects writes", () => {
    db.close();
    db = new SqliteDatabase(file, true);
    assert.throws(() => db.updateCell("t", 1, "name", "nope"), /read-only/i);
  });
});

describe("data_version", () => {
  test("ignores our own writes but sees another connection's", () => {
    const start = db.dataVersion();
    db.updateCell("t", 1, "name", "self");
    assert.equal(db.dataVersion(), start, "own write must not bump data_version");

    const other = new SqliteDatabase(file, false);
    other.updateCell("t", 1, "name", "other");
    other.close();
    assert.notEqual(db.dataVersion(), start, "external write must bump data_version");
  });
});
