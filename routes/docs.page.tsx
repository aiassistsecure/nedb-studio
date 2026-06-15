import React, { useState } from "react";
import { Head, Link } from "@interchained/portal-react";
import { Nav } from "../src/components/Nav";

export const intent = {
  purpose: "Get developers running: install nedb-engine, use the full feature set, connect nedbd, run mock mode",
  primaryAction: "Install nedb-engine",
  seoKeyword: "nedb embedded database docs",
};

function CodeBlock({ code }: { code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setCopied(false); }
  }
  return (
    <div className="glass-soft relative rounded-xl">
      <button onClick={copy} className="chip absolute right-2 top-2">{copied ? "Copied ✓" : "Copy"}</button>
      <pre className="code overflow-auto p-4 pr-20 text-slate-200">{code}</pre>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="mt-12">
      <h2 className="mb-1 text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
      {sub && <p className="mb-3 text-sm text-slate-400">{sub}</p>}
      {children}
    </section>
  );
}

const INSTALL = `pip install nedb-engine      # Python ≥ 3.8 — pure-Python + optional Rust native wheel
npm install nedb-engine       # Node ≥ 16   — napi-rs prebuilt binaries`;

const PYTHON = `from nedb import NEDB

db = NEDB("./mydata")   # durable: AOF-logged, fsync'd, hash-chained
# db = NEDB()           # in-memory

db.create_index("users", "status", "eq")
db.create_index("users", "bio",    "search")

db.put("users", "alice", {"name": "Alice", "age": 31, "status": "active", "bio": "rust hacker"})
db.put("users", "bob",   {"name": "Bob",   "age": 24, "status": "active", "bio": "python dev"})

# NQL: WHERE · ORDER BY · LIMIT · SEARCH · TRAVERSE · GROUP BY
db.query('FROM users WHERE status = "active" ORDER BY age ASC')
db.query('FROM users SEARCH "rust"')
db.query('FROM users GROUP BY status COUNT')

# SQL / Redis / MongoDB adapters — same engine underneath
from nedb import sql_exec, RedisCompat, MongoClient
sql_exec(db, "SELECT * FROM users WHERE status = 'active'")
r = RedisCompat(db); r.execute("HSET", "k", "name", "Alice")
MongoClient(db)["users"].find({"status": "active"}).sort("age", -1).to_list()`;

const TIME_TRAVEL = `snap = db.seq                    # capture sequence number
db.put("users", "alice", {"name": "Alice", "age": 32, "status": "retired"})

db.get("users", "alice")["age"]                     # → 32 (current)
db.get("users", "alice", as_of=snap)["age"]         # → 31 (time-travel)

db.query(f'FROM users AS OF {snap} WHERE status = "active"')  # → alice still active`;

const BITEMPORAL = `# valid_from / valid_to — when was this fact true in the world?
db.put("rates", "r_2024", {"pct": 5.0}, valid_from="2024-01-01", valid_to="2024-12-31")
db.put("rates", "r_2025", {"pct": 6.0}, valid_from="2025-01-01")

db.query('FROM rates VALID AS OF "2024-06-15"')   # → 5.0
db.query('FROM rates VALID AS OF "2025-03-01"')   # → 6.0

# Four-dimensional: what did the system know at seq 10 about what was true on 2024-06-15?
db.query('FROM rates AS OF 10 VALID AS OF "2024-06-15"')`;

const CAUSAL = `db.put("inputs", "msg_1", {"text": "I prefer dark mode"})
seq_input = db.seq

db.put("beliefs", "dark_mode", {"value": True},
    caused_by=[seq_input],       # which prior ops caused this write
    evidence="user_message",     # user_message | inference | tool_result | correction
    confidence=0.95)             # 0.0 – 1.0

# Why does the agent believe dark_mode?
db.query('FROM beliefs WHERE _id = "dark_mode" TRACE caused_by')

# What did msg_1 cause downstream?
db.query('FROM inputs WHERE _id = "msg_1" TRACE caused_by REVERSE')

# Query by provenance
db.query('FROM beliefs WHERE _confidence > 0.9')`;

const NODE = `import { NedbCore } from "nedb-engine";

const db = new NedbCore();                     // in-memory
// const db = NedbCore.open("./data");         // durable

db.createIndex("users", "status", "eq");
db.put("users", "u1", JSON.stringify({ name: "Alice", age: 31, status: "active" }));

// Time-travel
const snap = db.seq();
db.put("users", "u1", JSON.stringify({ name: "Alice", age: 32, status: "retired" }));
JSON.parse(db.getAsOf("users", "u1", snap)).age;   // → 31

// NQL — full grammar including VALID AS OF, TRACE, GROUP BY
const rows = db.query('FROM users WHERE status = "active" ORDER BY age ASC');
rows.map(r => JSON.parse(r));

db.verify();   // → true (hash chain intact)
db.head();     // → 64-char BLAKE2b commitment`;

const NQL_GRAMMAR = `FROM <collection>
  [ AS OF <seq> ]                        transaction time (when was it written?)
  [ VALID AS OF "<date>" ]               valid time (when was it true in the world?)
  [ WHERE <field> <op> <val> (AND ...) ] = != < <= > >=
  [ SEARCH "<text>" ]                    full-text across search-indexed fields
  [ ORDER BY <field> [ASC|DESC] ]
  [ TRAVERSE <relation> ]                graph edge traversal
  [ TRACE caused_by [REVERSE] ]          causal chain: backward (why?) or forward (caused what?)
  [ LIMIT <n> ]
  [ GROUP BY <field> [COUNT|SUM f|AVG f|MIN f|MAX f] ]`;

const NEDBD = `nedbd                                   # HTTP :7070, data ./nedb-data
NEDBD_RESP2_PORT=6380 nedbd            # also serve RESP2 (redis-cli compatible)
NEDB_TMK=<32-byte-hex> nedbd           # AES-256-GCM at-rest encryption

# Create database with seed data
curl -X POST localhost:7070/v1/databases -H 'Content-Type: application/json' \\
  -d '{"name":"mydb","init":{"indexes":[["users","status","eq"]]}}'

# Query (full NQL)
curl -X POST localhost:7070/v1/databases/mydb/query \\
  -d '{"nql":"FROM users WHERE status = \\"active\\" ORDER BY age ASC"}'

# MongoDB endpoint
curl -X POST localhost:7070/v1/databases/mydb/mongo \\
  -d '{"collection":"users","op":"find","filter":{"status":"active"}}'

# Verify hash chain
curl localhost:7070/v1/databases/mydb/verify

# From redis-cli — no Redis install required
redis-cli -p 6380 SELECT mydb
redis-cli -p 6380 SELECT mydb EVAL 'FROM users AS OF 5 WHERE status = "active"' 0
redis-cli -p 6380 SELECT mydb EVAL 'FROM beliefs TRACE caused_by' 0`;

const ENV = `AIASSIST_BASE_URL=https://api.aiassist.net
AIASSIST_API_KEY=your_key_here
AIASSIST_DEFAULT_PROVIDER=anthropic
AIASSIST_DEFAULT_MODEL=claude-sonnet-4-6`;

export default function DocsPage(): React.ReactElement {
  return (
    <>
      <Head
        title="NEDB Docs"
        description="Install nedb-engine. Use time-travel, bi-temporal, causal provenance, SQL/Redis/MongoDB adapters, and nedbd server."
      />
      <Nav />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-600">v1.0.4</div>
        <h1 className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Documentation
        </h1>
        <p className="mt-3 text-lg text-slate-300">
          Hash-chained · time-traveling · bi-temporal · causally-provable embedded database.
        </p>

        <Section title="Install">
          <CodeBlock code={INSTALL} />
          <p className="mt-2 text-sm text-slate-500">
            Native Rust wheels (maturin/PyO3 for PyPI, napi-rs for npm) with pure-Python fallback on every platform.
          </p>
        </Section>

        <Section title="Python — quick start">
          <CodeBlock code={PYTHON} />
        </Section>

        <Section
          title="Time-travel — AS OF seq"
          sub="Every write has a sequence number. Read the database at any past sequence. The hash chain proves nothing was changed."
        >
          <CodeBlock code={TIME_TRAVEL} />
        </Section>

        <Section
          title="Bi-temporal — VALID AS OF date"
          sub="Two independent time axes: transaction time (when was it written?) and valid time (when was it true in the world?). Combine both for the four-dimensional question."
        >
          <CodeBlock code={BITEMPORAL} />
        </Section>

        <Section
          title="Causal Write Provenance"
          sub="Every write can declare why it happened. Sealed in the hash chain at write time. Query the causal graph backward (why?) and forward (what followed?). The first embedded database that answers: 'Why does the agent believe X?'"
        >
          <CodeBlock code={CAUSAL} />
        </Section>

        <Section title="Node.js">
          <CodeBlock code={NODE} />
        </Section>

        <Section title="NQL grammar">
          <CodeBlock code={NQL_GRAMMAR} />
        </Section>

        <Section
          title="nedbd — concurrent server daemon"
          sub="HTTP/JSON + optional RESP2 (redis-cli compatible). Single-writer group-commit sequencer: parallel reads, batched durable writes, one hash-chain per database."
        >
          <CodeBlock code={NEDBD} />
        </Section>

        <Section
          title="Connect AiAssist (AI gateway)"
          sub="Schema generation routes through AiAssist — your provider, your model, your key. Server-side only; the key never reaches the browser."
        >
          <CodeBlock code={ENV} />
        </Section>

        <Section title="Mock mode">
          <p className="text-sm leading-relaxed text-slate-400">
            With no AiAssist credentials the studio runs on deterministic templates — Contractor CRM,
            Salon booking, AI agent memory store, Marketplace backend. Every feature works offline:
            schema graph, time-travel queries, causal provenance panel, Mongo/SQL/Redis tabs, and export.
            Add credentials to generate from any prompt.
          </p>
        </Section>

        <div className="mt-14 flex flex-wrap gap-3">
          <Link href="/studio" className="btn-primary">Open the Studio →</Link>
          <a href="https://github.com/Eth-Interchained/nedb" target="_blank" rel="noopener noreferrer" className="btn-ghost">GitHub →</a>
          <a href="https://www.npmjs.com/package/nedb-engine" target="_blank" rel="noopener noreferrer" className="btn-ghost">npm →</a>
          <a href="https://pypi.org/project/nedb-engine/" target="_blank" rel="noopener noreferrer" className="btn-ghost">PyPI →</a>
        </div>

        <p className="mt-10 text-[11px] text-slate-700">
          NEDB · © INTERCHAINED, LLC · Apache-2.0 (engine) · GPLv3 (studio) · Built with Claude Sonnet 4.6
        </p>
      </main>
    </>
  );
}
