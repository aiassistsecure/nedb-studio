import React, { useEffect, useRef, useState } from "react";
import { Head, Link, useSearchParams } from "@interchained/portal-react";

import { Nav } from "../src/components/Nav";
import { GatewayBar } from "../src/components/GatewayBar";
import { PromptPanel } from "../src/components/PromptPanel";
import { SchemaGraph } from "../src/components/SchemaGraph";
import { QueryConsole } from "../src/components/QueryConsole";
import { ArtifactTabs } from "../src/components/ArtifactTabs";
import { generate, getProviders, getStatus } from "../src/lib/api";
import { saveActiveDatabase } from "../src/lib/database";
import type { NEDBScaffold, ProviderInfo } from "../src/lib/types";

export const intent = {
  purpose: "Describe an app, generate a validated NEDB scaffold, inspect the schema graph, export artifacts",
  primaryAction: "Generate Schema",
  seoKeyword: "NEDB schema generator",
};

export default function StudioPage(): React.ReactElement {
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("prompt") ?? "";

  const [prompt, setPrompt] = useState(initialPrompt);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const [scaffold, setScaffold] = useState<NEDBScaffold | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [centerTab, setCenterTab] = useState<"schema" | "query">("schema");
  const [querySeed, setQuerySeed] = useState("");
  const [seedKey, setSeedKey] = useState(0);
  const autoRan = useRef(false);

  // Drill-down from the schema graph: open a collection in the query console.
  // (Studio is design-time — read-only. To edit live rows, Deploy → Databases.)
  function openInConsole(coll: string): void {
    setQuerySeed(`FROM ${coll} LIMIT 50`);
    setSeedKey((k) => k + 1);
    setCenterTab("query");
  }

  // Load provider/model catalog + mode from the server (which holds the key).
  useEffect(() => {
    void (async () => {
      try {
        const [status, payload] = await Promise.all([getStatus(), getProviders()]);
        setMode(payload.mode);
        setProviders(payload.providers);
        const def =
          payload.providers.find((p) => p.id === payload.defaultProvider) ?? payload.providers[0];
        if (def) {
          setProvider(def.id);
          const m = def.models.find((mm) => mm.id === status.defaultModel) ?? def.models[0];
          if (m) setModel(m.id);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Keep model consistent with the selected provider.
  useEffect(() => {
    const p = providers.find((pp) => pp.id === provider);
    if (p && !p.models.some((m) => m.id === model)) {
      setModel(p.models[0]?.id ?? "");
    }
  }, [provider, providers]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runGenerate(): Promise<void> {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setNotes([]);
    try {
      const res = await generate(prompt, provider || undefined, model || undefined);
      setScaffold(res.scaffold);
      setMode(res.mode);
      setNotes(res.notes ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-run once if we arrived from a landing-page example chip (?prompt=…).
  useEffect(() => {
    if (!autoRan.current && initialPrompt.trim() && provider) {
      autoRan.current = true;
      void runGenerate();
    }
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen flex-col">
      <Head title="Studio" description="Describe an app and generate a validated NEDB schema: collections, relations, indexes, seed data, NQL, and Python/Node snippets." />
      <Nav />

      <div className="glass border-b border-white/10 px-4 py-2">
        <GatewayBar
          providers={providers}
          provider={provider}
          model={model}
          onSelect={(p, m) => { setProvider(p); setModel(m); }}
        />
      </div>

      <main className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[21rem_1fr_25rem]">
        {/* Left — control surface */}
        <aside className="flex flex-col overflow-y-auto border-b border-white/10 lg:border-b-0 lg:border-r">
          <PromptPanel
            prompt={prompt}
            onPrompt={setPrompt}
            providers={providers}
            provider={provider}
            onProvider={setProvider}
            model={model}
            onModel={setModel}
            onGenerate={runGenerate}
            loading={loading}
            mode={mode}
          />
          {notes.length > 0 ? (
            <div className="mx-4 mb-4 rounded-lg border border-signal-amber/30 bg-signal-amber/10 p-3 text-xs text-signal-amber">
              {notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          ) : null}
        </aside>

        {/* Center — schema graph */}
        <section className="relative overflow-auto">
          {error ? (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border border-signal-red/30 bg-signal-red/10 px-4 py-2 text-sm text-signal-red">
              {error}
            </div>
          ) : null}
          {scaffold ? (
            <div className="flex h-full flex-col">
              <div
                className="flex items-center justify-between gap-3 border-b px-5 py-4"
                style={{ borderColor: "var(--border-2)" }}
              >
                <div className="min-w-0">
                  <h1
                    className="truncate font-bold text-white"
                    style={{ fontSize: "1.1rem", fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}
                  >
                    {scaffold.appName}
                  </h1>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">{scaffold.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden gap-3 font-mono text-[11px] text-slate-600 sm:flex">
                    <span><span className="text-slate-400">{scaffold.collections.length}</span> coll</span>
                    <span><span className="text-slate-400">{scaffold.relations.length}</span> rel</span>
                    <span><span className="text-slate-400">{scaffold.indexes.length}</span> idx</span>
                  </div>
                  <div className="flex text-xs">
                    {(["schema", "query"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setCenterTab(t)}
                        className={"relative rounded-md px-3 py-1.5 capitalize transition " + (centerTab === t ? "text-white" : "text-slate-500 hover:text-white")}
                      >
                        {centerTab === t && (
                          <span className="absolute inset-0 rounded-md bg-accent/10 ring-1 ring-accent/20" aria-hidden />
                        )}
                        <span className="relative">{t}</span>
                      </button>
                    ))}
                  </div>
                  <Link
                    href="/databases"
                    onClick={() => saveActiveDatabase(scaffold)}
                    className="btn-primary px-4 py-1.5 text-xs"
                    title="Deploy this schema as a durable database, then query it live"
                  >
                    Deploy →
                  </Link>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {centerTab === "schema" ? (
                  <SchemaGraph scaffold={scaffold} onOpenCollection={openInConsole} />
                ) : (
                  <QueryConsole key={seedKey} scaffold={scaffold} initialNql={querySeed} />
                )}
              </div>
            </div>
          ) : (
            <EmptyState loading={loading} onGenerate={runGenerate} canGenerate={prompt.trim().length > 0} />
          )}
        </section>

        {/* Right — artifacts */}
        <aside className="overflow-hidden border-t border-white/10 lg:border-t-0 lg:border-l">
          {scaffold ? (
            <ArtifactTabs scaffold={scaffold} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
              Generated artifacts — schema, relations, indexes, seed data, NQL, Python, Node, and a README — appear here after you generate.
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function EmptyState({
  loading,
  onGenerate,
  canGenerate,
}: {
  loading: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
}): React.ReactElement {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-5 p-10 text-center">
      {/* Animated glyph */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
        style={{
          background: "rgba(var(--accent)/0.08)",
          border: "1px solid rgba(var(--accent)/0.16)",
          color: "rgb(var(--accent-glow))",
          boxShadow: loading ? "0 0 32px -8px rgba(var(--accent)/0.3)" : "none",
          animation: loading ? "pulse-glow 2s ease-in-out infinite" : "none",
        }}
      >
        {loading ? "⧖" : "◆"}
      </div>
      <div>
        <h1
          className="font-bold text-white"
          style={{ fontSize: "1.2rem", fontFamily: "var(--font-display)" }}
        >
          {loading ? "Generating your schema…" : "Schema graph appears here"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
          {loading
            ? "Building collections, relations, indexes, and seed data."
            : "Describe an application on the left — entities, relations, indexes, and seed data will be rendered as a live graph."}
        </p>
      </div>
      {!loading && (
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Generate Schema
        </button>
      )}
    </div>
  );
}
