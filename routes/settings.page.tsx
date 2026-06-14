import React, { useEffect, useState } from "react";
import { Head } from "@interchained/portal-react";

import { Nav } from "../src/components/Nav";
import {
  getSettings,
  saveSettings,
  testConnection,
  type ConnectionStatus,
  type StudioSettings,
} from "../src/lib/api";

export const intent = {
  purpose: "Configure the NEDB connection (NEDB_URL + token, env-first with override), test it, and review gateway status",
  primaryAction: "Test connection",
  seoKeyword: "NEDB connection settings",
};

export default function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<ConnectionStatus | null>(null);
  const [saved, setSaved] = useState(false);
  const [pageSize, setPageSize] = useState(() =>
    typeof window === "undefined" ? "100" : window.localStorage.getItem("nedb-studio:pageSize") ?? "100",
  );

  async function load(): Promise<void> {
    const s = await getSettings();
    setSettings(s);
    setUrl(s.nedb.effective.url);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onTest(): Promise<void> {
    setTesting(true);
    setTested(null);
    try {
      setTested(await testConnection(url || undefined, token || undefined));
    } finally {
      setTesting(false);
    }
  }

  async function onSave(): Promise<void> {
    await saveSettings(url || undefined, token || undefined);
    setToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    await load();
  }

  function savePageSize(v: string): void {
    setPageSize(v);
    if (typeof window !== "undefined") window.localStorage.setItem("nedb-studio:pageSize", v);
  }

  const conn = tested ?? settings?.connection;

  return (
    <div className="min-h-screen">
      <Head title="Settings" description="Configure the NEDB connection for NEDB Studio." />
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          NEDB Studio is a client of a running NEDB server (<span className="font-mono">nedbd</span>). Configure how it connects.
        </p>

        {/* Connection */}
        <section className="glass mt-6 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">NEDB CONNECTION</h2>
            <div className="flex items-center gap-2">
              {conn?.connected && (conn as Record<string, unknown>).encrypted !== undefined ? (
                <span className={
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold " +
                  ((conn as Record<string, unknown>).encrypted
                    ? "bg-signal-green/15 text-signal-green"
                    : "bg-signal-amber/15 text-signal-amber")
                }>
                  {(conn as Record<string, unknown>).encrypted ? "● AES-256-GCM" : "● plaintext"}
                </span>
              ) : null}
              <ConnPill conn={conn} />
            </div>
          </div>

          <label className="mt-4 block text-xs uppercase tracking-widest text-slate-500">NEDB server URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:7070"
            className="glass-soft mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-accent/50"
          />

          <label className="mt-3 block text-xs uppercase tracking-widest text-slate-500">
            Bearer token {settings?.nedb.effective.hasToken ? <span className="text-signal-green">(set)</span> : <span className="text-slate-600">(optional)</span>}
          </label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder={settings?.nedb.effective.hasToken ? "•••••••• — leave blank to keep" : "NEDBD_TOKEN (if the daemon requires it)"}
            className="glass-soft mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-accent/50"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => void onTest()} disabled={testing} className="btn-ghost disabled:opacity-50">
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button onClick={() => void onSave()} className="btn-primary">
              {saved ? "Saved ✓" : "Save"}
            </button>
            {settings?.nedb.overridden ? (
              <span className="text-xs text-slate-500">overriding env default <span className="font-mono">{settings.nedb.env.url}</span></span>
            ) : (
              <span className="text-xs text-slate-500">using env default (NEDB_URL)</span>
            )}
          </div>

          {tested ? (
            <p className={"mt-3 text-xs " + (tested.connected ? "text-signal-green" : "text-signal-red")}>
              {tested.connected
                ? `Connected — nedbd ${tested.version ?? ""}, ${tested.databases?.length ?? 0} database(s).`
                : `Not reachable: ${tested.error}`}
            </p>
          ) : null}

          {conn && !conn.connected ? (
            <div className="mt-4 rounded-lg border border-signal-amber/30 bg-signal-amber/10 p-3 text-xs text-signal-amber">
              No NEDB server reachable. Start one with <span className="font-mono">pip install nedb-engine &amp;&amp; nedbd</span>, then Test.
            </div>
          ) : null}
        </section>

        {/* AiAssist */}
        <section className="glass mt-4 rounded-2xl p-5">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">AiAssist GATEWAY</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label="Mode" value={settings?.aiassist.mode ?? "…"} good={settings?.aiassist.mode === "live"} />
            <Field label="Default provider" value={settings?.aiassist.defaultProvider ?? "…"} />
            <Field label="Default model" value={settings?.aiassist.defaultModel ?? "…"} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            The AiAssist key is read server-side only (set <span className="font-mono">AIASSIST_API_KEY</span>). It powers NL→NQL and schema generation.
          </p>
        </section>

        {/* Preferences */}
        <section className="glass mt-4 rounded-2xl p-5">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">PREFERENCES</h2>
          <label className="mt-3 block text-xs uppercase tracking-widest text-slate-500">Rows per page (query results)</label>
          <select
            value={pageSize}
            onChange={(e) => savePageSize(e.target.value)}
            className="glass-soft mt-1 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
          >
            {["50", "100", "250", "500"].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </section>
      </main>
    </div>
  );
}

function ConnPill({ conn }: { conn?: ConnectionStatus }): React.ReactElement {
  const ok = conn?.connected;
  return (
    <span
      className={
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold " +
        (ok ? "bg-signal-green/15 text-signal-green" : "bg-signal-red/15 text-signal-red")
      }
    >
      {ok ? "● connected" : "● not connected"}
    </span>
  );
}

function Field({ label, value, good }: { label: string; value: string; good?: boolean }): React.ReactElement {
  return (
    <div className="glass-soft rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={"font-mono text-sm " + (good ? "text-signal-green" : "text-slate-200")}>{value}</div>
    </div>
  );
}
