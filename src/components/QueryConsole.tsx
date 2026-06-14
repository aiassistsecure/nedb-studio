import React, { useEffect, useRef, useState } from "react";
import type { NEDBScaffold } from "../lib/types";
import { executeNql, type QueryResult } from "../lib/nql";
import { planAction, putBatch, translateQuery, type ActionPlan, type BatchRow } from "../lib/api";

type Lang = "nql" | "sql" | "redis";

/**
 * The two-way console: ask in plain English and the model plans an ACTION — a
 * read (compiled to NQL and run) or a write/delete (shown as an editable "what
 * would be written" preview you can edit, regenerate, or commit). Reads run via
 * runNql (live daemon) or in-browser; writes need a live database (writeExec).
 */
export interface WriteExec {
  put: (collection: string, id: string, doc: Record<string, unknown>) => Promise<void>;
  del: (collection: string, id: string) => Promise<void>;
}

function coerce(v: string): unknown {
  const t = v.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return v;
}

export function QueryConsole({
  scaffold,
  initialNql = "",
  runNql,
  writeExec,
  onWritten,
}: {
  scaffold: NEDBScaffold;
  initialNql?: string;
  runNql?: (nql: string) => Promise<QueryResult>;
  writeExec?: WriteExec;
  onWritten?: () => void;
}): React.ReactElement {
  const first = scaffold.collections[0]?.name ?? "rows";
  const [lang, setLang] = useState<Lang>("nql");
  const [nl, setNl] = useState("");
  const [nql, setNql] = useState(initialNql);
  const [rawInput, setRawInput] = useState(""); // SQL or Redis raw input
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draft, setDraft] = useState<Array<[string, string]>>([]);
  const [batchDraft, setBatchDraft] = useState<Array<{ id: string; fields: Array<[string, string]> }>>([]);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const didInit = useRef(false);

  const exec = async (q: string): Promise<QueryResult> => (runNql ? runNql(q) : executeNql(q, scaffold));

  async function runTranslated(): Promise<void> {
    if (!rawInput.trim() || !["sql", "redis"].includes(lang)) return;
    setBusy(true);
    setNotice(null);
    try {
      const schema = { collections: scaffold.collections, relations: scaffold.relations, indexes: scaffold.indexes };
      const out = await translateQuery(lang as "sql" | "redis", rawInput, schema);
      if (out.kind === "query" && out.nql) {
        setNql(out.nql);
        setResult(await exec(out.nql));
      } else if (out.kind === "sql_write" && out.sql) {
        // Route SQL writes through the NL write preview — same editable confirm flow
        const sqlPlan = await planAction(
          `${out.op} row via SQL: ${out.sql}`,
          { collections: scaffold.collections, relations: scaffold.relations, indexes: scaffold.indexes }
        );
        setPlan(sqlPlan);
        loadDraft(sqlPlan);
      } else {
        setNotice(`Could not translate to NQL — ${JSON.stringify(out)}`);
      }
    } catch (e) {
      setResult({ rows: [], columns: [], count: 0, error: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!didInit.current && initialNql.trim()) {
      didInit.current = true;
      void exec(initialNql).then(setResult);
    }
  }, [initialNql, scaffold]); // eslint-disable-line react-hooks/exhaustive-deps

  const examples = [`Show active ${first}, newest first`, `Top 5 ${first}`, `Add a ${first.replace(/s$/, "")} …`];

  function loadDraft(p: ActionPlan): void {
    if (p.kind === "write") {
      setDraftId(p.id);
      setDraft(Object.entries(p.doc).map(([k, v]) => [k, v == null ? "" : String(v)]));
    } else if (p.kind === "batch") {
      setBatchDraft(p.rows.map((r) => ({
        id: r.id,
        fields: Object.entries(r.doc).map(([k, v]) => [k, v == null ? "" : String(v)] as [string, string]),
      })));
    }
  }

  async function ask(text?: string): Promise<void> {
    const q = (text ?? nl).trim();
    if (!q) return;
    setNl(q);
    setBusy(true);
    setNotice(null);
    setPlan(null);
    try {
      const schema = { collections: scaffold.collections, relations: scaffold.relations, indexes: scaffold.indexes };
      const p = await planAction(q, schema);
      setLive(true);
      if (p.kind === "query") {
        setNql(p.nql);
        setResult(await exec(p.nql));
      } else {
        setResult(null);
        setPlan(p);
        loadDraft(p);
      }
    } catch (e) {
      setResult({ rows: [], columns: [], count: 0, error: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (nql.trim()) setResult(await exec(nql));
  }

  async function commit(): Promise<void> {
    if (!plan || !writeExec) return;
    setCommitting(true);
    setNotice(null);
    try {
      if (plan.kind === "batch" && writeExec) {
        const ops = batchDraft.map((row) => {
          const doc: Record<string, unknown> = {};
          for (const [k, v] of row.fields) if (k.trim()) doc[k.trim()] = coerce(v);
          return { op: "put" as const, coll: plan.collection, id: row.id.trim(), doc };
        }).filter((o) => o.id);
        // putBatch needs db name — use the context from writeExec by putting each row
        for (const op of ops) await writeExec.put(op.coll, op.id, op.doc);
        setNotice(`✓ Batch saved — ${ops.length} row${ops.length === 1 ? "" : "s"} written to ${plan.collection}.`);
      } else if (plan.kind === "delete") {
        await writeExec.del(plan.collection, plan.id);
        setNotice(`✓ Deleted ${plan.collection}/${plan.id}.`);
      } else if (plan.kind === "write") {
        const doc: Record<string, unknown> = {};
        for (const [k, v] of draft) if (k.trim()) doc[k.trim()] = coerce(v);
        await writeExec.put(plan.collection, draftId.trim(), doc);
        setNotice(`✓ Saved to ${plan.collection} (id "${draftId.trim()}").`);
      }
      setPlan(null);
      onWritten?.();
    } catch (e) {
      setNotice(`Error: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setCommitting(false);
    }
  }

  const LANGS: Array<{ id: Lang; label: string; hint: string }> = [
    { id: "nql", label: "NQL", hint: "NEDB Query Language" },
    { id: "sql", label: "SQL", hint: "SELECT / INSERT / UPDATE / DELETE" },
    { id: "redis", label: "Redis", hint: "GET / HGETALL / SMEMBERS / …" },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5 text-xs">
          {LANGS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              title={l.hint}
              className={"rounded-md px-3 py-1 font-semibold transition " + (lang === l.id ? "bg-accent/20 text-white" : "text-slate-400 hover:text-white")}
            >
              {l.label}
            </button>
          ))}
        </div>
        {live ? (
          <span className="rounded-full bg-signal-green/15 px-2.5 py-0.5 text-[11px] font-semibold text-signal-green">● AiAssist</span>
        ) : null}
      </div>

      {/* natural-language input */}
      <div className="flex gap-2">
        <input
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
          placeholder={`e.g. "active ${first}, newest first" — or "add a ${first.replace(/s$/, "")} named …"`}
          className="glass-soft flex-1 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
        <button onClick={() => void ask()} disabled={busy || !nl.trim()} className="btn-primary disabled:opacity-50">
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button key={ex} onClick={() => { setNl(ex); }} className="chip">{ex}</button>
        ))}
      </div>

      {notice ? (
        <div className={"rounded-lg px-3 py-2 text-xs " + (notice.startsWith("Error") ? "bg-signal-red/10 text-signal-red" : "bg-signal-green/10 text-signal-green")}>
          {notice}
        </div>
      ) : null}

      {/* write/delete preview — "what would be written", editable */}
      {/* Batch write preview — multiple rows, each editable */}
      {plan && plan.kind === "batch" ? (
        <div className="glass-soft rounded-xl border border-accent/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-accent-soft">
              Will write <span className="font-mono text-white">{batchDraft.length}</span> rows to <span className="font-mono">{plan.collection}</span>
            </span>
            {plan.summary ? <span className="text-[11px] text-slate-500">{plan.summary}</span> : null}
          </div>
          <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1">
            {batchDraft.map((row, ri) => (
              <div key={ri} className="rounded-lg border border-white/10 bg-black/20 p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="w-5 text-center font-mono text-[10px] text-accent-soft font-bold">{ri + 1}</span>
                  <span className="text-[10px] text-slate-600 font-mono">_id</span>
                  <input
                    value={row.id}
                    onChange={(e) => setBatchDraft((d) => d.map((r, i) => i === ri ? { ...r, id: e.target.value } : r))}
                    className="glass-soft flex-1 rounded px-2 py-0.5 font-mono text-[11px] text-slate-100 outline-none focus:border-accent/50"
                  />
                  <button
                    onClick={() => setBatchDraft((d) => d.filter((_, i) => i !== ri))}
                    className="px-1 text-slate-600 hover:text-signal-red" title="remove row"
                  >✕</button>
                </div>
                {row.fields.map(([k, v], fi) => (
                  <div key={fi} className="mb-1 flex items-center gap-2 pl-7">
                    <input value={k} onChange={(e) => setBatchDraft((d) => d.map((r, i) => i === ri ? { ...r, fields: r.fields.map((f, j) => j === fi ? [e.target.value, f[1]] : f) } : r))}
                      className="glass-soft w-20 shrink-0 rounded px-2 py-0.5 font-mono text-[10px] text-slate-400 outline-none" />
                    <input value={v} onChange={(e) => setBatchDraft((d) => d.map((r, i) => i === ri ? { ...r, fields: r.fields.map((f, j) => j === fi ? [f[0], e.target.value] : f) } : r))}
                      className="glass-soft flex-1 rounded px-2 py-0.5 font-mono text-[11px] text-slate-100 outline-none focus:border-accent/50" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setBatchDraft((d) => [...d, { id: "", fields: [["", ""]] }])} className="text-[11px] text-accent-soft hover:text-white">+ row</button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void commit()} disabled={committing || !writeExec || batchDraft.every((r) => !r.id.trim())} className="btn-primary text-xs disabled:opacity-50">
              {committing ? "Writing…" : `Commit ${batchDraft.length} rows`}
            </button>
            <button onClick={() => void ask(nl)} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">Regenerate</button>
            <button onClick={() => setPlan(null)} className="btn-ghost text-xs">Cancel</button>
            {!writeExec ? <span className="text-[11px] text-signal-amber">Deploy on Databases page to write.</span> : null}
          </div>
        </div>
      ) : null}

      {plan && plan.kind === "write" ? (
        <div className="glass-soft rounded-xl border border-accent/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-accent-soft">
              Will write to <span className="font-mono">{plan.collection}</span>
            </span>
            {plan.summary ? <span className="text-[11px] text-slate-500">{plan.summary}</span> : null}
          </div>
          <div className="mb-2 flex items-center gap-2">
            <span className="w-20 shrink-0 font-mono text-[11px] text-slate-500">_id</span>
            <input value={draftId} onChange={(e) => setDraftId(e.target.value)}
              className="glass-soft flex-1 rounded px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-accent/50" />
          </div>
          {draft.map(([k, v], i) => (
            <div key={i} className="mb-1.5 flex items-center gap-2">
              <input value={k} onChange={(e) => setDraft((d) => d.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
                className="glass-soft w-20 shrink-0 rounded px-2 py-1 font-mono text-[11px] text-slate-400 outline-none focus:border-accent/50" />
              <input value={v} onChange={(e) => setDraft((d) => d.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
                className="glass-soft flex-1 rounded px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-accent/50" />
              <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} className="px-1 text-slate-600 hover:text-signal-red" title="remove">✕</button>
            </div>
          ))}
          <button onClick={() => setDraft((d) => [...d, ["", ""]])} className="mt-1 text-[11px] text-accent-soft hover:text-white">+ field</button>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void commit()} disabled={committing || !writeExec || !draftId.trim()} className="btn-primary text-xs disabled:opacity-50">
              {committing ? "Writing…" : "Commit write"}
            </button>
            <button onClick={() => void ask(nl)} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">Regenerate</button>
            <button onClick={() => setPlan(null)} className="btn-ghost text-xs">Cancel</button>
            {!writeExec ? <span className="text-[11px] text-signal-amber">Deploy this on the Databases page to write.</span> : null}
          </div>
        </div>
      ) : null}

      {plan && plan.kind === "delete" ? (
        <div className="glass-soft rounded-xl border border-signal-red/30 p-3">
          <p className="text-xs text-slate-200">
            Delete <span className="font-mono text-signal-red">{plan.collection}/{plan.id}</span>? {plan.summary ?? ""}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void commit()} disabled={committing || !writeExec} className="rounded-lg border border-signal-red/40 px-3 py-1.5 text-xs text-signal-red hover:bg-signal-red/10 disabled:opacity-50">
              {committing ? "Deleting…" : "Confirm delete"}
            </button>
            <button onClick={() => void ask(nl)} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">Regenerate</button>
            <button onClick={() => setPlan(null)} className="btn-ghost text-xs">Cancel</button>
            {!writeExec ? <span className="text-[11px] text-signal-amber">Deploy this on the Databases page to write.</span> : null}
          </div>
        </div>
      ) : null}

      {plan && plan.kind === "unsupported" ? (
        <div className="rounded-lg bg-signal-amber/10 px-3 py-2 text-xs text-signal-amber">{plan.reason}</div>
      ) : null}

      {/* SQL / Redis input (shown only in those modes) */}
      {lang !== "nql" ? (
        <div className="flex gap-2">
          <input
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runTranslated(); }}
            placeholder={lang === "sql"
              ? `SELECT * FROM ${first} WHERE … ORDER BY … LIMIT …`
              : `HGETALL ${first}:id  ·  SMEMBERS tags  ·  KEYS *`}
            spellCheck={false}
            className="glass-soft code flex-1 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
          />
          <button onClick={() => void runTranslated()} disabled={busy || !rawInput.trim()} className="btn-primary disabled:opacity-50">
            {busy ? "…" : "Run"}
          </button>
        </div>
      ) : null}

      {/* compiled NQL — the verifiable, editable intermediate (for reads) */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-slate-500">NQL</span>
        <input
          value={nql}
          onChange={(e) => setNql(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
          placeholder={lang === "sql" ? "Compiled NQL (from SQL above)" : lang === "redis" ? "Compiled NQL (from Redis above)" : "FROM … WHERE … ORDER BY … LIMIT …"}
          spellCheck={false}
          className="glass-soft code flex-1 rounded-lg px-3 py-2 text-accent-soft outline-none focus:border-accent/50"
        />
        <button onClick={() => void run()} disabled={!nql.trim()} className="btn-ghost disabled:opacity-50">Run</button>
      </div>

      {/* results */}
      <div className="glass-soft flex-1 overflow-auto rounded-xl">
        {result == null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
            Ask a question, add a record, or edit the NQL and hit Run.
          </div>
        ) : result.error ? (
          <div className="p-4 text-sm text-signal-red">{result.error}</div>
        ) : result.rows.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">0 rows.{result.note ? ` ${result.note}` : ""}</div>
        ) : (
          <ResultsTable
            result={result}
            onCellEdit={writeExec ? (row, col, val) => {
              const id = String(row._id ?? row.id ?? "");
              if (!id) return;
              const coll = String(result.note?.match(/FROM (\w+)/)?.[1] ?? "");
              if (!coll) return;
              void writeExec.put(coll, id, { ...row, [col]: val });
              setNotice(`✓ Updated ${col} on ${id}`);
              onWritten?.();
            } : undefined}
          />
        )}
      </div>
    </div>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 10);
  }
  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="w-full min-w-[80px] bg-accent/10 border border-accent/40 rounded px-2 py-0.5 font-mono text-[12px] text-white outline-none"
        autoFocus
      />
    );
  }
  return (
    <span
      onClick={start}
      onTouchEnd={start}
      title="Tap to edit"
      className="block cursor-text select-none truncate rounded px-1 py-0.5 hover:bg-white/10 active:bg-accent/15 transition"
      style={{ minWidth: 24, WebkitTapHighlightColor: "transparent" }}
    >
      {value || <span className="text-slate-600">—</span>}
    </span>
  );
}

function ResultsTable({
  result,
  onCellEdit,
}: {
  result: QueryResult;
  onCellEdit?: (row: Record<string, unknown>, col: string, newValue: string) => void;
}): React.ReactElement {
  const cell = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="overflow-auto">
      <div className="px-3 pt-3 text-[11px] text-slate-500">
        {result.count} row{result.count === 1 ? "" : "s"}{result.note ? ` · ${result.note}` : ""}
        {onCellEdit ? <span className="ml-2 text-slate-600">· tap any cell to edit</span> : null}
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
                <td key={c} className="max-w-[260px] px-2 py-1" title={cell(row[c])}>
                  {onCellEdit && c !== "_id" ? (
                    <EditableCell value={cell(row[c])} onSave={(v) => onCellEdit(row, c, v)} />
                  ) : (
                    <span className="truncate text-slate-200 block px-1">{cell(row[c])}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
