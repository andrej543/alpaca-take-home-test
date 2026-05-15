import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SITE_SESSION_COOKIE,
  SITE_SESSION_TTL_SECONDS,
  createSessionToken,
  getSitePassword,
} from "@/lib/site-auth-cookie";
import { sanitizeInternalPath } from "@/lib/sanitize-internal-path";

/** Browsers ignore `Secure` cookies on plain HTTP; `next start` uses NODE_ENV=production on http://localhost. */
function isRequestHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first === "https";
  }
  return request.nextUrl.protocol === "https:";
}

function passwordsMatch(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Chat is embedded on the B2C report; signing in from `/chat` (e.g. iframe auth)
 * should land on the main report, not the standalone chat route.
 */
function normalizePostLoginRedirect(sanitizedRelative: string): string {
  const q = sanitizedRelative.indexOf("?");
  const path = q === -1 ? sanitizedRelative : sanitizedRelative.slice(0, q);
  if (path === "/chat") return "/";
  return sanitizedRelative;
}

export async function POST(request: NextRequest) {
  const expected = getSitePassword();
  const contentType = request.headers.get("content-type") ?? "";

  let password = "";
  let redirect = "/";

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (body && typeof body === "object") {
      const o = body as Record<string, unknown>;
      password = typeof o.password === "string" ? o.password : "";
      redirect = typeof o.redirect === "string" ? o.redirect : "/";
    }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    password = String(form.get("password") ?? "");
    redirect = String(form.get("redirect") ?? "/");
  } else if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    password = String(form.get("password") ?? "");
    redirect = String(form.get("redirect") ?? "/");
  } else {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const safeRedirect = sanitizeInternalPath(redirect);

  if (!passwordsMatch(password, expected)) {
    const fail = new URL("/login", request.url);
    fail.searchParams.set("error", "1");
    fail.searchParams.set("from", safeRedirect);
    // 303 so the browser follows with GET. NextResponse.redirect defaults to 307,
    // which replays POST on `/` and breaks HTML form login (blank / 405).
    return NextResponse.redirect(fail, 303);
  }

  const token = await createSessionToken(expected);
  const landing = normalizePostLoginRedirect(safeRedirect);
  const destination = new URL(landing, request.url);
  const res = NextResponse.redirect(destination, 303);
  res.cookies.set(SITE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isRequestHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: SITE_SESSION_TTL_SECONDS,
  });
  return res;
}
