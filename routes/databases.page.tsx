import React, { useCallback, useEffect, useState } from "react";
import { Head, Link } from "@interchained/portal-react";

import { Nav } from "../src/components/Nav";
import { QueryConsole } from "../src/components/QueryConsole";
import { SchemaGraph } from "../src/components/SchemaGraph";
import type { NEDBScaffold } from "../src/lib/types";
import type { QueryResult } from "../src/lib/nql";
import {
  databaseLog,
  deployScaffold,
  dropDatabase,
  getConnectionStatus,
  getDatabase,
  getDeployedSchema,
  getSettings,
  listDatabases,
  putLiveRow,
  deleteLiveRow,
  queryLiveDatabase,
  mongoLiveQuery,
  verifyDatabase,
  type ConnectionStatus,
  type DbDetail,
  type DbSummary,
  type LogEntry,
} from "../src/lib/api";
import { SAMPLE_DATABASES, loadActiveDatabase } from "../src/lib/database";
import type { Field, FieldType } from "../src/lib/types";

export const intent = {
  purpose: "Deploy a generated scaffold into a running NEDB server and query/operate the live, durable database",
  primaryAction: "Deploy database",
  seoKeyword: "deploy NEDB database server",
};

type Tab = "schema" | "query" | "log" | "connect";

const pageSize = (): number =>
  Number((typeof window !== "undefined" && window.localStorage.getItem("nedb-studio:pageSize")) || 100);

function fieldType(v: unknown): FieldType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v && typeof v === "object") return "json";
  return "string";
}

// Infer a (possibly nested) field tree from a sampled value, so the schema graph
// can deep-drill into JSON objects. Plain objects recurse; arrays/scalars are leaves.
function fieldsFromValue(v: unknown, depth = 0): Field[] | undefined {
  if (depth > 4 || !v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return Object.keys(v as Record<string, unknown>).map((k) => {
    const child = (v as Record<string, unknown>)[k];
    const f: Field = { name: k, type: fieldType(child) };
    const sub = fieldsFromValue(child, depth + 1);
    if (sub && sub.length) f.fields = sub;
    return f;
  });
}

function fieldsFromSample(sample: Record<string, unknown>): Field[] {
  return Object.keys(sample).map((k) => {
    const f: Field = { name: k, type: fieldType(sample[k]) };
    const sub = fieldsFromValue(sample[k], 1);
    if (sub && sub.length) f.fields = sub;
    return f;
  });
}

export default function DatabasesPage(): React.ReactElement {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [nedbUrl, setNedbUrl] = useState("");
  const [dbs, setDbs] = useState<DbSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DbDetail | null>(null);
  const [live, setLive] = useState<NEDBScaffold | null>(null);
  const [persistedScaffold, setPersistedScaffold] = useState<NEDBScaffold | null>(null);
  const [tab, setTab] = useState<Tab>("query");
  const [seedNql, setSeedNql] = useState("");
  const [seedKey, setSeedKey] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const studioDb = typeof window !== "undefined" ? loadActiveDatabase() : null;

  const refresh = useCallback(async () => {
    const st = await getConnectionStatus();
    setStatus(st);
    if (st.connected) {
      try { setDbs(await listDatabases()); } catch (e) { setError(String(e)); }
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getSettings().then((s) => setNedbUrl(s.nedb.effective.url)).catch(() => {});
  }, [refresh]);

  const select = useCallback(async (name: string) => {
    setSelected(name);
    setTab("schema");
    setSeedNql("");
    setDetail(null);
    setLive(null);
    setPersistedScaffold(null);
    try {
      const d = await getDatabase(name);
      // Load the persisted schema — if absent, auto-backfill from the best available
      // source: localStorage studioDb (full original scaffold) → sampled live scaffold.
      // Silent, no button — just magic.
      getDeployedSchema(name).then(async (schema) => {
        if (schema) { setPersistedScaffold(schema); return; }
        // No schema stored yet — backfill from localStorage if we have the right scaffold
        const studioDb = loadActiveDatabase();
        const source = studioDb ?? null;
        if (!source) return; // nothing to backfill from yet; will set after live is built
        // Write _studio/schema so the full graph shows from now on
        try {
          await putLiveRow(name, "_studio", "schema", {
            _id: "schema",
            appName: source.appName,
            description: source.description,
            collections: source.collections,
            relations: source.relations,
            indexes: source.indexes,
            nqlExamples: source.nqlExamples,
          });
          setPersistedScaffold(source);
        } catch { /* non-fatal */ }
      }).catch(() => {});
      setDetail(d);
      // Synthesize a schema from the live DB (collection names + sampled fields)
      // so NL→NQL has something to work with; queries run on the real engine.
      const collections = [];
      for (const cname of Object.keys(d.collections)) {
        let fields: Field[] = [{ name: "_id", type: "string" }];
        try {
          const r = await queryLiveDatabase(name, `FROM ${cname} LIMIT 1`);
          const sample = r.rows[0];
          if (sample) fields = fieldsFromSample(sample as Record<string, unknown>);
        } catch { /* ignore */ }
        collections.push({ name: cname, fields });
      }
      const liveScaffold: NEDBScaffold = {
        appName: d.name,
        description: `Live database · ${d.rows} rows · seq ${d.seq}`,
        collections,
        // Use live relations from the engine — real graph edges, not sampled
        relations: (d.relations ?? []) as import("../src/lib/types").Relation[],
        indexes: d.indexes.map(([collection, field, kind]) => ({ collection, field, kind: kind as "eq" | "ordered" | "search" })),
        seedData: {},
        nqlExamples: Object.keys(d.collections).slice(0, 3).map((c) => `FROM ${c} LIMIT ${pageSize()}`),
        pythonSnippet: "",
        nodeSnippet: "",
        readmeExport: "",
      };
      setLive(liveScaffold);
      // If no persistedScaffold yet (nothing in localStorage), backfill from the
      // sampled live scaffold so the graph shows something real right now.
      setPersistedScaffold((prev) => {
        if (prev) return prev; // already set from localStorage path above
        // Quietly save the sampled schema so next open is instant
        void putLiveRow(name, "_studio", "schema", {
          _id: "schema",
          appName: liveScaffold.appName,
          description: liveScaffold.description,
          collections: liveScaffold.collections,
          relations: liveScaffold.relations,
          indexes: liveScaffold.indexes,
          nqlExamples: liveScaffold.nqlExamples,
        }).catch(() => {});
        return liveScaffold;
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  async function deploy(scaffold: NEDBScaffold, name: string): Promise<void> {
    setBusy(name);
    setError(null);
    try {
      const created = await deployScaffold(scaffold, name);
      await refresh();
      await select(created.name);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function onVerify(): Promise<void> {
    if (!selected) return;
    const v = await verifyDatabase(selected);
    setDetail((d) => (d ? { ...d, integrity: { ok: v.ok } } : d));
  }

  async function onDrop(): Promise<void> {
    if (!selected || typeof window === "undefined" || !window.confirm(`Drop database "${selected}"? This cannot be undone.`)) return;
    await dropDatabase(selected);
    setSelected(null);
    setDetail(null);
    await refresh();
  }

  // Light refresh after a write — update stats/integrity without resetting the console.
  const refreshDetail = useCallback(async () => {
    if (!selected) return;
    try { setDetail(await getDatabase(selected)); } catch { /* ignore */ }
  }, [selected]);

  const runMongoLive = useCallback(async (body: Record<string, unknown>) => {
    if (!selected) throw new Error("no database selected");
    return mongoLiveQuery(selected, body);
  }, [selected]);

  const runLive = useCallback(async (nql: string): Promise<QueryResult> => {
    if (!selected) return { rows: [], columns: [], count: 0, error: "no database selected" };
    const r = await queryLiveDatabase(selected, nql);
    if (r.error) return { rows: [], columns: [], count: 0, error: r.error };
    const columns: string[] = [];
    for (const row of r.rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
    return { rows: r.rows, columns, count: r.count, note: `seq ${r.seq}` };
  }, [selected]);

  function browse(coll: string): void {
    setSeedNql(`FROM ${coll} LIMIT ${pageSize()}`);
    setSeedKey((k) => k + 1);
    setTab("query");
  }

  useEffect(() => {
    if (tab === "log" && selected) void databaseLog(selected, 50).then(setLog).catch(() => setLog([]));
  }, [tab, selected, detail]);

  const connected = status?.connected;

  return (
    <div className="flex h-screen flex-col">
      <Head title="Databases" description="Deploy and operate live, durable NEDB databases on a running nedbd server." />
      <Nav />

      {status && !connected ? (
        <div className="border-b border-signal-amber/30 bg-signal-amber/10 px-5 py-2 text-xs text-signal-amber">
          Not connected to a NEDB server. Start one with <span className="font-mono">pip install nedb-engine &amp;&amp; nedbd</span>, then set the URL in{" "}
          <Link href="/settings" className="underline">Settings</Link>. {status.error ? `(${status.error})` : ""}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Left rail: deploy + database list */}
        <aside
          className="flex w-72 flex-col overflow-y-auto border-r"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-2)" }}
        >
          <div className="border-b p-3.5" style={{ borderColor: "var(--border-2)" }}>
            <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-600">Deploy</p>
            {studioDb ? (
              <button
                onClick={() => void deploy(studioDb, studioDb.appName)}
                disabled={busy != null}
                className="btn-primary mb-2 w-full text-xs disabled:opacity-50"
              >
                {busy === studioDb.appName ? "Deploying…" : `Deploy "${studioDb.appName}"`}
              </button>
            ) : (
              <Link href="/studio" className="mb-2 flex items-center justify-center gap-1 text-[11px] text-accent-soft transition hover:text-white">
                Generate a schema in Studio →
              </Link>
            )}
            <p className="mb-1.5 mt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-700">
              Sample databases
            </p>
            {SAMPLE_DATABASES.map((s) => (
              <button
                key={s.key}
                onClick={() => void deploy(s.scaffold, s.label)}
                disabled={busy != null}
                className="mb-0.5 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-slate-400 transition hover:bg-accent/[0.06] hover:text-white disabled:opacity-50"
              >
                {busy === s.label ? "Deploying…" : `+ ${s.label}`}
              </button>
            ))}
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            <p className="px-2.5 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-700">
              Databases {connected ? <span className="text-slate-600">({dbs.length})</span> : null}
            </p>
            {dbs.map((d) => (
              <button
                key={d.name}
                onClick={() => void select(d.name)}
                className={
                  "relative flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left font-mono text-xs transition-all " +
                  (selected === d.name
                    ? "bg-accent/[0.12] text-white ring-1 ring-accent/20"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white")
                }
              >
                {selected === d.name && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                )}
                <span className="truncate pl-1">◆ {d.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-slate-600">{d.rows}</span>
              </button>
            ))}
            {connected && dbs.length === 0 ? (
              <p className="px-2.5 py-3 text-[11px] text-slate-700">No databases yet.</p>
            ) : null}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error ? (
            <div className="mx-4 mt-3 rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-xs text-signal-red">{error}</div>
          ) : null}

          {!detail ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
              {selected ? (
                <div className="text-sm text-slate-500">Loading…</div>
              ) : (
                <>
                  <div className="text-3xl text-accent-glow opacity-40">◆</div>
                  <div className="text-sm text-slate-500">Select a database from the left, or deploy a new one.</div>
                  {!connected && (
                    <div className="font-mono text-xs text-slate-700">
                      No server — run: <span className="text-accent-soft">pip install nedb-engine &amp;&amp; nedbd</span>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* DB detail header */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
                style={{ borderColor: "var(--border-2)" }}
              >
                <div className="min-w-0">
                  <h1
                    className="truncate font-bold text-white"
                    style={{ fontSize: "1.2rem", fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
                  >
                    {detail.name}
                  </h1>
                  <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-slate-600">
                    <span className="text-slate-500">{Object.keys(detail.collections).length}<span className="ml-0.5 text-slate-700"> coll</span></span>
                    <span className="text-slate-500">{detail.rows}<span className="ml-0.5 text-slate-700"> rows</span></span>
                    <span className="text-slate-500">seq <span className="text-slate-400">{detail.seq}</span></span>
                    <span className="text-slate-700" title={detail.head}>
                      head <span className="text-slate-600">{detail.head.slice(0, 10)}…</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void onVerify()}
                    className={detail.integrity.ok ? "pill-verified" : "pill-error"}
                    title="Re-verify the hash-chained log"
                  >
                    <span className="opacity-80">●</span>
                    {detail.integrity.ok ? "verified" : "tampered"}
                  </button>
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {(["schema", "query", "log", "connect"] as Tab[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={
                          "relative rounded-md px-3 py-1.5 capitalize transition-all " +
                          (tab === t ? "text-white" : "text-slate-500 hover:text-white")
                        }
                      >
                        {tab === t && (
                          <span className="absolute inset-0 rounded-md bg-accent/10 ring-1 ring-accent/20" aria-hidden />
                        )}
                        <span className="relative">
                          {t === "query" ? "Query" : t}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* collections strip (browse) */}
              <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5" style={{ borderColor: "var(--border-2)" }}>
                {Object.entries(detail.collections).map(([c, n]) => (
                  <button key={c} onClick={() => browse(c)} className="chip" title={`Browse ${c}`}>
                    {c} <span className="ml-0.5 font-mono text-[10px] tabular-nums text-slate-600">{n}</span>
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {tab === "schema" ? (
                  persistedScaffold ? (
                    <SchemaGraph scaffold={persistedScaffold} onOpenCollection={browse} />
                  ) : live ? (
                    <div className="flex h-full flex-col">
                      <div className="px-4 pt-3 text-[11px] text-signal-amber">
                        Schema graph is based on sampled data — deploy this database from Studio to see the full structure.
                      </div>
                      <div className="min-h-0 flex-1">
                        <SchemaGraph scaffold={live} onOpenCollection={browse} />
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-slate-500">Loading schema…</div>
                  )
                ) : tab === "query" ? (
                  live ? (
                    <QueryConsole
                      key={`${selected}:${seedKey}`}
                      scaffold={live}
                      initialNql={seedNql}
                      runNql={runLive}
                      runMongo={runMongoLive}
                      writeExec={{
                        put: async (c, id, doc) => { await putLiveRow(selected!, c, id, doc); },
                        del: async (c, id) => { await deleteLiveRow(selected!, c, id); },
                      }}
                      onWritten={() => void refreshDetail()}
                    />
                  ) : (
                    <div className="p-6 text-sm text-slate-500">Preparing query console…</div>
                  )
                ) : tab === "log" ? (
                  <LogView log={log} />
                ) : (
                  <Connect url={nedbUrl} name={detail.name} onDrop={() => void onDrop()} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const OP_COLOR: Record<string, string> = {
  put:        "text-signal-green",
  delete:     "text-signal-red",
  link:       "text-signal-cyan",
  unlink:     "text-signal-amber",
  checkpoint: "text-accent-soft",
  index:      "text-accent-glow",
};

function LogView({ log }: { log: LogEntry[] }): React.ReactElement {
  if (!log.length) return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="font-mono text-2xl opacity-20">▢</div>
      <div className="text-sm text-slate-600">No log entries loaded.</div>
    </div>
  );
  const target = (e: LogEntry): string => {
    const p = e.payload || {};
    return [p.coll, p.id].filter(Boolean).join(":") || [p.frm, p.rel, p.to].filter(Boolean).join(" ") || "";
  };
  return (
    <div className="overflow-auto p-4">
      <div className="mb-2 font-mono text-[11px] text-slate-700">
        {log.length} entries · most recent first
      </div>
      <table className="w-full border-collapse text-left font-mono text-[12px]">
        <thead>
          <tr className="border-b text-slate-600" style={{ borderColor: "var(--border-2)" }}>
            <th className="px-3 py-2 font-medium">seq</th>
            <th className="px-3 py-2 font-medium">op</th>
            <th className="px-3 py-2 font-medium">target</th>
            <th className="px-3 py-2 font-medium">hash</th>
          </tr>
        </thead>
        <tbody>
          {log.map((e) => (
            <tr key={e.seq} className="group border-b transition-colors hover:bg-white/[0.03]"
              style={{ borderColor: "var(--border-2)" }}>
              <td className="px-3 py-1.5 tabular-nums text-slate-600">{e.seq}</td>
              <td className={"px-3 py-1.5 font-semibold " + (OP_COLOR[e.op] ?? "text-accent-soft")}>
                {e.op}
              </td>
              <td className="px-3 py-1.5 text-slate-300">{target(e)}</td>
              <td className="px-3 py-1.5 text-slate-700 transition group-hover:text-slate-500"
                title={e.hash}>{e.hash.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Connect({ url, name, onDrop }: { url: string; name: string; onDrop: () => void }): React.ReactElement {
  const base = url || "http://127.0.0.1:7070";
  const curl = `curl -X POST ${base}/v1/databases/${name}/query \\\n  -H 'Content-Type: application/json' \\\n  -d '{"nql":"FROM <collection> LIMIT 10"}'`;
  const py = `import requests\nr = requests.post("${base}/v1/databases/${name}/query",\n                  json={"nql": "FROM <collection> LIMIT 10"})\nprint(r.json()["rows"])`;
  return (
    <div className="space-y-5 p-5">
      <div>
        <h3 className="text-xs uppercase tracking-widest text-slate-500">NEDB server</h3>
        <code className="glass-soft code mt-1 block rounded-lg px-3 py-2 text-sm text-accent-soft">{base}</code>
        <p className="mt-1 text-xs text-slate-500">Database <span className="font-mono">{name}</span> runs on the nedbd daemon. Configure the URL in <Link href="/settings" className="underline">Settings</Link>.</p>
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-widest text-slate-500">curl</h3>
        <pre className="glass-soft code mt-1 overflow-auto rounded-lg p-3 text-xs text-slate-200">{curl}</pre>
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-widest text-slate-500">Python</h3>
        <pre className="glass-soft code mt-1 overflow-auto rounded-lg p-3 text-xs text-slate-200">{py}</pre>
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-widest text-signal-red/80">Danger zone</h3>
        <button onClick={onDrop} className="mt-1 rounded-lg border border-signal-red/40 px-3 py-1.5 text-xs text-signal-red hover:bg-signal-red/10">
          Drop this database
        </button>
      </div>
    </div>
  );
}
