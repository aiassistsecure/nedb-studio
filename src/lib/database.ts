import type { NEDBScaffold } from "./types";
import { SAMPLE_DATABASES, type SampleDatabase } from "./mock";

/**
 * The "active database" handoff. Studio generates a scaffold (= a database:
 * schema + seed data); we persist it so the standalone Query console can pick it
 * up and run NQL against it — phpMyAdmin-style. Sample databases (curated
 * templates) are offered alongside it. Nothing here is a mock: it's real data.
 */

export { SAMPLE_DATABASES };
export type { SampleDatabase };

const ACTIVE_KEY = "nedb-studio:active-database";

/** Persist the database generated in Studio so /query can open it. */
export function saveActiveDatabase(scaffold: NEDBScaffold): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(scaffold));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Load the database handed off from Studio, if any. */
export function loadActiveDatabase(): NEDBScaffold | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as NEDBScaffold) : null;
  } catch {
    return null;
  }
}

/** Forget the handed-off database. */
export function clearActiveDatabase(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* noop */
  }
}
