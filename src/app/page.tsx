"use client";

import { siteKeyAtom } from "@/lib/atoms/siteKeyAtom";
import { resolveSiteKeyByCode } from "@/lib/resolveSiteKey";
import { useSetAtom } from "jotai";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <PageInner />
    </Suspense>
  );
}

function PageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const setSiteKey = useSetAtom(siteKeyAtom);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 入力値が siteKey っぽいかを簡易判定（英数/ハイフン/アンダースコア）
  const looksLikeSiteKey = (v: string) => /^[a-zA-Z0-9_-]{3,64}$/.test(v);

  useEffect(() => {
    (async () => {
      const urlSiteKey = search.get("siteKey");
      if (urlSiteKey) {
        setSiteKey(urlSiteKey);
        router.replace(`/menu?siteKey=${encodeURIComponent(urlSiteKey)}`);
        return;
      }

      const urlCode = search.get("code");
      if (!urlCode) return;

      setLoading(true);
      setErr(null);
      try {
        // ★ codeにsiteKeyが入っていても動くように
        if (looksLikeSiteKey(urlCode)) {
          setSiteKey(urlCode);
          router.replace(`/menu?siteKey=${encodeURIComponent(urlCode)}`);
          return;
        }
        const key = await resolveSiteKeyByCode(urlCode);
        if (!key) {
          setErr("無効なコードです。店舗のQRコードをご確認ください。");
          return;
        }
        setSiteKey(key);
        router.replace(`/menu?siteKey=${encodeURIComponent(key)}`);
      } catch (e) {
        console.error(e);
        setErr("通信に失敗しました。時間をおいてお試しください。");
      } finally {
        setLoading(false);
      }
    })();
  }, [search, router, setSiteKey]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = code.trim();
    if (!input) return;

    setLoading(true);
    setErr(null);
    try {
      // ★ フォームでもsiteKey直入力を許可
      if (looksLikeSiteKey(input)) {
        setSiteKey(input);
        router.push(`/menu?siteKey=${encodeURIComponent(input)}`);
        return;
      }
      const key = await resolveSiteKeyByCode(input);
      if (!key) {
        setErr("無効なコードです。");
        return;
      }
      setSiteKey(key);
      router.push(`/menu?siteKey=${encodeURIComponent(key)}`);
    } catch (e) {
      console.error(e);
      setErr("通信に失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-6">
      {loading ? (
        <div className="grid place-items-center min-h-[40vh]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="w-full rounded border px-3 py-2"
            placeholder="コードを入力（任意）"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="submit"
            className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
            disabled={!code.trim()}
          >
            開始
          </button>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <p className="text-xs text-gray-500">
            例: <code>?siteKey=test06</code> を URL に付けても遷移できます
          </p>
        </form>
      )}
    </main>
  );
}
