import { Router } from "express";

import { validateScaffold } from "../lib/types";
import * as nedb from "./nedb";
import type { NEDBScaffold } from "../lib/types";

/**
 * /api/databases — thin proxy from the browser to the NEDB server (nedbd). The
 * studio adds no database logic; it derives a deploy payload from a scaffold and
 * forwards queries/writes to the daemon, which owns persistence and integrity.
 */
export const databases = Router();

function fail(res: import("express").Response, e: unknown): void {
  res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
}

// Connection status (does the configured nedbd answer?).
databases.get("/status", async (_req, res) => {
  try {
    const h = await nedb.health();
    res.json({ connected: true, ...h });
  } catch (e) {
    res.json({ connected: false, error: e instanceof Error ? e.message : String(e) });
  }
});

databases.get("/", async (_req, res) => {
  try {
    res.json(await nedb.listDatabases());
  } catch (e) {
    fail(res, e);
  }
});

// Deploy: { scaffold } (studio derives init) OR { name, init } (raw passthrough).
databases.post("/", async (req, res) => {
  const body = req.body ?? {};
  try {
    if (body.scaffold) {
      const v = validateScaffold(body.scaffold);
      if (!v.ok || !v.scaffold) {
        res.status(400).json({ error: "invalid scaffold", details: v.errors ?? [] });
        return;
      }
      const out = await nedb.deployScaffold(body.name || v.scaffold.appName, v.scaffold);
      res.status(201).json(out);
      return;
    }
    if (body.name) {
      res.status(201).json(await nedb.createDatabase(nedb.slug(body.name), body.init));
      return;
    }
    res.status(400).json({ error: "scaffold or name is required" });
  } catch (e) {
    fail(res, e);
  }
});

databases.get("/:name", async (req, res) => {
  try {
    res.json(await nedb.getDatabase(req.params.name));
  } catch (e) {
    fail(res, e);
  }
});

databases.delete("/:name", async (req, res) => {
  try {
    res.json(await nedb.dropDatabase(req.params.name));
  } catch (e) {
    fail(res, e);
  }
});

databases.post("/:name/query", async (req, res) => {
  const nql = String(req.body?.nql ?? "").trim();
  if (!nql) {
    res.status(400).json({ error: "nql is required" });
    return;
  }
  try {
    res.json(await nedb.queryDatabase(req.params.name, nql));
  } catch (e) {
    fail(res, e);
  }
});

// Write a row. NEDB put is a full replace, so for an existing id we MERGE the
// patch onto the current row (correct "update" semantics); a new id is an insert.
databases.post("/:name/rows", async (req, res) => {
  const name = req.params.name;
  const { coll, id, doc } = req.body ?? {};
  if (!coll || id == null || typeof doc !== "object" || doc == null) {
    res.status(400).json({ error: "coll, id, and doc are required" });
    return;
  }
  try {
    let merged: Record<string, unknown> = { ...doc, _id: id };
    try {
      const safeId = String(id).replace(/"/g, "");
      const existing = await nedb.queryDatabase(name, `FROM ${coll} WHERE _id = "${safeId}" LIMIT 1`);
      const row = (existing.rows as Array<Record<string, unknown>> | undefined)?.[0];
      if (row) merged = { ...row, ...doc, _id: id };
    } catch {
      /* no existing row (or query failed) — treat as insert */
    }
    res.json(await nedb.putRow(name, { coll, id, doc: merged }));
  } catch (e) {
    fail(res, e);
  }
});

databases.delete("/:name/rows/:coll/:id", async (req, res) => {
  try {
    res.json(await nedb.deleteRow(req.params.name, req.params.coll, req.params.id));
  } catch (e) {
    fail(res, e);
  }
});

databases.post("/:name/batch", async (req, res) => {
  try {
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || !ops.length) {
      res.status(400).json({ error: "ops array is required" }); return;
    }
    // Forward each op through nedbd
    const results = [];
    for (const op of ops) {
      if (op.op === "put") {
        const r = await nedb.putRow(req.params.name, { coll: op.coll, id: op.id, doc: op.doc });
        results.push({ op: "put", id: op.id, ...r });
      } else if (op.op === "del") {
        const r = await nedb.deleteRow(req.params.name, op.coll, op.id);
        results.push({ op: "del", id: op.id, ...r });
      }
    }
    res.json({ results, count: results.length });
  } catch (e) {
    fail(res, e);
  }
});

databases.get("/:name/schema", async (req, res) => {
  try {
    const schema = await nedb.loadDeployedSchema(req.params.name);
    if (!schema) { res.status(404).json({ error: "schema not found" }); return; }
    res.json(schema);
  } catch (e) {
    fail(res, e);
  }
});

databases.get("/:name/verify", async (req, res) => {
  try {
    res.json(await nedb.verifyDatabase(req.params.name));
  } catch (e) {
    fail(res, e);
  }
});

databases.get("/:name/log", async (req, res) => {
  try {
    res.json(await nedb.logDatabase(req.params.name, Number(req.query.limit ?? 50)));
  } catch (e) {
    fail(res, e);
  }
});
