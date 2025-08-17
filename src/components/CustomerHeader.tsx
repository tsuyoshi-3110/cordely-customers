"use client";

import { siteKeyAtom } from "@/lib/atoms/siteKeyAtom";
import { db, storage } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref as sRef } from "firebase/storage";
import { useAtomValue } from "jotai";
import Image from "next/image";
import { useEffect, useState } from "react";

type AnyDoc = Record<string, any> | undefined;

/* ---------------- タイトル選択ルール ----------------
   1) siteSettingsEditable.siteName を最優先
   2) siteSettings.siteKey（フィールド値）を次善
   3) それも無ければ URL 等から得た siteKey（doc id）
----------------------------------------------------- */

// ロゴ候補（文字列 or {url|src}}）を拾う
const pickLogoCandidate = (v: AnyDoc): string | null => {
  if (!v) return null;
  const cands = [
    v.logoUrl,
    v.logoURI,
    v.logoImage,
    v.headerLogoUrl,
    v.brandLogo,
    v.logo,
  ];
  for (const c of cands) {
    if (!c) continue;
    if (typeof c === "string") return c;
    if (typeof c === "object") {
      if (typeof c.url === "string") return c.url;
      if (typeof c.src === "string") return c.src;
    }
  }
  return null;
};

// 文字列が完全URLか
const isHttpUrl = (s: string) => /^https?:\/\//i.test(s) || s.startsWith("/");

// Storage パス → ダウンロードURL
async function resolveLogoUrl(s: string): Promise<string> {
  if (isHttpUrl(s)) return s;
  const path = s.startsWith("gs://") ? s.replace(/^gs:\/\/[^/]+\//, "") : s;
  return await getDownloadURL(sRef(storage, path));
}

export default function CustomerHeader() {
  const siteKey = useAtomValue(siteKeyAtom);

  const [editableName, setEditableName] = useState<string>(""); // ①優先
  const [settingsSiteKey, setSettingsSiteKey] = useState<string>(""); // ②次善
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    setEditableName("");
    setSettingsSiteKey("");
    setLogoUrl(null);
    if (!siteKey) return;

    // 本命: siteSettingsEditable/{siteKey}
    const un1 = onSnapshot(
      doc(db, "siteSettingsEditable", siteKey),
      async (snap) => {
        const v = snap.data() as AnyDoc;
        // ① タイトル（最優先）
        const name = v?.siteName;
        if (typeof name === "string" && name.trim()) {
          setEditableName(name.trim());
        }
        // ロゴ（候補があれば採用）
        const cand = pickLogoCandidate(v);
        if (cand && !logoUrl) {
          try {
            const url = await resolveLogoUrl(String(cand));
            setLogoUrl(url);
          } catch {}
        }
      },
      () => {}
    );

    // フォールバック: siteSettings/{siteKey}
    const un2 = onSnapshot(
      doc(db, "siteSettings", siteKey),
      async (snap) => {
        const v = snap.data() as AnyDoc;
        // ② タイトル（次善）
        const keyField = v?.siteKey;
        if (!editableName && typeof keyField === "string" && keyField.trim()) {
          setSettingsSiteKey(keyField.trim());
        }
        // ロゴ（未確定ならこちらも候補に）
        if (!logoUrl) {
          const cand = pickLogoCandidate(v);
          if (cand) {
            try {
              const url = await resolveLogoUrl(String(cand));
              setLogoUrl(url);
            } catch {}
          }
        }
      },
      () => {}
    );

    return () => {
      un1();
      un2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  // 表示テキストの最終決定
  const titleText = editableName || settingsSiteKey || siteKey || "";

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-gradient-to-r from-teal-500 to-pink-500 shadow-md">
      {/* ← フル幅 & 左右余白ゼロ */}
      <div className="flex h-14 w-full items-center px-0">
        <div className="flex h-full items-center">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={titleText || "Logo"}
              width={140}
              height={24}
              className="h-8 w-auto object-contain ml-5"
              sizes="140px"
              priority
            />
          ) : (
            <Image
              src="/images/cordelyLogo.png"
              alt="Cordely"
              width={140}
              height={24}
              className="h-8 w-auto object-contain ml-5"
              priority
            />
          )}
        </div>
      </div>

      {titleText && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-14 items-center justify-center">
          <span className="max-w-[70%] truncate text-white text-xl font-semibold md:text-base drop-shadow">
            {titleText}
          </span>
        </div>
      )}
    </header>
  );
}
