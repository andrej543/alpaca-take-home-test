export type ContextMode = "website" | "data" | "both";

export function parseContextMode(value: unknown): ContextMode {
  if (value === "website" || value === "data" || value === "both") return value;
  return "both";
}
