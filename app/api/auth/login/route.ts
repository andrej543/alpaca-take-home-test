import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SITE_SESSION_COOKIE,
  SITE_SESSION_TTL_SECONDS,
  createSessionToken,
  getSitePassword,
} from "@/lib/site-auth-cookie";
import { sanitizeInternalPath } from "@/lib/sanitize-internal-path";

function passwordsMatch(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
    return NextResponse.redirect(fail);
  }

  const token = await createSessionToken(expected);
  const destination = new URL(safeRedirect, request.url);
  const res = NextResponse.redirect(destination);
  res.cookies.set(SITE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_SESSION_TTL_SECONDS,
  });
  return res;
}
