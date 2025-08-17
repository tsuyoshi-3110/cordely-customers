// lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported as isAnalyticsSupported, type Analytics } from "firebase/analytics";

// ★ 追加: FCM（Web Push）
import {
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  type Messaging,
} from "firebase/messaging";

// .env.local の NEXT_PUBLIC_* を利用します
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!, // ← FCMで使う
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// HMR/SSR 対応：既存インスタンス再利用
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics はブラウザのみ
export let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  isAnalyticsSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app);
    })
    .catch(() => {});
}

/* -------------------- ここから FCM 追加 -------------------- */

// ブラウザ & 対応環境でのみ Messaging を用意
let messagingPromise: Promise<Messaging | null> | null = null;

export const ensureMessaging = () => {
  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    if (typeof window === "undefined") return null;
    const ok = await isMessagingSupported().catch(() => false);
    if (!ok) return null;
    return getMessaging(app);
  })();
  return messagingPromise;
};

/** FCM トークンを取得（service worker を登録して返す） */
export const getFcmToken = async (): Promise<string | null> => {
  const messaging = await ensureMessaging();
  if (!messaging) return null;

  // /public/firebase-messaging-sw.js を登録
  const swReg =
    (await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js")) ||
    (await navigator.serviceWorker.register("/firebase-messaging-sw.js"));

  const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
  if (!vapidKey) {
    // .env に NEXT_PUBLIC_FCM_VAPID_KEY=BKF... を入れてください
    console.warn("Missing NEXT_PUBLIC_FCM_VAPID_KEY");
    return null;
  }

  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg,
    });
    return token || null;
  } catch (e) {
    console.error("getToken failed:", e);
    return null;
  }
};

export default app;
