/**
 * Runs analytical SQL over the full pm.sqlite (post-ingest) and writes data-faq.json
 * so the model can answer common questions without extra round-trips.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import Database from "better-sqlite3";

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "pm.sqlite");
const SUMMARY_PATH = path.join(DATA_DIR, "data-summary.json");
const FAQ_PATH = path.join(DATA_DIR, "data-faq.json");

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  matchHints: string[];
};

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function revenueColumns(colNames: string[]): string[] {
  return colNames.filter(
    (c) =>
      /revenue|interest/i.test(c) &&
      !/date|month|country|account|birth|legal|entity|tax|residence/i.test(c),
  );
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.warn("generate-data-faq: pm.sqlite missing, skipping FAQ.");
    writeFileSync(
      FAQ_PATH,
      JSON.stringify({ generated: false, items: [] as FaqItem[] }, null, 2),
    );
    return;
  }

  const summary = existsSync(SUMMARY_PATH)
    ? (JSON.parse(readFileSync(SUMMARY_PATH, "utf8")) as { columns?: string[] })
    : {};

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const info = db.prepare("PRAGMA table_info(pm_revenue)").all() as { name: string }[];
  const colNames = info.map((r) => r.name);
  const revCols = revenueColumns(colNames.length ? colNames : summary.columns ?? []);

  const items: FaqItem[] = [];

  const rowCount = (
    db.prepare("SELECT COUNT(*) AS n FROM pm_revenue").get() as { n: number }
  ).n;
  items.push({
    id: "row-count",
    question: "How many rows (account-months) are in the PM revenue dataset?",
    answer: `There are **${rowCount.toLocaleString()}** rows in \`pm_revenue\` (each row is one account in one \`trade_month\`).`,
    matchHints: ["how many rows", "row count", "number of rows", "account-month", "506"],
  });

  if (colNames.includes("account_id")) {
    const n = (
      db.prepare("SELECT COUNT(DISTINCT account_id) AS n FROM pm_revenue").get() as {
        n: number;
      }
    ).n;
    items.push({
      id: "unique-accounts",
      question: "How many unique accounts appear in the data?",
      answer: `There are **${n.toLocaleString()}** distinct \`account_id\` values (PII is redacted in tool outputs).`,
      matchHints: ["unique accounts", "how many accounts", "distinct accounts", "customers"],
    });
  }

  if (colNames.includes("trade_month")) {
    const r = db
      .prepare(
        `SELECT MIN(${qIdent("trade_month")}) AS mn, MAX(${qIdent("trade_month")}) AS mx FROM pm_revenue`,
      )
      .get() as { mn: string | null; mx: string | null };
    items.push({
      id: "trade-month-range",
      question: "What trade_month range does the dataset cover?",
      answer: `Trade months span from **${r.mn ?? "n/a"}** through **${r.mx ?? "n/a"}** (stored as text in the extract).`,
      matchHints: ["date range", "time range", "which months", "trade month", "period"],
    });
  }

  if (colNames.includes("country_of_tax_residence")) {
    const rows = db
      .prepare(
        `SELECT ${qIdent("country_of_tax_residence")} AS country, COUNT(*) AS cnt
         FROM pm_revenue
         GROUP BY 1 ORDER BY cnt DESC LIMIT 10`,
      )
      .all() as { country: string; cnt: number }[];
    const lines = rows.map((x) => `- **${x.country}**: ${x.cnt.toLocaleString()} account-months`);
    items.push({
      id: "top-countries",
      question: "Which countries have the most account-month rows?",
      answer: `Top 10 by row count:\n\n${lines.join("\n")}`,
      matchHints: ["top countries", "country breakdown", "USA vs", "geography", "where"],
    });
  }

  if (colNames.includes("is_legal_entity")) {
    const rows = db
      .prepare(
        `SELECT ${qIdent("is_legal_entity")} AS v, COUNT(*) AS cnt FROM pm_revenue GROUP BY 1`,
      )
      .all() as { v: string; cnt: number }[];
    items.push({
      id: "legal-entity",
      question: "How many rows are legal entities vs individuals?",
      answer: rows.map((x) => `- **is_legal_entity = ${x.v}**: ${x.cnt.toLocaleString()} rows`).join("\n"),
      matchHints: ["legal entity", "individual", "retail vs", "entity"],
    });
  }

  if (revCols.length) {
    const sumParts = revCols.map(
      (c) => `COALESCE(CAST(${qIdent(c)} AS REAL), 0)`,
    );
    const totalExpr = sumParts.join(" + ");
    const total = (
      db.prepare(`SELECT SUM(${totalExpr}) AS t FROM pm_revenue`).get() as { t: number | null }
    ).t;
    items.push({
      id: "total-revenue-all-streams",
      question: "What is the approximate total revenue summed across all revenue columns and all rows?",
      answer: `Summing every revenue stream on every row gives **${(total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}** (currency units as in source; columns are summed per row then across all rows). Use SQL for a precise slice (e.g. by month or country).`,
      matchHints: ["total revenue", "sum of revenue", "overall revenue", "how much revenue"],
    });

    const perStream = revCols.map((c) => {
      const s = (
        db
          .prepare(`SELECT SUM(CAST(${qIdent(c)} AS REAL)) AS s FROM pm_revenue`)
          .get() as { s: number | null }
      ).s;
      return { c, s: s ?? 0 };
    });
    perStream.sort((a, b) => b.s - a.s);
    const table = perStream
      .map((x) => `| \`${x.c}\` | ${x.s.toLocaleString(undefined, { maximumFractionDigits: 2 })} |`)
      .join("\n");
    items.push({
      id: "revenue-by-stream",
      question: "What are the totals for each revenue column across the full dataset?",
      answer: `Totals (SUM over all rows; full table scan at build time):\n\n| Column | Sum |\n| --- | --- |\n${table}`,
      matchHints: [
        "revenue by stream",
        "pfof",
        "margin interest",
        "cash interest",
        "each column",
        "breakdown by revenue",
      ],
    });
  }

  if (revCols.length && colNames.includes("trade_month")) {
    const sumExpr = revCols.map((c) => `COALESCE(CAST(${qIdent(c)} AS REAL), 0)`).join(" + ");
    const rows = db
      .prepare(
        `SELECT ${qIdent("trade_month")} AS tm, SUM(${sumExpr}) AS rev
         FROM pm_revenue GROUP BY 1 ORDER BY rev DESC LIMIT 8`,
      )
      .all() as { tm: string; rev: number }[];
    items.push({
      id: "top-months-revenue",
      question: "Which trade_months have the highest combined revenue across streams?",
      answer:
        `Top months by summed streams:\n\n` +
        rows.map((x) => `- **${x.tm}**: ${x.rev.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join("\n"),
      matchHints: ["best month", "highest month", "by month", "seasonality", "trend month"],
    });
  }

  if (colNames.includes("country_of_tax_residence") && revCols.length) {
    const sumExpr = revCols.map((c) => `COALESCE(CAST(${qIdent(c)} AS REAL), 0)`).join(" + ");
    const rows = db
      .prepare(
        `SELECT ${qIdent("country_of_tax_residence")} AS co, SUM(${sumExpr}) AS rev
         FROM pm_revenue GROUP BY 1 ORDER BY rev DESC LIMIT 8`,
      )
      .all() as { co: string; rev: number }[];
    items.push({
      id: "top-countries-revenue",
      question: "Which countries have the highest combined revenue (all streams)?",
      answer: rows.map((x) => `- **${x.co}**: ${x.rev.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join("\n"),
      matchHints: ["revenue by country", "which country earns", "USA revenue"],
    });
  }

  db.close();

  const payload = {
    generated: true,
    generatedAt: new Date().toISOString(),
    items,
  };
  writeFileSync(FAQ_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${FAQ_PATH} (${items.length} FAQ items)`);
}

main();
