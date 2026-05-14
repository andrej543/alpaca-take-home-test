import { readFileSync, existsSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

export type DataSummaryFile = {
  available: boolean;
  rowCount?: number;
  columns?: string[];
  tableName?: string;
  tradeMonthRange?: { min: string | null; max: string | null };
  topCountries?: { code: string; count: number }[];
  numericSummaries?: Record<
    string,
    { sum: number; mean: number; nullCount: number; nonNullCount: number }
  >;
  message?: string;
};

export function loadWebsiteText(): string {
  const p = path.join(DATA_DIR, "website-content.txt");
  if (!existsSync(p)) {
    return "[Website context unavailable — run npm run extract:website]";
  }
  return readFileSync(p, "utf8");
}

export type DataFaqFile = {
  generated: boolean;
  generatedAt?: string;
  items: Array<{
    id: string;
    question: string;
    answer: string;
    matchHints: string[];
  }>;
};

export function loadDataFaq(): DataFaqFile {
  const p = path.join(DATA_DIR, "data-faq.json");
  if (!existsSync(p)) {
    return { generated: false, items: [] };
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DataFaqFile;
  } catch {
    return { generated: false, items: [] };
  }
}

export function loadDataSummary(): DataSummaryFile {
  const p = path.join(DATA_DIR, "data-summary.json");
  if (!existsSync(p)) {
    return {
      available: false,
      tableName: "pm_revenue",
      message:
        "Data summary missing — run npm run ingest:data with PM_DATA_CSV pointing at the CSV.",
    };
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DataSummaryFile;
  } catch {
    return {
      available: false,
      tableName: "pm_revenue",
      message: "Could not parse data-summary.json",
    };
  }
}
