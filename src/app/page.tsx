"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSetAtom } from "jotai";
import { siteKeyAtom } from "@/lib/atoms/siteKeyAtom";
import { resolveSiteKeyByCode } from "@/lib/resolveSiteKey";

export default function Page() {
  const router = useRouter();
  const search = useSearchParams();
  const setSiteKey = useSetAtom(siteKeyAtom);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const urlSiteKey = search.get("siteKey");
      if (urlSiteKey) {
        setSiteKey(urlSiteKey);
        router.replace("/menu");
        return;
      }

      const urlCode = search.get("code");
      if (urlCode) {
        setLoading(true);
        setErr(null);
        const key = await resolveSiteKeyByCode(urlCode);
        setLoading(false);
        if (!key) {
          setErr("無効なコードです。店舗のQRコードをご確認ください。");
          return;
        }
        setSiteKey(key);
        router.replace("/menu");
        return;
      }

      // ← ここが追加: 保存済み siteKey があれば自動遷移
      const stored = typeof window !== "undefined" ? localStorage.getItem("siteKey") : null;
      if (stored) {
        setSiteKey(stored);
        router.replace("/menu");
      }
    })();
  }, [search, router, setSiteKey]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setErr(null);
    const key = await resolveSiteKeyByCode(code.trim());
    setLoading(false);
    if (!key) {
      setErr("無効なコードです。");
      return;
    }
    setSiteKey(key);
    router.push("/menu");
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
            className="w-full rounded bg黑 px-3 py-2 text-white disabled:opacity-50"
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
