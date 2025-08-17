/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// Firebase Web App 公開設定（ベタ書きでOK：公開情報です）
firebase.initializeApp({
  apiKey: "AIzaSyBybyGoodAZCqxLSDbf21FlwLv-4c2L82o",
  authDomain: "crepeshopeapp.firebaseapp.com",
  projectId: "crepeshopeapp",
  messagingSenderId: "599712989327",
  appId: "1:599712989327:web:2178b20ef0605d993eb0fa",
});

const messaging = firebase.messaging();

// タブが閉じている/バックグラウンド時の受信
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || "ご注文ができあがりました！";
  const body  = n.body  || (d.done ? `注文番号: ${d.done} をお受け取りください` : "");
  const tag   = d.done ? `order-${d.done}` : "order-ready";

  // Cloud Functions からの webpush.fcmOptions.link で URL 指定もできます
  const url = (d && d.url) || "/";

  self.registration.showNotification(title, {
    body,
    tag,
    icon: "/icons/icon-192x192.png", // 実在するパスに合わせる
    badge: "/icons/badge-72x72.png",
    data: { url },                    // クリックで開くURL
  });
});

// 通知クリックで復帰
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";

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
