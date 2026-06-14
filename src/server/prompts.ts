/**
 * System prompts for the two-pass generation pipeline:
 *   runner   → fast first-pass NEDBScaffold JSON from a natural-language prompt
 *   sentinel → validate / repair JSON that failed Zod or referential checks
 *
 * Both are sent through AiAssist (provider/model chosen in the UI). The output
 * is always plain JSON — the server parses + validates with the Zod schema in
 * src/lib/types.ts before anything reaches the browser.
 *
 * Extraction uses the KeyStone-Lite sentinel technique (see ./blocks): the model
 * wraps output in <<<SCAFFOLD>>>…<<<END>>> / <<<NQL>>>…<<<END>>>, and we pull the
 * block verbatim before parsing — robust against fences, prose, and stray chars.
 */

import { extractBlock } from "./blocks";

export const SCAFFOLD_SCHEMA_DOC = `
Return a single JSON object (no markdown, no prose) matching this TypeScript type:

type NEDBScaffold = {
  appName: string;
  description: string;
  collections: Array<{
    name: string;                       // snake_case plural, e.g. "users", "work_orders"
    fields: Array<{
      name: string;
      type: "string" | "number" | "boolean" | "datetime" | "json" | "file" | "reference";
      required?: boolean;
      description?: string;
    }>;
  }>;
  relations: Array<{
    from: string;                       // a collection name
    relation: string;                   // verb, e.g. "owns", "books", "authored"
    to: string;                         // a collection name
    cardinality: "one_to_one" | "one_to_many" | "many_to_many";
  }>;
  indexes: Array<{
    collection: string;                 // must exist in collections
    field: string;                      // must exist on that collection
    kind: "eq" | "ordered" | "search";  // eq=equality, ordered=sort/range, search=full-text
  }>;
  seedData: Record<string, any[]>;      // keys are collection names; 2-3 realistic rows each, include an "id"
  nqlExamples: string[];                // 3-5 NQL queries (see grammar below)
  pythonSnippet: string;                // may be "" — the server fills it deterministically
  nodeSnippet: string;                  // may be ""
  readmeExport: string;                 // may be ""
};

NQL grammar:
  FROM <collection> [AS OF <seq>] [WHERE <field> <op> <value> (AND ...)] [SEARCH "<text>"]
  [ORDER BY <field> [ASC|DESC]] [TRAVERSE <relation>] [LIMIT <n>]   ; op in = != < <= > >=

Rules:
- Every relation.from/to and index.collection MUST be a declared collection.
- Every index.field MUST exist on its collection.
- seedData keys MUST be declared collections; give each 2-3 realistic rows with an "id".
- Add eq indexes for fields you filter on, ordered for fields you sort/range on, search for free-text fields.
- Keep it focused: 3-7 collections. Use "reference" type for foreign keys.
- Do NOT output pythonSnippet, nodeSnippet, or readmeExport at all — the server generates them. Putting code/markdown in JSON strings is what breaks the parse; omit those keys entirely.
`.trim();

export function runnerSystem(): string {
  return [
    "You are a senior database architect for NEDB, an embedded, replay-protected,",
    "time-traveling database. Turn the user's app description into a clean, normalized schema scaffold.",
    "",
    "OUTPUT FORMAT — wrap the JSON object between these EXACT sentinels and output NOTHING else:",
    "<<<SCAFFOLD>>>",
    "{ ...the JSON object... }",
    "<<<END>>>",
    "",
    "RULES:",
    "1. Output ONLY valid JSON inside the block — no markdown fences, no prose, no trailing commas.",
    "2. Do NOT include pythonSnippet, nodeSnippet, or readmeExport — the server generates those; code inside JSON is what breaks it.",
    "3. NEVER truncate or use '...'. Always close with <<<END>>>.",
    "",
    SCAFFOLD_SCHEMA_DOC,
  ].join("\n");
}

export function runnerMessages(prompt: string): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: `Design an NEDB scaffold for this application:\n\n${prompt}` }];
}

export function sentinelSystem(): string {
  return [
    "You are a strict schema validator and repair pass for NEDB scaffolds.",
    "You are given a candidate JSON scaffold and a list of validation errors.",
    "Return a corrected JSON object that fixes EVERY error while preserving intent.",
    "",
    "Wrap the corrected JSON between these EXACT sentinels and output NOTHING else:",
    "<<<SCAFFOLD>>>",
    "{ ...the corrected JSON... }",
    "<<<END>>>",
    "Valid JSON only inside the block — no markdown, no trailing commas. Omit pythonSnippet/nodeSnippet/readmeExport.",
    "",
    SCAFFOLD_SCHEMA_DOC,
  ].join("\n");
}

export function sentinelMessages(
  prompt: string,
  candidate: string,
  errors: string[],
): Array<{ role: "user"; content: string }> {
  return [
    {
      role: "user",
      content: [
        `Original app description:\n${prompt}`,
        "",
        `Candidate scaffold JSON:\n${candidate}`,
        "",
        `Validation errors to fix:\n- ${errors.join("\n- ")}`,
        "",
        "Return the corrected JSON object.",
      ].join("\n"),
    },
  ];
}

/** Pull a JSON object out of a model response that may have stray prose/fences. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// ── Natural language → NQL (the query console) ────────────────────────────────

interface SchemaLite {
  collections: Array<{ name: string; fields: Array<{ name: string; type: string }> }>;
  relations: Array<{ from: string; relation: string; to: string }>;
  indexes?: Array<{ collection: string; field: string; kind: string }>;
}

export function nqlSystem(schema: SchemaLite): string {
  const cols = schema.collections
    .map((c) => `- ${c.name}(${c.fields.map((f) => f.name).join(", ")})`)
    .join("\n");
  const rels = schema.relations.length
    ? schema.relations.map((r) => `- ${r.from} --${r.relation}--> ${r.to}`).join("\n")
    : "- (none)";
  return [
    "You translate a natural-language request into a SINGLE NQL query for the NEDB engine.",
    "Wrap the one-line query between these EXACT sentinels and output nothing else:",
    "<<<NQL>>>",
    'FROM ... WHERE ... ORDER BY ... LIMIT ...',
    "<<<END>>>",
    "No markdown, no prose, no quotes around the whole query.",
    "",
    "NQL grammar:",
    'FROM <collection> [AS OF <seq>] [WHERE <field> <op> <value> (AND <field> <op> <value>)*] [SEARCH "<text>"] [ORDER BY <field> [ASC|DESC]] [TRAVERSE <relation>] [LIMIT <n>]',
    "op ∈ = != < <= > >= . String values use double quotes. Only reference declared collections/fields.",
    "",
    "Collections and fields:",
    cols,
    "Relations (for TRAVERSE):",
    rels,
  ].join("\n");
}

export function nqlMessages(prompt: string): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: `Translate this to one NQL query: ${prompt}` }];
}

// ── Natural language → action plan (read OR write) ────────────────────────────

export function planSystem(schema: SchemaLite): string {
  const cols = schema.collections
    .map((c) => `- ${c.name}(${c.fields.map((f) => f.name).join(", ")})`)
    .join("\n");
  return [
    "You turn ONE natural-language instruction about a database into ONE action.",
    "",
    "Reply with ONLY a single JSON object between these EXACT markers, nothing else:",
    "<<<PLAN>>>",
    "{...}",
    "<<<END>>>",
    "",
    "The JSON is exactly one of:",
    '  {"kind":"query","nql":"<one NQL query>"}',
    '  {"kind":"write","collection":"<c>","id":"<id>","doc":{<field:value,...>},"summary":"<short>"}',
    '  {"kind":"batch","collection":"<c>","rows":[{"id":"<id>","doc":{...}},...],"summary":"<short>"}',
    '  {"kind":"delete","collection":"<c>","id":"<id>","summary":"<short>"}',
    '  {"kind":"unsupported","reason":"<why>"}',
    "",
    "Rules:",
    "- WRITE (add/insert/create/new/register/update/set/change/edit/rename) -> \"write\" for ONE item, \"batch\" for TWO OR MORE items listed in the instruction.",
    "- BATCH: use when the user lists multiple distinct items to add/insert (e.g. \"add Ada, Bo, and Cy\"). Each item gets its own {id, doc} entry in \"rows\".",
    "- DELETE (delete/remove/drop a row) -> \"delete\".",
    "- Otherwise (show/list/find/get/search/count/top/recent/which/what) -> \"query\".",
    "- For a write/batch: put extracted values into \"doc\" using ONLY declared fields of the chosen collection.",
    "  Choose \"id\": an explicit id if given, else a clean slug of the name/title (lowercase, hyphens).",
    "  For an update, include ONLY the fields being changed in \"doc\" (the server merges onto the existing row).",
    "- NQL grammar: FROM <c> [WHERE field op value (AND field op value)*] [SEARCH \"text\"] [ORDER BY field [ASC|DESC]] [TRAVERSE rel] [LIMIT n]; op in = != < <= > >=; string values in double quotes.",
    "- Only reference declared collections/fields. Never put code or markdown inside the JSON.",
    "",
    "Collections and fields:",
    cols,
  ].join("\n");
}

export function planMessages(prompt: string): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: prompt }];
}

/** Pull the action-plan JSON out of a model response (sentinel block, then brace-slice). */
export function extractPlan(text: string): unknown {
  const block = extractBlock(text, "PLAN") ?? text;
  try {
    return JSON.parse(block);
  } catch {
    return extractJson(block);
  }
}

/** Pull a clean single-line NQL query out of a model response. */
export function extractNql(text: string): string {
  let t = (extractBlock(text, "NQL") ?? text).trim();
  const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const fromLine = lines.find((l) => /^from\s/i.test(l));
  let q = (fromLine ?? lines[0] ?? t).trim();
  // Drop a trailing semicolon (NQL has none) — but NEVER strip a closing string
  // quote: `FROM users SEARCH "rust"` must keep its final ". Only unwrap when the
  // WHOLE query is wrapped in a matching quote/backtick pair.
  q = q.replace(/;+\s*$/, "").trim();
  while (q.length >= 2) {
    const a = q[0], b = q[q.length - 1];
    if ((a === '"' || a === "'" || a === "`") && a === b) q = q.slice(1, -1).trim();
    else break;
  }
  return q;
}
