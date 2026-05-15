const MAX_LEN = 2048;

/**
 * Allows only same-origin relative navigations (path + optional query),
 * avoiding open redirects like `//evil.com`.
 */
export function sanitizeInternalPath(raw: string | undefined): string {
  if (typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  if (trimmed.includes("\n") || trimmed.includes("\r")) return "/";
  if (trimmed.length > MAX_LEN) return "/";
  return trimmed;
}
