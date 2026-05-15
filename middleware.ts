import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  SITE_SESSION_COOKIE,
  getSitePassword,
  verifySessionToken,
} from "@/lib/site-auth-cookie";
import { sanitizeInternalPath } from "@/lib/sanitize-internal-path";

const PUBLIC_PREFIXES = ["/login", "/api/auth/login"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const password = getSitePassword();
  const token = request.cookies.get(SITE_SESSION_COOKIE)?.value;

  if (token && (await verifySessionToken(password, token))) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  const from =
    pathname +
    (request.nextUrl.search ? request.nextUrl.search : "");
  login.searchParams.set("from", sanitizeInternalPath(from));
  return NextResponse.redirect(login);
}

export const config = {
  // Exclude all `/_next/*` (RSC/flight, static, HMR) so navigations keep working.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
