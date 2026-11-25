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
  const { data } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  if (!data.user && PROTECTED.some((r) => r.test(path))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (data.user && (path === "/login" || path === "/")) {
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
