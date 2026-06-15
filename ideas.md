# NEDB Maintainer — Ideas for Next Turn

*Updated: 2026-06-14 · by NEDB Maintainer agent*

---

## Idea 1 — Files API proxy in Studio (Gap: engine has it, studio doesn't)

**What:** Expose nedbd's file storage API (`POST /databases/<name>/files`, `GET /databases/<name>/files/<filename>`, `GET .../files/<filename>/root`) through the Studio Express server and add a Files tab in the Databases page.

**Why:** The engine ships a complete versioned file store with Cascade compression and per-version Merkle roots — it's one of NEDB's most distinctive capabilities. Studio users have no way to upload, retrieve, or verify files without hitting the nedbd API directly. The `/root` endpoint returns an anchorable Merkle proof, which is the bridge to on-chain anchoring (ITC/BSC). Surfacing this in the UI makes that capability discoverable.

---

## Idea 2 — Browser-side NQL GROUP BY support (Gap: engine supports it, Studio mock doesn't)

**What:** Extend `src/lib/nql.ts`'s `parseNql` and `executeNql` functions to handle `GROUP BY <field> [COUNT|SUM|AVG|MIN|MAX]`. The keywords are already in the lexer's `KEYWORDS` set; only the parse + execute logic is missing.

**Why:** Any user who writes `FROM users GROUP BY status COUNT` against a scaffold's seed data in mock mode gets an "unexpected trailing input" parse error — even though the live engine handles it fine. This breaks the Studio demo experience for a common analytics pattern and creates a frustrating mismatch between mock and live behavior.

---

## Idea 3 — Checkpoint button + backfill missing studio git tags v0.4–v0.6

**What (part A):** Add a "Checkpoint" button to the Databases page that calls `POST /databases/<name>/checkpoint` via a new studio route. Show a toast with the returned `head` hash.

**What (part B):** Backfill missing git tags `v0.4.0` through `v0.6.1` on `Eth-Interchained/nedb-studio` — the current tags only go to `v0.3.7` even though the code is at `v0.6.1`.

**Why:** Checkpoints let nedbd restart in O(delta) time rather than replaying the full AOF log — users running large databases benefit immediately. The tag gap means there's no reliable way to `git checkout v0.5.0` or see a GitHub releases page for Studio, making the project look unmaintained to anyone browsing the repo.
