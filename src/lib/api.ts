import type { GenerateResponse, ProvidersPayload, StudioStatus } from "./types";

/**
 * Browser → server API. The browser only ever talks to our own /api routes
 * (proxied to the Express server in dev). It never sees the AiAssist key.
 */

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.details?.length ? `${data.error}: ${data.details.join("; ")}` : data.error;
  } catch {
    /* response wasn't JSON */
  }
  return `${fallback} (${res.status})`;
}

export async function getStatus(): Promise<StudioStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`/api/status -> ${res.status}`);
  return (await res.json()) as StudioStatus;
}

export async function getProviders(): Promise<ProvidersPayload> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`/api/providers -> ${res.status}`);
  return (await res.json()) as ProvidersPayload;
}

export async function generate(
  prompt: string,
  provider?: string,
  model?: string,
): Promise<GenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, provider, model }),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Generation failed"));
  }
  return (await res.json()) as GenerateResponse;
}

export interface CompileNqlResult {
  nql: string;
  mode: "mock" | "live";
  error?: string;
}

/** Natural language → NQL. Schema is {collections, relations, indexes}. */
export async function compileNql(prompt: string, schema: unknown): Promise<CompileNqlResult> {
  const res = await fetch("/api/nql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, schema }),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Query compile failed"));
  }
  return (await res.json()) as CompileNqlResult;
}

/** Translate a SQL SELECT or Redis read command to NQL. */
export async function translateQuery(
  lang: "sql" | "redis",
  input: string,
  schema: unknown,
): Promise<{ kind: string; nql?: string; sql?: string; op?: string }> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, input, schema }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Translation failed"));
  return (await res.json()) as { kind: string; nql?: string; sql?: string; op?: string };
}

// ── Deployment: the studio talks to a NEDB server (nedbd) via these routes ─────

export interface DbSummary {
  name: string;
  seq: number;
  head: string;
  rows: number;
  collections: Record<string, number>;
}

export interface DbDetail extends DbSummary {
  indexes: Array<[string, string, string]>;
  integrity: { ok: boolean };
}

export interface DbQueryResult {
  rows: Array<Record<string, unknown>>;
  count: number;
  seq: number;
  head: string;
  error?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  version?: string;
  databases?: string[];
  error?: string;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const res = await fetch("/api/databases/status");
  return (await res.json()) as ConnectionStatus;
}

export async function listDatabases(): Promise<DbSummary[]> {
  const res = await fetch("/api/databases");
  if (!res.ok) throw new Error(await errorMessage(res, "List databases failed"));
  return ((await res.json()) as { databases: DbSummary[] }).databases ?? [];
}

export async function deployScaffold(scaffold: import("./types").NEDBScaffold, name?: string): Promise<DbSummary> {
  const res = await fetch("/api/databases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scaffold, name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Deploy failed"));
  return ((await res.json()) as { database: DbSummary }).database;
}

export async function getDatabase(name: string): Promise<DbDetail> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(await errorMessage(res, "Load database failed"));
  return (await res.json()) as DbDetail;
}

export async function dropDatabase(name: string): Promise<boolean> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res, "Drop failed"));
  return ((await res.json()) as { dropped: boolean }).dropped;
}

export async function queryLiveDatabase(name: string, nql: string): Promise<DbQueryResult> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nql }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Query failed"));
  return (await res.json()) as DbQueryResult;
}

export async function putLiveRow(
  name: string,
  coll: string,
  id: string,
  doc: Record<string, unknown>,
): Promise<{ ok: boolean; seq: number; head: string }> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}/rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coll, id, doc }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Write failed"));
  return (await res.json()) as { ok: boolean; seq: number; head: string };
}

export async function deleteLiveRow(name: string, coll: string, id: string): Promise<{ ok: boolean; seq: number; head: string }> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}/rows/${encodeURIComponent(coll)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Delete row failed"));
  return (await res.json()) as { ok: boolean; seq: number; head: string };
}

// Natural-language action plan: a read (query) OR a write/delete to preview, edit, confirm.
export type ActionPlan =
  | { kind: "query"; nql: string }
  | { kind: "write"; collection: string; id: string; doc: Record<string, unknown>; summary?: string }
  | { kind: "delete"; collection: string; id: string; summary?: string }
  | { kind: "unsupported"; reason: string };

export async function planAction(prompt: string, schema: unknown): Promise<ActionPlan> {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, schema }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not interpret instruction"));
  return ((await res.json()) as { plan: ActionPlan }).plan;
}

export async function verifyDatabase(name: string): Promise<{ ok: boolean; seq: number; head: string }> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}/verify`);
  if (!res.ok) throw new Error(await errorMessage(res, "Verify failed"));
  return (await res.json()) as { ok: boolean; seq: number; head: string };
}

export interface LogEntry {
  seq: number;
  ts: number;
  op: string;
  client: string;
  nonce: number;
  idem: string | null;
  hash: string;
  payload: Record<string, unknown>;
}

export async function databaseLog(name: string, limit = 50): Promise<LogEntry[]> {
  const res = await fetch(`/api/databases/${encodeURIComponent(name)}/log?limit=${limit}`);
  if (!res.ok) throw new Error(await errorMessage(res, "Log failed"));
  return ((await res.json()) as { log: LogEntry[] }).log ?? [];
}

// ── Settings ───────────────────────────────────────────────────────────────

export interface StudioSettings {
  nedb: {
    effective: { url: string; hasToken: boolean };
    env: { url: string; hasToken: boolean };
    overridden: boolean;
  };
  connection: ConnectionStatus;
  aiassist: { mode: string; defaultProvider: string; defaultModel: string };
}

export async function getSettings(): Promise<StudioSettings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error(`/api/settings -> ${res.status}`);
  return (await res.json()) as StudioSettings;
}

export async function testConnection(url?: string, token?: string): Promise<ConnectionStatus> {
  const res = await fetch("/api/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, token }),
  });
  return (await res.json()) as ConnectionStatus;
}

export async function saveSettings(url?: string, token?: string): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, token }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Save settings failed"));
}
