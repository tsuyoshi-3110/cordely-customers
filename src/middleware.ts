import { NextResponse, type NextRequest } from "next/server";

// 例: https://domain/?s=shop123&t=12 → /s/shop123 に 302
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ルートへのQR想定
  if (pathname === "/") {
    const s = searchParams.get("s"); // siteKey
    const t = searchParams.get("t"); // tableNo (任意)

    if (s) {
      const url = req.nextUrl.clone();
      url.pathname = `/s/${encodeURIComponent(s)}`;
      url.search = ""; // 表示URLは綺麗に

      const res = NextResponse.redirect(url);

      if (t) {
        // テーブル番号を 1 日保持（必要に応じて変更）
        res.cookies.set("ctbl", t, { path: "/", maxAge: 60 * 60 * 24 });
      }
      return res;
    }
  }

  // 他は素通し
  return NextResponse.next();
}
