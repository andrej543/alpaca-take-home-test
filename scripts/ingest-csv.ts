import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { parse } from "csv-parse";
import Database from "better-sqlite3";

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "pm.sqlite");
const SUMMARY_PATH = path.join(DATA_DIR, "data-summary.json");

/** Committed source CSV (build-only; kept outside `data/` so Next tracing does not bundle it into API routes). */
const DEFAULT_CSV = path.join(ROOT, "source-data", "pm-interview-query-result.csv");

type Summary = {
  available: boolean;
  rowCount?: number;
  columns?: string[];
  tableName: string;
  tradeMonthRange?: { min: string | null; max: string | null };
  topCountries?: { code: string; count: number }[];
  numericSummaries?: Record<
    string,
    { sum: number; mean: number; nullCount: number; nonNullCount: number }
  >;
  message?: string;
};

function uniqueColumnNames(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const base = h.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
    const key = base.toLowerCase() || "col";
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const csvPath = process.env.PM_DATA_CSV?.trim() || DEFAULT_CSV;

  if (!existsSync(csvPath)) {
    const summary: Summary = {
      available: false,
      tableName: "pm_revenue",
      message: `CSV not found at ${csvPath}. Set PM_DATA_CSV or add source-data/pm-interview-query-result.csv.`,
    };
    writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
    console.warn(summary.message);
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    return;
  }

  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: (header: string[]) => uniqueColumnNames(header),
      relax_column_count: true,
      trim: true,
    }),
  );

  let db: Database.Database | null = null;
  let insertStmt: Database.Statement | null = null;
  let orderedHeaders: string[] = [];

  let rowCount = 0;
  const countryCounts = new Map<string, number>();
  let tradeMin: string | null = null;
  let tradeMax: string | null = null;

  let numericHeaders: string[] = [];

  const numericAgg: Record<string, { sum: number; nulls: number; n: number }> = {};

  const BATCH = 4000;
  type Row = Record<string, string>;
  let batch: Row[] = [];

  function flush() {
    if (!batch.length || !insertStmt) return;
    const tx = db!.transaction((rows: Row[]) => {
      for (const r of rows) {
        const vals = orderedHeaders.map((h) => {
          const v = r[h];
          return v === undefined || v === "" ? null : v;
        });
        insertStmt!.run(...vals);
      }
    });
    tx(batch);
    batch = [];
  }

  for await (const record of parser as AsyncIterable<Row>) {
    if (!db) {
      orderedHeaders = Object.keys(record);

      db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");

      const defs = orderedHeaders.map((c) => `${qIdent(c)} TEXT`).join(", ");
      db.exec(`CREATE TABLE pm_revenue (${defs})`);

      for (const idxCol of ["trade_month", "country_of_tax_residence"]) {
        if (orderedHeaders.includes(idxCol)) {
          db.exec(`CREATE INDEX idx_pm_${idxCol} ON pm_revenue (${qIdent(idxCol)})`);
        }
      }

      numericHeaders = orderedHeaders.filter(
        (h) =>
          /revenue|interest/i.test(h) &&
          !/date|month|country|account|birth|legal|entity/i.test(h),
      );
      for (const h of numericHeaders) {
        numericAgg[h] = { sum: 0, nulls: 0, n: 0 };
      }

      const placeholders = orderedHeaders.map(() => "?").join(", ");
      insertStmt = db.prepare(
        `INSERT INTO pm_revenue (${orderedHeaders.map(qIdent).join(", ")}) VALUES (${placeholders})`,
      );
    }

    rowCount++;

    const tm = record.trade_month;
    if (tm) {
      const s = String(tm);
      if (!tradeMin || s < tradeMin) tradeMin = s;
      if (!tradeMax || s > tradeMax) tradeMax = s;
    }
    const co = record.country_of_tax_residence;
    if (co) countryCounts.set(co, (countryCounts.get(co) ?? 0) + 1);

    for (const h of numericHeaders) {
      const raw = record[h];
      if (raw === undefined || raw === null || raw === "") {
        numericAgg[h].nulls++;
        continue;
      }
      const num = Number(String(raw).replace(/,/g, ""));
      if (Number.isFinite(num)) {
        numericAgg[h].sum += num;
        numericAgg[h].n++;
      } else {
        numericAgg[h].nulls++;
      }
    }

    batch.push(record);
    if (batch.length >= BATCH) flush();
  }

  flush();

  if (db) {
    db.exec("ANALYZE");
    db.close();
  }

  const topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([code, count]) => ({ code, count }));

  const numericSummaries: Summary["numericSummaries"] = {};
  for (const [k, v] of Object.entries(numericAgg)) {
    numericSummaries[k] = {
      sum: v.sum,
      mean: v.n ? v.sum / v.n : 0,
      nullCount: v.nulls,
      nonNullCount: v.n,
    };
  }

  const summary: Summary = {
    available: true,
    rowCount,
    columns: orderedHeaders,
    tableName: "pm_revenue",
    tradeMonthRange: { min: tradeMin, max: tradeMax },
    topCountries,
    numericSummaries,
  };

  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${DB_PATH} and ${SUMMARY_PATH} (${rowCount} rows)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
