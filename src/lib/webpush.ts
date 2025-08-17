// lib/webpush.ts
import { db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

// ← ArrayBuffer を返すように修正
function urlB64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer; // ← これが BufferSource として受理される
}

function getOrCreateBrowserId(): string {
  const k = "browserId";
  const ex = typeof window !== "undefined" ? localStorage.getItem(k) : null;
  if (ex) return ex;
  const id = crypto.randomUUID();
  localStorage.setItem(k, id);
  return id;
}

export async function ensureSw(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("SW unsupported");
  // 既に ready ならその登録を使う
  const ready = await navigator.serviceWorker.ready.catch(() => null);
  if (ready) return ready;
  // 未登録なら /sw.js を登録（公開ディレクトリ直下に配置しておくこと）
  return navigator.serviceWorker.register("/sw.js");
}

/** 標準 Web Push の購読を作成し、Firestore に保存。DocID を返す */
export async function subscribeWebPush(siteKey: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !("PushManager" in window)) return null;

  // 必ずユーザー操作直後に実行
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return null;

  const reg = await ensureSw();

  // 既存購読があれば再利用
  let sub = await reg.pushManager.getSubscription();

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY!;
  if (!publicKey) {
    console.warn("Missing NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY");
    return null;
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // ← ここを ArrayBuffer に
      applicationServerKey: urlB64ToArrayBuffer(publicKey),
    });
  }

  // Firestore に保存
  const browserId = getOrCreateBrowserId();
  const payload = sub.toJSON();
  const docRef = await addDoc(collection(db, "webpushSubs"), {
    siteKey,
    browserId,
    createdAt: serverTimestamp(),
    subscription: payload, // endpoint, keys:{p256dh,auth}, expirationTime
    ua: navigator.userAgent,
  });

  localStorage.setItem("webpushSubId", docRef.id);
  return docRef.id;
}
