// 例：クライアント側の購読ユーティリティ（両対応）
import { getFcmToken } from "./firebase";

export async function ensurePushSetup() {
  if (typeof window === "undefined")
    return {
      fcmToken: null as string | null,
      webSub: null as PushSubscriptionJSON | null,
    };

  // SW登録（共通）
  const sw = await navigator.serviceWorker.register("/sw.js");

  // iOS PWA 判定
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    (navigator as any).standalone ||
    matchMedia("(display-mode: standalone)").matches;

  // iOS PWA → 標準WebPush
  if (isIOS && isStandalone && "PushManager" in window) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { fcmToken: null, webSub: null };
    let sub = await sw.pushManager.getSubscription();
    if (!sub) {
      const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const key = urlBase64ToUint8Array(vapidPub);
      sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }
    return { fcmToken: null, webSub: sub.toJSON() };
  }

  // それ以外 → FCM
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { fcmToken: null, webSub: null };

  // 既存の getFcmToken を使用。ただし SW 登録先は /sw.js に変更しておく
  const token = await getFcmToken(); // あなたの既存関数
  return { fcmToken: token, webSub: null };
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}
