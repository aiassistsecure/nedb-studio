import React, { useEffect, useMemo, useState } from "react";
import { Head, Link } from "@interchained/portal-react";

import { Nav } from "../src/components/Nav";
import { QueryConsole } from "../src/components/QueryConsole";
import { executeNql, type QueryResult } from "../src/lib/nql";
import { getStatus } from "../src/lib/api";
import { SAMPLE_DATABASES, loadActiveDatabase } from "../src/lib/database";
import type { NEDBScaffold } from "../src/lib/types";

export const intent = {
  purpose:
    "The phpMyAdmin of NEDB: pick a database, browse collections and seed data, inspect structure/indexes/relations, and query in plain English (natural language → NQL) against it",
  primaryAction: "Run Query",
  seoKeyword: "natural language database query NQL",
};

interface DbEntry {
  key: string;
  label: string;
  source: "studio" | "sample";
  scaffold: NEDBScaffold;
}

type Tab = "overview" | "browse" | "structure" | "indexes" | "relations" | "query";

function buildEntries(): DbEntry[] {
  const entries: DbEntry[] = [];
  const studio = loadActiveDatabase();
  if (studio) {
    entries.push({ key: "studio", label: studio.appName, source: "studio", scaffold: studio });
  }
  for (const s of SAMPLE_DATABASES) {
    entries.push({ key: `sample:${s.key}`, label: s.label, source: "sample", scaffold: s.scaffold });
  }
  return entries;
}

export default function QueryPage(): React.ReactElement {
  const [entries, setEntries] = useState<DbEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [collection, setCollection] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [seedNql, setSeedNql] = useState("");
  const [seedKey, setSeedKey] = useState(0);
  const [live, setLive] = useState(false);

  // Build the database list on mount (client-side; localStorage handoff + samples).
  useEffect(() => {
    const e = buildEntries();
    setEntries(e);
    setActiveKey(e[0]?.key ?? "");
  }, []);

  // Surface whether the AiAssist API is connected (drives the NL→NQL banner).
  useEffect(() => {
    void (async () => {
      try {
        const s = await getStatus();
        setLive(s.mode === "live");
      } catch {
        setLive(false);
      }
    })();
  }, []);

  const active = useMemo(() => entries.find((e) => e.key === activeKey) ?? null, [entries, activeKey]);
  const db = active?.scaffold ?? null;

  function selectDatabase(key: string): void {
    setActiveKey(key);
    setCollection(null);
    setTab("overview");
    setSeedNql("");
  }

  function openCollection(name: string): void {
    setCollection(name);
    setTab("browse");
  }

  function runInConsole(nql: string): void {
    setSeedNql(nql);
    setSeedKey((k) => k + 1);
    setTab("query");
  }

  const rowCount = (name: string): number =>
    Array.isArray(db?.seedData?.[name]) ? (db!.seedData[name] as unknown[]).length : 0;

  return (
    <div className="flex h-screen flex-col">
      <Head
        title="Query Console"
        description="The phpMyAdmin of NEDB — browse collections and seed data, inspect structure, and query any NEDB database in plain English. Natural language compiles to NQL and runs in-browser."
      />
      <Nav />

      <div className="flex min-h-0 flex-1">
        {/* ── Left rail: databases + collections ─────────────────────────── */}
        <aside className="flex w-72 flex-col overflow-y-auto border-r border-white/10 bg-black/20">
          <div className="border-b border-white/10 p-3">
            <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">Database</label>
            <select
              value={activeKey}
              onChange={(e) => selectDatabase(e.target.value)}
              className="glass-soft w-full rounded-lg px-2 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            >
              {entries.some((e) => e.source === "studio") ? (
                <optgroup label="From Studio">
                  {entries.filter((e) => e.source === "studio").map((e) => (
                    <option key={e.key} value={e.key}>{e.label}</option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Sample databases">
                {entries.filter((e) => e.source === "sample").map((e) => (
                  <option key={e.key} value={e.key}>{e.label}</option>
                ))}
              </optgroup>
            </select>
            <Link href="/studio" className="mt-2 block text-center text-[11px] text-accent-soft hover:text-white">
              + Generate your own in Studio →
            </Link>
          </div>

          {db ? (
            <nav className="flex-1 overflow-y-auto p-2">
              <button
                onClick={() => { setCollection(null); setTab("overview"); }}
                className={
                  "mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition " +
                  (collection === null && tab !== "query" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")
                }
              >
                <span>◆ {db.appName}</span>
                <span className="text-slate-600">{db.collections.length}</span>
              </button>
              <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-slate-600">Collections</p>
              {db.collections.map((c) => (
                <button
                  key={c.name}
                  onClick={() => openCollection(c.name)}
                  className={
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition " +
                    (collection === c.name ? "bg-accent/20 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white")
                  }
                >
                  <span className="truncate">▸ {c.name}</span>
                  <span className="ml-2 shrink-0 text-slate-600">{rowCount(c.name)}</span>
                </button>
              ))}
              <button
                onClick={() => { setSeedNql(""); setTab("query"); }}
                className={
                  "mt-3 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition " +
                  (tab === "query" ? "bg-accent/20 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")
                }
              >
                ⌘ Query console — ask in English
              </button>
            </nav>
          ) : null}
        </aside>

        {/* ── Main panel ─────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {db == null ? (
            <div className="flex h-full items-center justify-center p-10 text-sm text-slate-500">
              No database selected.
            </div>
          ) : (
            <>
              {/* breadcrumb + tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
                <div className="min-w-0 font-mono text-xs text-slate-400">
                  <span className="text-slate-200">{db.appName}</span>
                  {collection ? <span> ▸ <span className="text-accent-soft">{collection}</span></span> : <span className="text-slate-600"> ▸ overview</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {(collection
                    ? (["browse", "structure", "indexes", "relations", "query"] as Tab[])
                    : (["overview", "query"] as Tab[])
                  ).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={
                        "rounded-md px-3 py-1 capitalize transition " +
                        (tab === t ? "bg-accent/20 text-white" : "text-slate-400 hover:text-white")
                      }
                    >
                      {t === "query" ? "Query (NL → NQL)" : t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {tab === "query" ? (
                  <div className="flex h-full flex-col">
                    {!live ? (
                      <div className="mx-4 mt-4 rounded-lg border border-signal-amber/30 bg-signal-amber/10 px-3 py-2 text-xs text-signal-amber">
                        AiAssist API not connected — natural-language → NQL needs a configured key. You can still write NQL and Run it against this database.
                      </div>
                    ) : null}
                    <div className="min-h-0 flex-1">
                      <QueryConsole key={`${activeKey}:${seedKey}`} scaffold={db} initialNql={seedNql} />
                    </div>
                  </div>
                ) : collection == null ? (
                  <Overview db={db} onOpen={openCollection} onQuery={runInConsole} rowCount={rowCount} />
                ) : tab === "structure" ? (
                  <Structure db={db} collection={collection} />
                ) : tab === "indexes" ? (
                  <Indexes db={db} collection={collection} />
                ) : tab === "relations" ? (
                  <Relations db={db} collection={collection} />
                ) : (
                  <Browse db={db} collection={collection} onQuery={runInConsole} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* ── Database overview ──────────────────────────────────────────────────── */
function Overview({
  db,
  onOpen,
  onQuery,
  rowCount,
}: {
  db: NEDBScaffold;
  onOpen: (name: string) => void;
  onQuery: (nql: string) => void;
  rowCount: (name: string) => number;
}): React.ReactElement {
  const totalRows = db.collections.reduce((n, c) => n + rowCount(c.name), 0);
  const stats = [
    { label: "collections", value: db.collections.length },
    { label: "relations", value: db.relations.length },
    { label: "indexes", value: db.indexes.length },
    { label: "seed rows", value: totalRows },
  ];
  return (
    <div className="space-y-6 p-5">
      <div>
        <h1 className="text-lg font-bold">{db.appName}</h1>
        <p className="text-sm text-slate-400">{db.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-xl px-4 py-3">
            <div className="font-mono text-2xl font-bold text-accent-soft">{s.value}</div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-slate-500">Collections</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {db.collections.map((c) => (
            <button
              key={c.name}
              onClick={() => onOpen(c.name)}
              className="glass rounded-xl p-4 text-left transition hover:border-accent/40"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-white">{c.name}</span>
                <span className="font-mono text-[11px] text-slate-500">{rowCount(c.name)} rows</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-500">
                {c.fields.map((f) => f.name).join(", ")}
              </div>
            </button>
          ))}
        </div>
      </div>

      {db.nqlExamples.length ? (
        <div>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-slate-500">Sample NQL — click to run</h2>
          <div className="flex flex-col gap-2">
            {db.nqlExamples.map((q) => (
              <button
                key={q}
                onClick={() => onQuery(q)}
                className="glass-soft code rounded-lg px-3 py-2 text-left text-xs text-accent-soft transition hover:border-accent/40"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Browse a collection's rows ─────────────────────────────────────────── */
function Browse({
  db,
  collection,
  onQuery,
}: {
  db: NEDBScaffold;
  collection: string;
  onQuery: (nql: string) => void;
}): React.ReactElement {
  const nql = `FROM ${collection} LIMIT 50`;
  const result = useMemo<QueryResult>(() => executeNql(nql, db), [nql, db]);
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="glass-soft code rounded-lg px-3 py-1.5 text-xs text-accent-soft">{nql}</code>
        <button onClick={() => onQuery(nql)} className="btn-ghost px-3 py-1.5 text-xs">
          Edit in Query console →
        </button>
      </div>
      <div className="glass-soft min-h-0 flex-1 overflow-auto rounded-xl">
        <ResultsTable result={result} />
      </div>
    </div>
  );
}

/* ── Structure (fields) ─────────────────────────────────────────────────── */
function Structure({ db, collection }: { db: NEDBScaffold; collection: string }): React.ReactElement {
  const coll = db.collections.find((c) => c.name === collection);
  const idxFor = (field: string) =>
    db.indexes.filter((i) => i.collection === collection && i.field === field).map((i) => i.kind).join(", ");
  if (!coll) return <Empty>Unknown collection.</Empty>;
  return (
    <div className="p-4">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            <th className="px-3 py-2">field</th>
            <th className="px-3 py-2">type</th>
            <th className="px-3 py-2">required</th>
            <th className="px-3 py-2">index</th>
            <th className="px-3 py-2">description</th>
          </tr>
        </thead>
        <tbody>
          {coll.fields.map((f) => (
            <tr key={f.name} className="border-b border-white/5 hover:bg-white/5">
              <td className="px-3 py-1.5 text-white">{f.name}</td>
              <td className="px-3 py-1.5 text-accent-soft">{f.type}</td>
              <td className="px-3 py-1.5 text-slate-400">{f.required ? "yes" : ""}</td>
              <td className="px-3 py-1.5 text-signal-green">{idxFor(f.name)}</td>
              <td className="max-w-[280px] truncate px-3 py-1.5 text-slate-500" title={f.description ?? ""}>{f.description ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Indexes ────────────────────────────────────────────────────────────── */
function Indexes({ db, collection }: { db: NEDBScaffold; collection: string }): React.ReactElement {
  const rows = db.indexes.filter((i) => i.collection === collection);
  if (!rows.length) return <Empty>No indexes on “{collection}”.</Empty>;
  return (
    <div className="p-4">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            <th className="px-3 py-2">field</th>
            <th className="px-3 py-2">kind</th>
            <th className="px-3 py-2">purpose</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.field + i.kind} className="border-b border-white/5 hover:bg-white/5">
              <td className="px-3 py-1.5 text-white">{i.field}</td>
              <td className="px-3 py-1.5 text-accent-soft">{i.kind}</td>
              <td className="px-3 py-1.5 text-slate-500">
                {i.kind === "eq" ? "equality filter" : i.kind === "ordered" ? "sort / range" : "full-text search"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Relations ──────────────────────────────────────────────────────────── */
function Relations({ db, collection }: { db: NEDBScaffold; collection: string }): React.ReactElement {
  const rows = db.relations.filter((r) => r.from === collection || r.to === collection);
  if (!rows.length) return <Empty>No relations involving “{collection}”.</Empty>;
  return (
    <div className="p-4">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            <th className="px-3 py-2">from</th>
            <th className="px-3 py-2">relation</th>
            <th className="px-3 py-2">to</th>
            <th className="px-3 py-2">cardinality</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.from}-${r.relation}-${r.to}`} className="border-b border-white/5 hover:bg-white/5">
              <td className={"px-3 py-1.5 " + (r.from === collection ? "text-white" : "text-slate-400")}>{r.from}</td>
              <td className="px-3 py-1.5 text-accent-soft">--{r.relation}--&gt;</td>
              <td className={"px-3 py-1.5 " + (r.to === collection ? "text-white" : "text-slate-400")}>{r.to}</td>
              <td className="px-3 py-1.5 text-slate-500">{r.cardinality}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Shared bits ────────────────────────────────────────────────────────── */
function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="p-6 text-sm text-slate-500">{children}</div>;
}

function ResultsTable({ result }: { result: QueryResult }): React.ReactElement {
  const cell = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  if (result.error) return <div className="p-4 text-sm text-signal-red">{result.error}</div>;
  if (result.rows.length === 0) return <div className="p-4 text-sm text-slate-400">0 rows.{result.note ? ` ${result.note}` : ""}</div>;
  return (
    <div className="overflow-auto">
      <div className="px-3 pt-3 text-[11px] text-slate-500">
        {result.count} row{result.count === 1 ? "" : "s"}{result.note ? ` · ${result.note}` : ""}
      </div>
      <table className="w-full border-collapse text-left font-mono text-[12px]">
        <thead>
          <tr className="border-b border-white/10 text-slate-400">
            {result.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              {result.columns.map((c) => (
                <td key={c} className="max-w-[260px] truncate px-3 py-1.5 text-slate-200" title={cell(row[c])}>
                  {cell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
