/* eslint-disable no-undef */
// 互換レイヤ（compat）でOK
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
);

// ★ あなたのWebアプリ構成（公開可）
firebase.initializeApp({
  apiKey: "AIzaSyBybyGoodAZCqxLSDbf21FlwLv-4c2L82o",
  authDomain: "crepeshopeapp.firebaseapp.com",
  projectId: "crepeshopeapp",
  messagingSenderId: "599712989327",
  appId: "1:599712989327:web:2178b20ef0605d993eb0fa",
});

const messaging = firebase.messaging();

/**
 * 背景（タブ非表示/閉じている）で受信した「dataメッセージ」用。
 * ※payload に notification が含まれる場合はブラウザが自動表示するので基本ここは呼ばれません。
 */
messaging.onBackgroundMessage((payload) => {
  // すでに notification 付きならブラウザが表示している想定（重複防止）
  if (payload.notification) return;

  const d = payload.data || {};
  const title = d.title || "ご注文ができあがりました！";
  const body =
    d.body || (d.orderNo ? `注文番号: ${d.orderNo} をお受け取りください` : "");
  const tag = d.tag || (d.orderNo ? `order-${d.orderNo}` : "order-ready");
  const url = d.url || "/"; // ← 後述の Functions から渡す

  self.registration.showNotification(title, {
    body,
    tag, // 同じ tag は置き換え
    icon: "/icons/icon-192x192.png", // 実在するパスに合わせる
    badge: "/icons/badge-72x72.png", // 任意（あれば）
    data: { url }, // クリック時に使う
  });
});

// 通知クリックでアプリに復帰
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        // 既存タブがあればそれを再利用
        for (const c of wins) {
          if ("focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        // 無ければ新しく開く
        return clients.openWindow ? clients.openWindow(url) : undefined;
      })
  );
});
