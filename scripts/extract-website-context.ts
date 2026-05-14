import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "public", "alpaca-b2c-analysis.html");
const OUT_DIR = path.join(ROOT, "data");
const OUTPUT = path.join(OUT_DIR, "website-content.txt");

const MAX_CHARS = 120_000;

function htmlToPlainText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const html = readFileSync(INPUT, "utf8");
  let text = htmlToPlainText(html);
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      "\n\n[Truncated for prompt size — full page lives at /alpaca-b2c-analysis.html]";
  }
  writeFileSync(OUTPUT, text, "utf8");
  console.log(`Wrote ${OUTPUT} (${text.length} chars)`);
}

main();
