import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "pm.sqlite");

const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|pragma|vacuum|replace|truncate|detach)\b/i;

export type SafeQueryResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; error: string };

function sanitizeSelect(raw: string): { ok: true; sql: string } | { ok: false; error: string } {
  let s = raw.trim().replace(/;+\s*$/u, "");
  if (!/^\s*select\b/i.test(s)) {
    return { ok: false, error: "Only a single SELECT statement is allowed." };
  }
  if (s.includes(";")) {
    return { ok: false, error: "Multiple statements are not allowed." };
  }
  if (FORBIDDEN.test(s)) {
    return { ok: false, error: "Query contains forbidden keywords." };
  }
  if (!/\blimit\b/i.test(s)) {
    s = `${s} LIMIT 500`;
  } else {
    const lim = s.match(/\blimit\s+(\d+)/i);
    const n = lim ? Number(lim[1]) : 500;
    if (!Number.isFinite(n) || n > 500) {
      return { ok: false, error: "LIMIT must be present and at most 500." };
    }
  }
  return { ok: true, sql: s };
}

function redactRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy = { ...row };
    if ("account_id" in copy) copy.account_id = "[redacted]";
    if ("date_of_birth" in copy) copy.date_of_birth = "[redacted]";
    return copy;
  });
}

let dbSingleton: Database.Database | null = null;

function getDb(): Database.Database | null {
  try {
    if (!dbSingleton) {
      dbSingleton = new Database(DB_PATH, {
        readonly: true,
        fileMustExist: true,
      });
    }
    return dbSingleton;
  } catch {
    return null;
  }
}

export function runPmSelect(sqlRaw: string): SafeQueryResult {
  const sanitized = sanitizeSelect(sqlRaw);
  if (!sanitized.ok) return sanitized;

  const db = getDb();
  if (!db) {
    return {
      ok: false,
      error: "SQLite database not found — run ingest:data during build.",
    };
  }

  try {
    const stmt = db.prepare(sanitized.sql);
    const rows = stmt.all() as Record<string, unknown>[];
    return {
      ok: true,
      rows: redactRows(rows.slice(0, 500)),
      rowCount: rows.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
