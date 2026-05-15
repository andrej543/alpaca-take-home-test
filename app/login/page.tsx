import type { Metadata } from "next";
import { sanitizeInternalPath } from "@/lib/sanitize-internal-path";

export const metadata: Metadata = {
  title: "Sign in · Alpaca take-home",
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{ from?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const sp = await searchParams;
  const from = sanitizeInternalPath(sp.from);
  const showError = sp.error === "1";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "26rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "1.75rem",
          boxShadow: "0 18px 50px rgba(26, 26, 26, 0.06)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--serif)",
            fontSize: "1.45rem",
            fontWeight: 520,
            margin: "0 0 0.35rem",
            letterSpacing: "-0.02em",
          }}
        >
          This site is private
        </h1>
        <p
          style={{
            margin: "0 0 1.25rem",
            color: "var(--ink-2)",
            fontSize: "0.95rem",
            lineHeight: 1.55,
          }}
        >
          Enter the password to continue.
        </p>

        {showError ? (
          <p
            role="alert"
            style={{
              margin: "0 0 1rem",
              padding: "0.65rem 0.75rem",
              borderRadius: "8px",
              background: "var(--warn-soft)",
              color: "var(--warn)",
              fontSize: "0.9rem",
            }}
          >
            That password is not correct. Try again.
          </p>
        ) : null}

        <form
          action="/api/auth/login"
          method="post"
          style={{ display: "grid", gap: "0.85rem" }}
        >
          <input type="hidden" name="redirect" value={from} />
          <label
            htmlFor="password"
            style={{
              display: "grid",
              gap: "0.35rem",
              fontSize: "0.85rem",
              color: "var(--ink-2)",
            }}
          >
            Password
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "0.65rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid var(--border-strong)",
                background: "var(--surface-muted)",
                fontFamily: "var(--mono)",
                fontSize: "0.9rem",
              }}
            />
          </label>
          <button
            type="submit"
            style={{
              marginTop: "0.25rem",
              padding: "0.7rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid color-mix(in srgb, var(--accent) 55%, black)",
              background: "var(--accent)",
              color: "#f6fffb",
              fontFamily: "var(--sans)",
              fontSize: "0.95rem",
              fontWeight: 560,
              letterSpacing: "-0.01em",
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
