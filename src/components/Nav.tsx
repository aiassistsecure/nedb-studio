import React, { useEffect, useState, useCallback } from "react";
import { Link, useIsActive } from "@interchained/portal-react";

const LINKS = [
  { href: "/",          label: "Home"      },
  { href: "/studio",    label: "Studio"    },
  { href: "/databases", label: "Databases" },
  { href: "/about",     label: "About"     },
  { href: "/docs",      label: "Docs"      },
];

function useTheme(): [string, (t: string) => void] {
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof window === "undefined") return "v2";
    return document.documentElement.getAttribute("data-theme") ?? "v2";
  });

  const setTheme = useCallback((t: string) => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("nedb-theme", t); } catch { /**/ }
    setThemeState(t);
  }, []);

  useEffect(() => {
    // Sync if the HTML attribute was set by the inline script before React hydrated.
    const current = document.documentElement.getAttribute("data-theme") ?? "v2";
    if (current !== theme) setThemeState(current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return [theme, setTheme];
}

function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-toggle" title="Switch theme">
      <span
        className={theme === "v1" ? "active" : ""}
        onClick={() => setTheme("v1")}
        role="button"
        tabIndex={0}
        aria-label="Switch to V1 Indigo Glass theme"
      >
        V1
      </span>
      <span
        className={theme === "v2" ? "active" : ""}
        onClick={() => setTheme("v2")}
        role="button"
        tabIndex={0}
        aria-label="Switch to V2 Void theme"
      >
        V2
      </span>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }): React.ReactElement {
  const active = useIsActive(href);
  return (
    <Link
      href={href}
      className={
        "relative rounded-md px-3 py-1.5 text-sm transition-all duration-150 " +
        (active ? "text-white" : "text-slate-400 hover:text-white")
      }
    >
      {active && (
        <span
          className="absolute inset-0 rounded-md bg-accent/10 ring-1 ring-accent/20"
          aria-hidden
        />
      )}
      <span className="relative">{label}</span>
    </Link>
  );
}

/** Polls /api/settings for the connected nedbd engine type and shows a read-only badge. */
function EngineBadge(): React.ReactElement | null {
  const [engine, setEngine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/settings");
        if (!r.ok || cancelled) return;
        const d = await r.json() as { connection?: { engine?: string; connected?: boolean } };
        if (!cancelled) setEngine(d.connection?.connected ? (d.connection?.engine ?? null) : null);
      } catch { /* server unreachable */ }
    }
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!engine) return null;
  const isDAG = engine === "dag";
  return (
    <span
      title={isDAG
        ? "Connected to nedbd v2 DAG engine — content-addressed, tamper-evident"
        : "Connected to nedbd v1 AOF engine — start with --dag to use v2 DAG engine"}
      className={
        "hidden rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide sm:inline " +
        (isDAG
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-400")
      }
    >
      {isDAG ? "DAG ◆" : "AOF"}
    </span>
  );
}

export function Nav(): React.ReactElement {
  return (
    <header className="glass sticky top-0 z-50 border-b !border-b-[var(--border-1)]"
      style={{ borderRadius: 0 }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span className="text-lg text-accent-glow drop-shadow-[0_0_8px_rgba(var(--accent-glow)/0.6)]">◆</span>
          <span className="text-[15px] font-semibold tracking-tight text-white">NEDB Studio</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <EngineBadge />
          <ThemeToggle />
          <Link
            href="/settings"
            className="rounded-md px-2 py-1.5 text-sm text-slate-500 transition hover:text-white"
            title="Settings — NEDB connection"
          >
            ⚙
          </Link>
          <a
            href="https://www.npmjs.com/package/nedb-engine"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden font-mono text-xs text-slate-500 hover:text-white sm:inline transition-colors"
          >
            nedb-engine
          </a>
          <a
            href="https://github.com/Eth-Interchained/nedb"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
