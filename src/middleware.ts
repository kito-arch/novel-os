import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "novel_session";

// Public paths that never require a session.
function isPublic(pathname: string): boolean {
  if (pathname === "/auth") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/hooks/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
