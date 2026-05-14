import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  zodSchema,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { parseContextMode } from "@/lib/context-mode";
import { loadDataFaq, loadDataSummary, loadWebsiteText } from "@/lib/load-prompt-context";
import { runPmSelect } from "@/lib/pm-query";

export const runtime = "nodejs";
export const maxDuration = 300;

function buildSystemPrompt(mode: ReturnType<typeof parseContextMode>): string {
  const website = loadWebsiteText();
  const summary = loadDataSummary();
  const faq = loadDataFaq();

  const chunks: string[] = [
    "You are an analyst assistant for an Alpaca PM take-home.",
    "Respond in Markdown (short headings, bullets where helpful).",
    "When both website narrative and SQL results apply, briefly say which source supports each factual claim.",
  ];

  if (mode !== "data") {
    chunks.push(
      "## Website narrative (extracted from the published analysis page)\n\n" + website,
    );
  }

  if (mode !== "website") {
    if (faq.generated && faq.items.length) {
      const faqBlock = faq.items
        .map(
          (it) =>
            `### ${it.question}\n**Precomputed answer (full-table scan at build time):**\n${it.answer}\n*Match hints:* ${it.matchHints.join(", ")}`,
        )
        .join("\n\n---\n\n");
      chunks.push(
        "## Precomputed FAQ (answer from here when the user question clearly matches)\n\n" +
          "Prefer quoting or paraphrasing these answers when the user's intent matches. For novel or highly specific questions, use `query_pm_data`.\n\n" +
          faqBlock,
      );
    }

    chunks.push(
      "## PM revenue dataset summary (JSON)\n\n```json\n" +
        JSON.stringify(summary, null, 2).slice(0, 35_000) +
        "\n```",
    );
    chunks.push(
      "## How SQL row limits work (important)",
      "The `query_pm_data` tool caps **how many result rows** are returned (max 500). It does **not** mean \"only the first 500 rows of the CSV were scanned\".",
      "Queries like `SELECT SUM(...)`, `COUNT(*)`, `GROUP BY` with aggregates scan **all** matching rows in SQLite; the limit applies to the final rowset (e.g. detail rows returned).",
      "For large raw extracts, use `ORDER BY`, `GROUP BY`, and aggregates instead of `SELECT *` without filters.",
      `The full detail table is \`${summary.tableName ?? "pm_revenue"}\` in SQLite (built from the full source CSV at deploy time). All columns are stored as TEXT — cast revenue columns with CAST(col AS REAL) before SUM/AVG. Text dates/months compare lexicographically only when formats align; prefer grouping/filtering on trade_month as stored.`,
      "When you call `query_pm_data` for a non-trivial exploration, the UI shows that the full dataset is being queried and may take up to a few minutes — keep the user informed in your reply after results return.",
    );
    if (!summary.available) {
      chunks.push(
        "The SQLite extract is missing or unavailable in this environment — explain that limitation clearly and rely on website narrative only.",
      );
    }
  }

  return chunks.join("\n\n");
}

function truncateToolPayload(rows: Record<string, unknown>[], rowCount: number) {
  let slice = rows;
  const maxChars = 95_000;
  while (JSON.stringify({ rows: slice, rowCount }).length > maxChars && slice.length > 3) {
    slice = slice.slice(0, Math.max(3, Math.floor(slice.length * 0.65)));
  }
  return {
    rows: slice,
    rowCount,
    truncated: slice.length < rows.length,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY on the server." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawMessages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body as { messages: unknown }).messages
      : undefined;

  if (!Array.isArray(rawMessages)) {
    return Response.json({ error: "Expected messages array." }, { status: 400 });
  }

  const contextMode = parseContextMode(
    typeof body === "object" && body !== null && "contextMode" in body
      ? (body as { contextMode?: unknown }).contextMode
      : undefined,
  );

  const validated = await safeValidateUIMessages({
    messages: rawMessages,
  });
  if (!validated.success) {
    return Response.json(
      { error: validated.error.message || "Invalid chat messages payload." },
      { status: 400 },
    );
  }
  const uiMessages: UIMessage[] = validated.data;

  const summary = loadDataSummary();
  const cols = summary.columns?.join(", ") ?? "see summary JSON";

  const queryPmTool = tool({
    description: `Run one read-only SQLite SELECT against pm_revenue (full ~500k-row table on disk). Columns: ${cols}. At most 500 **result rows** returned; aggregates still scan the whole table. Cast numeric TEXT columns with CAST(col AS REAL) before SUM/AVG.`,
    inputSchema: zodSchema(
      z.object({
        sql: z
          .string()
          .describe(
            "Single SELECT against pm_revenue. LIMIT caps returned rows (max 500), not table scan — use aggregates for full-dataset metrics.",
          ),
      }),
    ),
    execute: async ({ sql }) => {
      const result = runPmSelect(sql);
      if (!result.ok) return { error: result.error };
      return truncateToolPayload(result.rows, result.rowCount);
    },
  });

  const toolsEnabled =
    contextMode !== "website" && summary.available ? { query_pm_data: queryPmTool } : undefined;

  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    modelMessages = await convertToModelMessages(uiMessages, {
      tools: toolsEnabled,
    });
  } catch {
    return Response.json({ error: "Could not convert messages for the model." }, { status: 400 });
  }

  const modelId = process.env.OPENAI_MODEL?.trim() || "gpt-5.5";

  const result = streamText({
    model: openai(modelId),
    system: buildSystemPrompt(contextMode),
    messages: modelMessages,
    ...(toolsEnabled
      ? {
          tools: toolsEnabled,
          activeTools: ["query_pm_data"] as const,
        }
      : {}),
    stopWhen: stepCountIs(14),
  });

  return result.toUIMessageStreamResponse();
}
