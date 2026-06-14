import React, { useMemo, useState } from "react";
import type { Field, NEDBScaffold } from "../lib/types";

const CELL_W = 300;
const NODE_W = 232;
const HEADER_H = 34;
const ROW_H = 22;
const PAD = 28;
const V_GAP = 30; // vertical gap between stacked cards in a column
const INDENT = 12; // per-level indent for nested fields
const MAX_FIELDS = 7;

const KIND_COLOR: Record<string, string> = {
  eq: "#34d399",
  ordered: "#fbbf24",
  search: "#22d3ee",
};

// One rendered field line — flattened from the (possibly nested) field tree.
interface VisRow {
  field: Field;
  depth: number;
  path: string; // dotted path within the collection, e.g. "address.geo"
  hasChildren: boolean;
  expanded: boolean;
}

interface GNode {
  name: string;
  rows: VisRow[];
  topCount: number;
  expandable: boolean; // card-level: more top-level fields than MAX_FIELDS
  expanded: boolean; // card-level expanded
  x: number;
  y: number;
  w: number;
  h: number;
}

// Walk the field tree, emitting a row per visible field. An object field's
// children are emitted (indented) only when that field's path is expanded —
// this is what makes the drill-down "infinite": group → field → sub-field → …
function flatten(
  fields: Field[],
  coll: string,
  exp: Set<string>,
  depth: number,
  prefix: string,
  out: VisRow[],
): void {
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    const kids = f.fields && f.fields.length > 0 ? f.fields : null;
    const isExp = exp.has(`${coll}::${path}`);
    out.push({ field: f, depth, path, hasChildren: !!kids, expanded: isExp });
    if (kids && isExp) flatten(kids, coll, exp, depth + 1, path, out);
  }
}

export function SchemaGraph({
  scaffold,
  onOpenCollection,
}: {
  scaffold: NEDBScaffold;
  /** When provided, clicking a leaf field (or the header ↗) opens that
   *  collection in the editor. Object fields expand inline; cards expand on a
   *  background/header click. */
  onOpenCollection?: (coll: string) => void;
}): React.ReactElement {
  const [hover, setHover] = useState<string | null>(null);
  // Tracks every open thing by key: card = "coll", nested field = "coll::path".
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const openable = typeof onOpenCollection === "function";

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { nodes, pos, idx, width, height } = useMemo(() => {
    const n = Math.max(1, scaffold.collections.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const indexMap = new Map<string, string>();
    for (const i of scaffold.indexes) {
      const key = `${i.collection}.${i.field}`;
      if (!indexMap.has(key)) indexMap.set(key, i.kind);
    }
    // Stack cards top-to-bottom within each column so expansion reflows the
    // cards beneath instead of overlapping (heights are dynamic).
    const colY: number[] = new Array(cols).fill(PAD);
    const list: GNode[] = scaffold.collections.map((c, i) => {
      const col = i % cols;
      const cardExpanded = expanded.has(c.name);
      const topCount = c.fields.length;
      const expandable = topCount > MAX_FIELDS;
      const topShown = cardExpanded ? c.fields : c.fields.slice(0, MAX_FIELDS);
      const rows: VisRow[] = [];
      flatten(topShown, c.name, expanded, 0, "", rows);
      const footer = expandable ? ROW_H : 0; // "+N more" / "show less" row
      const h = HEADER_H + rows.length * ROW_H + footer + 12;
      const x = PAD + col * CELL_W;
      const y = colY[col];
      colY[col] = y + h + V_GAP;
      return { name: c.name, rows, topCount, expandable, expanded: cardExpanded, x, y, w: NODE_W, h };
    });
    const map = new Map(list.map((nd) => [nd.name, nd] as const));
    return {
      nodes: list,
      pos: map,
      idx: indexMap,
      width: PAD * 2 + cols * NODE_W + (cols - 1) * (CELL_W - NODE_W),
      height: Math.max(...colY) - V_GAP + PAD,
    };
  }, [scaffold, expanded]);

  const center = (nd: GNode) => ({ x: nd.x + nd.w / 2, y: nd.y + nd.h / 2 });

  const isConnected = (name: string): boolean =>
    !hover ||
    hover === name ||
    scaffold.relations.some(
      (r) => (r.from === name && r.to === hover) || (r.to === name && r.from === hover),
    );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Database schema graph"
    >
      <defs>
        <marker id="arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="#818cf8" />
        </marker>
      </defs>

      {/* relation edges */}
      {scaffold.relations.map((r, i) => {
        const a = pos.get(r.from);
        const b = pos.get(r.to);
        if (!a || !b) return null;
        const c1 = center(a);
        const c2 = center(b);
        const mx = (c1.x + c2.x) / 2;
        const my = (c1.y + c2.y) / 2;
        const active = !hover || hover === r.from || hover === r.to;
        return (
          <g key={`e-${i}`} opacity={active ? 1 : 0.12}>
            <path
              d={`M ${c1.x} ${c1.y} Q ${mx} ${my - 46} ${c2.x} ${c2.y}`}
              fill="none"
              stroke="#6366f1"
              strokeWidth={1.4}
              markerEnd="url(#arrow)"
            />
            <text x={mx} y={my - 26} textAnchor="middle" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#94a3b8">
              {r.relation} · {r.cardinality.replace(/_/g, " ")}
            </text>
          </g>
        );
      })}

      {/* entity cards */}
      {nodes.map((nd) => {
        const dim = hover != null && !isConnected(nd.name);
        const focused = hover === nd.name;
        const footerY = nd.y + HEADER_H + 16 + nd.rows.length * ROW_H;
        return (
          <g
            key={nd.name}
            opacity={dim ? 0.22 : 1}
            onMouseEnter={() => setHover(nd.name)}
            onMouseLeave={() => setHover(null)}
            onClick={() => toggle(nd.name)}
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            aria-expanded={nd.expanded}
            aria-label={`${nd.name} — ${nd.topCount} fields${nd.expandable ? `, click to ${nd.expanded ? "collapse" : "expand"}` : ""}`}
          >
            <rect
              x={nd.x}
              y={nd.y}
              width={nd.w}
              height={nd.h}
              rx={10}
              fill="#0e1322"
              stroke={focused ? "#818cf8" : "rgba(99,102,241,0.3)"}
              strokeWidth={focused ? 1.8 : 1}
            />
            <path
              d={`M ${nd.x} ${nd.y + 10} q 0 -10 10 -10 h ${nd.w - 20} q 10 0 10 10 v ${HEADER_H - 10} h ${-nd.w} z`}
              fill="rgba(99,102,241,0.16)"
            />
            <text x={nd.x + 12} y={nd.y + 22} fontSize="13" fontWeight={700} fontFamily="JetBrains Mono, monospace" fill="#ffffff">
              {nd.name}
            </text>
            {openable ? (
              <text
                x={nd.x + nd.w - (nd.expandable ? 30 : 12)}
                y={nd.y + 22}
                textAnchor="end"
                fontSize="12"
                fontFamily="JetBrains Mono, monospace"
                fill="#34d399"
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); onOpenCollection!(nd.name); }}
              >
                {"↗"}
                <title>Open {nd.name} in the editor</title>
              </text>
            ) : null}
            {nd.expandable ? (
              <text
                x={nd.x + nd.w - 12}
                y={nd.y + 22}
                textAnchor="end"
                fontSize="12"
                fontFamily="JetBrains Mono, monospace"
                fill="#818cf8"
              >
                {nd.expanded ? "▾" : "▸"}
              </text>
            ) : null}

            {nd.rows.map((row, ri) => {
              const isTop = row.depth === 0;
              const kind = isTop ? idx.get(`${nd.name}.${row.field.name}`) : undefined;
              const yy = nd.y + HEADER_H + 16 + ri * ROW_H;
              const rowX = nd.x + 12 + row.depth * INDENT;
              const hasKids = row.hasChildren;
              const interactive = hasKids || openable;
              // object field → expand/collapse its children; leaf → open editor
              const onRowClick = hasKids
                ? (e: React.MouseEvent) => { e.stopPropagation(); toggle(`${nd.name}::${row.path}`); }
                : openable
                  ? (e: React.MouseEvent) => { e.stopPropagation(); onOpenCollection!(nd.name); }
                  : undefined;
              const nameX = hasKids ? rowX + 12 : kind ? rowX + 10 : rowX;
              return (
                <g
                  key={row.path}
                  onClick={onRowClick}
                  style={interactive ? { cursor: "pointer" } : undefined}
                >
                  {interactive ? (
                    <>
                      <title>
                        {hasKids
                          ? `${row.expanded ? "Collapse" : "Expand"} ${row.field.name}`
                          : `Open ${nd.name} in the editor`}
                      </title>
                      <rect x={nd.x + 4} y={yy - 14} width={nd.w - 8} height={ROW_H} rx={4} fill="transparent" />
                    </>
                  ) : null}
                  {hasKids ? (
                    <text x={rowX} y={yy} fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#818cf8">
                      {row.expanded ? "▾" : "▸"}
                    </text>
                  ) : null}
                  {kind && !hasKids ? (
                    <circle cx={rowX + 1} cy={yy - 4} r={3} fill={KIND_COLOR[kind] ?? "#94a3b8"}>
                      <title>{kind} index</title>
                    </circle>
                  ) : null}
                  <text x={nameX} y={yy} fontSize="11" fontFamily="JetBrains Mono, monospace" fill="#cbd5e1">
                    {row.field.name}
                    {row.field.required ? <tspan fill="#f87171"> *</tspan> : null}
                  </text>
                  <text
                    x={nd.x + nd.w - 12}
                    y={yy}
                    textAnchor="end"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                    fill={hasKids ? "#818cf8" : "#64748b"}
                  >
                    {row.field.type}
                  </text>
                </g>
              );
            })}
            {nd.expandable ? (
              <text x={nd.x + 22} y={footerY} fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#818cf8">
                {nd.expanded ? "− show less" : `+${nd.topCount - MAX_FIELDS} more fields`}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
