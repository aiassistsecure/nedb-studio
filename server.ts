import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { api } from "./src/server/generate";
import { databases } from "./src/server/databases";
import { settings } from "./src/server/settings";

/** Minimal .env loader (no dependency). Real env always wins. */
function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const app = express();

// ── Request logger ──────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  // Capture originalUrl NOW — Express mutates req.url as it routes through mounted
  // sub-routers (stripping the prefix), so by the time "finish" fires, req.url is
  // the router-relative path ("/") rather than the full path ("/api/databases").
  // req.originalUrl is immutable and always shows what the client actually sent.
  const originalUrl = req.originalUrl || req.url;
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";
    const reset = "\x1b[0m";
    const ip = (req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "-") as string;
    console.log(`${color}${status}${reset} ${req.method} ${originalUrl} — ${ms}ms  [${ip}]`);
  });
  next();
});

// ── Error logger ────────────────────────────────────────────────────────────
function logError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? `\n${err.stack}` : "";
  console.error(`\x1b[31m[error]\x1b[0m ${label}: ${msg}${stack}`);
}

app.use(cors());

// ── Health check ─────────────────────────────────────────────────────────────
// GET /api/health — reports every dependency so you can diagnose wiring issues
// without digging through logs.
app.get("/api/health", async (_req, res) => {
  const nedbUrl = process.env.NEDB_URL || "http://127.0.0.1:7070";
  const aiassistBase = process.env.AIASSIST_BASE_URL || "https://api.aiassist.net";
  const hasKey = Boolean(process.env.AIASSIST_API_KEY);

  let nedbOk = false;
  let nedbErr = "";
  try {
    const r = await fetch(`${nedbUrl}/health`, { signal: AbortSignal.timeout(3000) });
    nedbOk = r.ok;
    if (!r.ok) nedbErr = `HTTP ${r.status}`;
  } catch (e) {
    nedbErr = (e as Error).message;
  }

  let aiassistOk = false;
  let aiassistErr = "";
  if (hasKey) {
    try {
      const r = await fetch(`${aiassistBase}/health`, {
        headers: { Authorization: `Bearer ${process.env.AIASSIST_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      aiassistOk = r.ok;
      if (!r.ok) aiassistErr = `HTTP ${r.status}`;
    } catch (e) {
      aiassistErr = (e as Error).message;
    }
  } else {
    aiassistErr = "AIASSIST_API_KEY not set — running in mock mode";
  }

  const status = nedbOk && (aiassistOk || !hasKey) ? 200 : 207;
  res.status(status).json({
    studio: "ok",
    nedb:     { url: nedbUrl,      ok: nedbOk,     error: nedbErr || undefined },
    aiassist: { url: aiassistBase, ok: aiassistOk, hasKey, error: aiassistErr || undefined },
    bodyLimit: "32mb",
    version:  process.env.npm_package_version ?? "?",
  });
});
app.use(express.json({ limit: "32mb" }));  // scaffolds + seed data can be several MB
app.use(express.urlencoded({ extended: true, limit: "32mb" }));
app.use("/api/databases", databases);
app.use("/api/settings", settings);
app.use("/api", api);

const PORT = Number(process.env.PORT ?? 3001);

// In production the same server hosts the built Portal app + the API.
if (process.env.NODE_ENV === "production") {
  const dist = resolve(process.cwd(), "dist");
  if (!existsSync(dist)) {
    console.warn("\x1b[33m[warn]\x1b[0m dist/ not found — run `npm run build` before `npm run start`");
  }
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logError("unhandled", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  const mode = process.env.AIASSIST_API_KEY ? "live (AiAssist gateway)" : "no key (generation disabled)";
  const nedbUrl = process.env.NEDB_URL || "http://127.0.0.1:7070 (default)";
  const env = process.env.NODE_ENV || "development";
  console.log(`
\x1b[32m◆ NEDB Studio\x1b[0m  \x1b[2mv${process.env.npm_package_version || "0.3.0"}\x1b[0m
  port     :${PORT}
  env      ${env}
  aiassist ${mode}
  nedb     ${nedbUrl}
  `);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.log(`\n\x1b[33m[${signal}]\x1b[0m shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => { logError("uncaughtException", err); process.exit(1); });
process.on("unhandledRejection", (reason) => { logError("unhandledRejection", reason); });
