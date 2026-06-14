import { Router } from "express";

import { finalizeScaffold } from "../lib/scaffold";
import { matchTemplate, MOCK_PROVIDERS } from "../lib/mock";
import { validateScaffold } from "../lib/types";
import { extractBlock } from "./blocks";
import { chat, defaults, hasCredentials, listProviders } from "./aiassist";
import {
  extractJson,
  extractNql,
  extractPlan,
  nqlMessages,
  nqlSystem,
  planMessages,
  planSystem,
  runnerMessages,
  runnerSystem,
  sentinelMessages,
  sentinelSystem,
} from "./prompts";

/**
 * /api router. The AiAssist key never leaves this process. Every path degrades
 * gracefully to deterministic mock output, so the studio is always usable.
 */
export const api = Router();

/**
 * Pull the scaffold JSON out of a raw completion: KeyStone-Lite sentinel block
 * (<<<SCAFFOLD>>>…<<<END>>>) first, then a brace-slice fallback (extractJson).
 * Throws if neither yields parseable JSON (caller falls back to a mock template).
 */
function scaffoldJson(raw: string): unknown {
  const block = extractBlock(raw, "SCAFFOLD") ?? raw;
  try {
    return JSON.parse(block);
  } catch {
    return extractJson(block);
  }
}

api.get("/status", (_req, res) => {
  const d = defaults();
  res.json({ mode: hasCredentials() ? "live" : "mock", defaultProvider: d.provider, defaultModel: d.model });
});

// Providers + models for the UI selectors and marquee (bearer auth, server-side).
api.get("/providers", async (_req, res) => {
  if (!hasCredentials()) {
    res.json({ ...MOCK_PROVIDERS, mode: "mock" });
    return;
  }
  try {
    const result = await listProviders();
    res.json({ ...result, mode: "live" });
  } catch (err) {
    // Credentials exist, so stay LIVE — degrade to the configured default
    // provider/model so the selectors still work. Never relabel as "mock".
    const d = defaults();
    res.json({
      defaultProvider: d.provider,
      providers: [{ id: d.provider, label: d.provider, isDefault: true, models: [{ id: d.model, name: d.model }] }],
      mode: "live",
      error: String(err),
    });
  }
});

api.post("/generate", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  const provider = req.body?.provider ? String(req.body.provider) : undefined;
  const model = req.body?.model ? String(req.body.model) : undefined;

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Demo mode — ONLY when there are no AiAssist credentials. With credentials,
  // generation is always live and failures are surfaced (never a silent mock).
  if (!hasCredentials()) {
    res.json({
      scaffold: matchTemplate(prompt),
      mode: "mock",
      notes: ["Demo mode (no AiAssist credentials) — deterministic template. Add a key for live AI generation."],
    });
    return;
  }

  const notes: string[] = [];
  try {
    // ── Runner: fast first-pass generation ──────────────────────────────────
    const raw = await chat({
      messages: [{ role: "system", content: runnerSystem() }, ...runnerMessages(prompt)],
      model,
      provider,
      temperature: 0.2,
      maxTokens: 4000,
    });
    let candidate = scaffoldJson(raw);
    let result = validateScaffold(candidate);

    // ── Sentinel: validate / repair if the runner output is invalid ─────────
    if (!result.ok) {
      notes.push("Runner output failed validation; sentinel repaired it.");
      const repaired = await chat({
        messages: [
          { role: "system", content: sentinelSystem() },
          ...sentinelMessages(prompt, JSON.stringify(candidate), result.errors ?? []),
        ],
        model,
        provider,
        temperature: 0,
        maxTokens: 4000,
      });
      candidate = scaffoldJson(repaired);
      result = validateScaffold(candidate);
    }

    // Live mode never silently falls back to a mock. If it still won't validate
    // after the sentinel repair pass, surface the real error.
    if (!result.ok || !result.scaffold) {
      res.status(422).json({
        error: "Generation didn't produce a valid schema",
        details: [...notes, ...(result.errors ?? []).slice(0, 8)],
      });
      return;
    }

    // Fill any server-owned artifacts (snippets/README) the model left empty.
    const scaffold = finalizeScaffold(result.scaffold);
    res.json({ scaffold, mode: "live", provider, model, notes });
  } catch (err) {
    res.status(502).json({ error: "AiAssist generation error", details: [String(err)] });
  }
});

// Natural language → NQL (the query console). Compilation is server-side via
// AiAssist; execution happens in the browser against the scaffold's seed data.
api.post("/nql", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  const schema = req.body?.schema;
  if (!prompt || !schema?.collections?.length) {
    res.status(400).json({ error: "prompt and schema are required" });
    return;
  }
  // No mocks: natural-language → NQL is an API capability. Without credentials we
  // say so plainly (the client still lets you write and run NQL by hand).
  if (!hasCredentials()) {
    res.status(503).json({
      error: "AiAssist API not configured",
      details: ["Set AIASSIST_API_KEY to compile natural language to NQL. You can still write and run NQL manually."],
    });
    return;
  }
  try {
    const raw = await chat({
      messages: [{ role: "system", content: nqlSystem(schema) }, ...nqlMessages(prompt)],
      temperature: 0,
      maxTokens: 160,
    });
    const nql = extractNql(raw);
    if (!/^from\s/i.test(nql)) {
      res.status(422).json({ error: "Model did not return a valid NQL query", details: [nql.slice(0, 200)] });
      return;
    }
    res.json({ nql, mode: "live" });
  } catch (err) {
    res.status(502).json({ error: "AiAssist NQL compile error", details: [String(err)] });
  }
});

// Natural language → action plan: a read (query) OR a write/delete. The plan is
// previewed/edited in the UI and only executed on explicit confirmation. No mocks.
api.post("/plan", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  const schema = req.body?.schema;
  if (!prompt || !schema?.collections?.length) {
    res.status(400).json({ error: "prompt and schema are required" });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({
      error: "AiAssist API not configured",
      details: ["Set AIASSIST_API_KEY to interpret natural-language actions."],
    });
    return;
  }
  try {
    const raw = await chat({
      messages: [{ role: "system", content: planSystem(schema) }, ...planMessages(prompt)],
      temperature: 0,
      maxTokens: 400,
    });
    const plan = extractPlan(raw) as Record<string, unknown> | null;
    const kind = plan && typeof plan === "object" ? plan.kind : undefined;
    if (!plan || !["query", "write", "delete", "unsupported"].includes(String(kind))) {
      res.status(422).json({ error: "Model did not return a valid action", details: [JSON.stringify(plan).slice(0, 200)] });
      return;
    }
    const names = new Set((schema.collections as Array<{ name: string }>).map((c) => c.name));
    if ((kind === "write" || kind === "delete") && !names.has(String(plan.collection))) {
      res.status(422).json({ error: `Unknown collection "${plan.collection}"` });
      return;
    }
    res.json({ plan, mode: "live" });
  } catch (err) {
    res.status(502).json({ error: "AiAssist plan error", details: [String(err)] });
  }
});

// Translate SQL or a Redis command string to NQL.
// lang = "sql" | "redis"
// input = the SQL string or a Redis command line (e.g. "HGETALL user:1")
// schema = {collections, relations, indexes} — used for SQL table/column validation
api.post("/translate", (req, res) => {
  const { lang, input, schema } = req.body ?? {};
  if (!lang || !input) {
    res.status(400).json({ error: "lang and input are required" });
    return;
  }

  if (lang === "sql") {
    try {
      // Inline a tiny SQL→NQL translator (mirrors nedb.sql.sql_to_nql logic in TS)
      // For SELECT statements we convert to NQL; other statements surface as writes.
      const up = String(input).trim().toUpperCase();
      if (up.startsWith("SELECT")) {
        const nql = sqlToNql(String(input));
        res.json({ kind: "query", nql });
      } else if (up.startsWith("INSERT")) {
        res.json({ kind: "sql_write", sql: String(input), op: "insert" });
      } else if (up.startsWith("UPDATE")) {
        res.json({ kind: "sql_write", sql: String(input), op: "update" });
      } else if (up.startsWith("DELETE")) {
        res.json({ kind: "sql_write", sql: String(input), op: "delete" });
      } else {
        res.status(400).json({ error: `Unsupported SQL statement type. Supported: SELECT, INSERT, UPDATE, DELETE.` });
      }
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
    return;
  }

  if (lang === "redis") {
    try {
      const nql = redisToNql(String(input));
      if (nql === null) {
        res.status(400).json({ error: `Cannot translate Redis command to NQL. Use the NQL tab for unsupported commands.` });
      } else {
        res.json({ kind: "query", nql });
      }
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
    return;
  }

  res.status(400).json({ error: `Unknown lang: ${String(lang)}. Use "sql" or "redis".` });
});

// ── Inline translators (mirrors the Python adapters without the full parser) ──

function sqlToNql(sql: string): string {
  const s = sql.trim().replace(/;+$/, "");
  // FROM
  const fromM = s.match(/\bFROM\s+(\w+)/i);
  if (!fromM) throw new Error("No FROM clause found");
  const table = fromM[1];
  const parts: string[] = [`FROM ${table}`];
  // AS OF
  const asofM = s.match(/\bAS\s+OF\s+(\d+)/i);
  if (asofM) parts.push(`AS OF ${asofM[1]}`);
  // WHERE
  const whereM = s.match(/\bWHERE\b([\s\S]*?)(?:\bORDER\b|\bLIMIT\b|\bSEARCH\b|$)/i);
  if (whereM) {
    let w = whereM[1].trim().replace(/'([^']*)'/g, '"$1"');
    // LIKE → SEARCH (extract term, drop the condition from WHERE)
    const likeM = w.match(/(\w+)\s+LIKE\s+"([^"]*)"/i);
    if (likeM) {
      w = w.replace(likeM[0], "").replace(/\bAND\b\s*$/i, "").trim();
      const term = likeM[2].replace(/%/g, "").trim();
      if (w) parts.push(`WHERE ${w}`);
      if (term) parts.push(`SEARCH "${term}"`);
    } else if (w) {
      parts.push(`WHERE ${w}`);
    }
  }
  // ORDER BY
  const orderM = s.match(/\bORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (orderM) parts.push(`ORDER BY ${orderM[1]} ${(orderM[2] || "ASC").toUpperCase()}`);
  // LIMIT
  const limitM = s.match(/\bLIMIT\s+(\d+)/i);
  if (limitM) parts.push(`LIMIT ${limitM[1]}`);
  return parts.join(" ");
}

function redisToNql(cmd: string): string | null {
  const parts = cmd.trim().split(/\s+/);
  const c = (parts[0] || "").toUpperCase();
  const key = parts[1] || "";
  // Map read-only Redis commands that have a NQL equivalent
  if (c === "KEYS") return `FROM _kv`;
  if (c === "HGETALL" && key) return `FROM ${safeNqlName(key)}`;
  if (c === "SMEMBERS" && key) {
    return `FROM _kv WHERE _id = "_set_${safeNqlName(key)}"`;
  }
  // Commands that require a full database call — surface as unsupported in translator
  return null;
}

function safeNqlName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, (c) => `__${c.charCodeAt(0).toString(16).padStart(2, "0")}__`);
}
