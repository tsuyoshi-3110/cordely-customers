"use client";

import { useEffect } from "react";
import { getFcmToken } from "@/lib/firebase";

export default function FcmInit({
  run,
  onToken,
}: {
  run: boolean;
  onToken?: (token: string) => void;
}) {
  useEffect(() => {
    if (!run) return;
    let cancelled = false;

    (async () => {
      if (typeof window === "undefined" || !("Notification" in window)) return;

      // 未許可ならここでユーザー操作に続けて許可ダイアログ
      if (Notification.permission !== "granted") {
        const res = await Notification.requestPermission();
        if (res !== "granted") return;
      }

      const token = await getFcmToken(); // ← lib/firebase で実装済みのはず
      if (!cancelled && token) {
        localStorage.setItem("fcmToken", token);
        onToken?.(token);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [run, onToken]);

  return null;
}
