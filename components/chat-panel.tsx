"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIMessage,
  isTextUIPart,
} from "ai";
import { useRef, useState, FormEvent, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContextMode } from "@/lib/context-mode";

function isQueryPmDataPending(messages: UIMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts ?? []) {
      if (p.type === "tool-query_pm_data") {
        const st = (p as { state?: string }).state;
        if (
          st &&
          st !== "output-available" &&
          st !== "output-error" &&
          st !== "output-denied"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function MarkdownBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={`markdown-body${streaming ? " streaming" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ToolCallCard({ part }: { part: UIMessage["parts"][number] }) {
  if (!part.type.startsWith("tool-")) return null;
  const name = part.type.slice("tool-".length);
  const toolPart = part as {
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };

  let body = "";
  try {
    if (toolPart.state === "output-available" && toolPart.output !== undefined) {
      body = JSON.stringify(toolPart.output, null, 2);
    } else if (toolPart.state === "output-error") {
      body = toolPart.errorText ?? "Tool error";
    } else if (
      toolPart.state === "input-available" ||
      toolPart.state === "input-streaming"
    ) {
      body =
        typeof toolPart.input === "object"
          ? JSON.stringify(toolPart.input, null, 2)
          : String(toolPart.input ?? "");
    } else {
      body = toolPart.state;
    }
  } catch {
    body = "(could not render tool output)";
  }

  return (
    <details className="tool-card">
      <summary>
        Tool · <span className="tool-name">{name}</span>
        <span className="tool-state">{toolPart.state}</span>
      </summary>
      <pre className="tool-pre">{body}</pre>
    </details>
  );
}

function MessageView({ message }: { message: UIMessage }) {
  const parts = message.parts ?? [];

  if (message.role === "user") {
    const text = parts.filter(isTextUIPart).map((p) => p.text).join("\n\n");
    return (
      <div className="msg-row user">
        <div className="bubble user-bubble">{text}</div>
      </div>
    );
  }

  return (
    <div className="msg-row assistant">
      <div className="bubble assistant-bubble">
        {parts.map((part, idx) => {
          if (isTextUIPart(part)) {
            return (
              <MarkdownBlock
                key={`${message.id}-t-${idx}`}
                text={part.text}
                streaming={part.state === "streaming"}
              />
            );
          }
          if (part.type.startsWith("tool-")) {
            return <ToolCallCard key={`${message.id}-${idx}`} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

export function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const [input, setInput] = useState("");
  const [contextMode, setContextMode] = useState<ContextMode>("both");
  const modeRef = useRef<ContextMode>("both");
  modeRef.current = contextMode;

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ contextMode: modeRef.current }),
    }),
  });

  const busy = status === "streaming" || status === "submitted";

  const analyzingFullDataset = useMemo(
    () => busy && isQueryPmDataPending(messages),
    [busy, messages],
  );

  async function submitComposer() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    await sendMessage({ text: t });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submitComposer();
  }

  return (
    <div className={`chat-shell${embedded ? " chat-shell--embedded" : ""}`}>
      <header className="chat-header">
        <div>
          <h1 className="chat-title">Chat with the data</h1>
          <p className="chat-sub">
            Ask about the website analysis, the PM data doc, or both.
          </p>
        </div>
        {embedded ? null : (
          <a className="chat-report-link" href="/alpaca-b2c-analysis.html">
            Back to report
          </a>
        )}
      </header>

      <section className="chat-controls" aria-label="Context sources">
        <span className="controls-label">Use context:</span>
        <div className="segmented">
          {(
            [
              ["website", "Website only"],
              ["data", "PM data only"],
              ["both", "Both"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`segment-btn${contextMode === value ? " active" : ""}`}
              onClick={() => setContextMode(value)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div className="chat-error" role="alert">
          {error.message}
        </div>
      ) : null}

      {analyzingFullDataset ? (
        <div className="dataset-analyzing-banner" role="status" aria-live="polite">
          <strong>Analyzing the full PM dataset</strong>
          <span>
            Running SQL over the complete SQLite extract (hundreds of thousands of rows). This can
            take up to a few minutes — results will appear below when ready.
          </span>
        </div>
      ) : null}

      <div className="messages-scroll">
        <div className="messages-inner">
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
          {busy ? (
            <div className="msg-row assistant">
              <div className="bubble assistant-bubble typing">
                Thinking…
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="composer-wrap">
        <form className="composer" onSubmit={(e) => void onSubmit(e)}>
          <textarea
            className="composer-input"
            placeholder="Ask a question…"
            rows={3}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitComposer();
              }
            }}
          />
          <div className="composer-actions">
            {busy ? (
              <button type="button" className="btn ghost" onClick={() => void stop()}>
                Stop
              </button>
            ) : null}
            <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}
