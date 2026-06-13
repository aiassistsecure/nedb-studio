import React from "react";
import type { ProviderInfo } from "../lib/types";

/**
 * Gateway bar — the AiAssist providers/models this studio can reach, as a calm,
 * clickable strip (no auto-scroll). Click a chip to make that provider/model the
 * active generation target; the live one is highlighted. Replaces the old
 * scrolling marquee: an infrastructure tool surfaces capability you can act on,
 * not motion for its own sake.
 */
export function GatewayBar({
  providers,
  provider,
  model,
  onSelect,
}: {
  providers: ProviderInfo[];
  provider: string;
  model: string;
  onSelect: (providerId: string, modelId: string) => void;
}): React.ReactElement | null {
  const items: Array<{ pid: string; mid: string; provider: string; model: string }> = [];
  for (const p of providers) {
    for (const m of p.models) items.push({ pid: p.id, mid: m.id, provider: p.label, model: m.name });
  }
  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-[10px] uppercase tracking-widest text-slate-600">gateway</span>
      {items.map((it) => {
        const active = it.pid === provider && it.mid === model;
        return (
          <button
            key={`${it.pid}:${it.mid}`}
            onClick={() => onSelect(it.pid, it.mid)}
            title={`Use ${it.provider} / ${it.model} for generation`}
            className={
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition " +
              (active
                ? "border-accent/60 bg-accent/15 text-white"
                : "border-white/10 text-slate-300 hover:border-accent/40 hover:text-white")
            }
          >
            <span className="text-accent-soft">{it.provider}</span>
            <span className="text-slate-600"> / </span>
            <span className="font-mono text-[11px] text-slate-300">{it.model}</span>
            {active ? <span className="ml-1 text-signal-green">●</span> : null}
          </button>
        );
      })}
    </div>
  );
}
