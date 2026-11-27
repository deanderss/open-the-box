import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = [/^\/groups/, /^\/g\//, /^\/admin/];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(list) {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  // getClaims() checks the JWT's signature locally (cached JWKS) instead of getUser()'s round trip to the
  // Auth server — middleware runs on every single matched request, so that round trip was effectively a tax
  // on every protected page load and every redirect decision.
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims.sub as string | undefined;
  const path = req.nextUrl.pathname;
  if (!uid && PROTECTED.some((r) => r.test(path))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (uid && (path === "/login" || path === "/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/groups";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/", "/login", "/groups/:path*", "/g/:path*", "/admin/:path*"],
};
