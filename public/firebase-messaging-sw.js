/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// Firebase コンソールの Web アプリ構成（公開情報）をそのまま貼る
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
});

const messaging = firebase.messaging();

// タブが閉じている/バックグラウンド時の受信
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};

  const title = n.title || "ご注文ができあがりました！";
  const body  = n.body  || (d.orderNo ? `注文番号: ${d.orderNo} をお受け取りください` : "");
  const tag   = d.tag || (d.orderNo ? `order-${d.orderNo}` : "order-ready");

  self.registration.showNotification(title, {
    body,
    tag,                        // 同じ tag は置き換え
    icon: "/icons/icon-192.png" // 実在するパスに合わせて
    // badge: "/icons/badge-72.png",
  });
});

// 通知クリックで復帰
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || (event.notification?.data && event.notification.data.url) || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const c of wins) {
        // 既存タブがあれば再利用
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(url) : undefined;
    })
  );
});
