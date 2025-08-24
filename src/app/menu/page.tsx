// app/page.tsx あるいは app/menu/page.tsx
"use client";

import { siteKeyAtom } from "@/lib/atoms/siteKeyAtom";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useAtomValue } from "jotai";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const ALL_SECTIONS = "__ALL__";

/* ---------- 型 ---------- */
type Product = {
  productId: number;
  name: string;
  price: number;
  imageUri: string;
  soldOut?: boolean;
  description?: string;
  taxIncluded?: boolean;
  docId: string;
  sectionId?: string | null;
};

type Section = {
  id: string;
  name: string;
  sortIndex: number;
};

type MyOrder = {
  orderNo: number;
  docId: string;
  notified: boolean;
  totalItems: number;
  waitMinutes?: number;
};

type ActiveOrder = {
  orderNo: number;
  totalItems?: number;
};

/* ---------- ヘルパ ---------- */
async function getNextOrderNoForSite(siteKey: string): Promise<number> {
  const ref = doc(db, "counters", siteKey);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const curr = (snap.data()?.current as number) ?? 0;
    const val = curr + 1;
    tx.set(ref, { current: val }, { merge: true });
    return val;
  });
  return next;
}

export default function MenuPage() {
  const siteKey = useAtomValue(siteKeyAtom);

  const [products, setProducts] = useState<Product[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] =
    useState<string>(ALL_SECTIONS);

  const [qty, setQty] = useState<Record<number, number>>({});
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [currentNo, setCurrentNo] = useState(0);

  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [lastOrderNo, setLastOrderNo] = useState<number | null>(null);
  const [completedOrderNo, setCompletedOrderNo] = useState<number | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productsReady, setProductsReady] = useState(false);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  // 通知関連状態（出し分け）
  // const [notifSupported, setNotifSupported] = useState(false);
  // const [notifGranted, setNotifGranted] = useState(false);
  // const [askNotif, setAskNotif] = useState(false);
  // const [isIOS, setIsIOS] = useState(false);
  // const [isStandalone, setIsStandalone] = useState(false);
  // const [iosSubscribed, setIosSubscribed] = useState(false);

  const localKey = siteKey ? `myOrders:${siteKey}` : "myOrders";

  const displayProducts = useMemo(() => {
    if (sections.length === 0 || selectedSectionId === ALL_SECTIONS)
      return products;
    return products.filter((p) => p.sectionId === selectedSectionId);
  }, [products, sections, selectedSectionId]);

  /* ---------- 通知サポート判定（iOSはPWAのみ許可） ---------- */
  // useEffect(() => {
  //   if (typeof window === "undefined") return;

  //   const ua = navigator.userAgent || "";
  //   // iPadOSが Mac UA を名乗るケースも拾う
  //   const isiOS =
  //     /iPhone|iPad|iPod/i.test(ua) ||
  //     (ua.includes("Mac") && (navigator as any).maxTouchPoints > 1);

  //   const standalone =
  //     window.matchMedia?.("(display-mode: standalone)").matches ||
  //     // iOS Safari 独自プロパティ
  //     (navigator as unknown as { standalone?: boolean }).standalone === true;

  //   setIsIOS(isiOS);
  //   setIsStandalone(standalone);

  //   const hasSW = "serviceWorker" in navigator;
  //   const hasPush = "PushManager" in window;
  //   const hasNotif = "Notification" in window;

  //   const supported = hasSW && hasPush && hasNotif && (!isiOS || standalone);
  //   setNotifSupported(supported);
  //   if (supported) setNotifGranted(Notification.permission === "granted");

  //   try {
  //     setIosSubscribed(!!localStorage.getItem("webpushSubId"));
  //   } catch {}
  // }, []);

  // 実際に通知を出す（前景フォールバック）
  // const notifyUser = (orderNo: number) => {
  //   try {
  //     if (notifSupported && Notification.permission === "granted") {
  //       const n = new Notification("ご注文ができあがりました！", {
  //         body: `注文番号: ${orderNo} をお受け取りください`,
  //         tag: `order-${orderNo}`,
  //       });
  //       n.onclick = () => window.focus();
  //     } else {
  //       document.title = `🔔 注文 ${orderNo} 完成！`;
  //       if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
  //         navigator.vibrate(200);
  //       }
  //     }
  //   } catch (e) {
  //     console.error(e);
  //   }
  // };

  /* ---------- isOpen 購読 ---------- */
  useEffect(() => {
    if (!siteKey) {
      setIsOpen(true);
      return;
    }
    const ref = doc(db, "siteSettingsEditable", siteKey);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { isOpen?: boolean } | undefined;
        setIsOpen(data?.isOpen ?? true);
      },
      (e) => {
        console.error("isOpen onSnapshot error:", e);
        setIsOpen(true);
      }
    );
  }, [siteKey]);

  /* ---------- 初回復元 / タブ復帰時復元 ---------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(localKey);
      if (saved) setMyOrders(JSON.parse(saved));
    } catch {
      // no-op
    }
    const onVis = () => {
      if (document.visibilityState === "visible") {
        try {
          const saved = localStorage.getItem(localKey);
          if (saved) setMyOrders(JSON.parse(saved));
        } catch {
          // no-op
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [localKey]);

  /* ---------- セクション購読 ---------- */
  useEffect(() => {
    if (!siteKey) return;
    const qy = query(
      collection(db, "sections"),
      where("siteKey", "==", siteKey),
      orderBy("sortIndex", "asc")
    );
    return onSnapshot(
      qy,
      (snap) => {
        const arr: Section[] = snap.docs.map((d, i) => {
          const v = d.data() as Record<string, unknown>;
          const name = typeof v.name === "string" ? v.name : "";
          const sortIndex =
            typeof v.sortIndex === "number" ? v.sortIndex : (i + 1) * 1000;
          return {
            id: d.id,
            name,
            sortIndex,
          };
        });
        setSections(arr);

        if (
          arr.length === 0 ||
          (selectedSectionId !== ALL_SECTIONS &&
            !arr.some((s) => s.id === selectedSectionId))
        ) {
          setSelectedSectionId(ALL_SECTIONS);
        }
      },
      (err) => console.error("sections onSnapshot error:", err)
    );
  }, [siteKey, selectedSectionId]);

  /* ---------- 商品一覧 ---------- */
  useEffect(() => {
    if (!siteKey) return;

    setProductsReady(false);

    const qy = query(
      collection(db, "products"),
      where("siteKey", "==", siteKey),
      orderBy("sortIndex", "asc"),
      orderBy("productId", "asc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: Product[] = snap.docs.map((d) => {
          const v = d.data() as Record<string, unknown>;
          const productId = typeof v.productId === "number" ? v.productId : 0;
          const name = typeof v.name === "string" ? v.name : "";
          const price = typeof v.price === "number" ? v.price : 0;
          const imageUri = typeof v.imageUri === "string" ? v.imageUri : "";
          const soldOut = typeof v.soldOut === "boolean" ? v.soldOut : false;
          const description =
            typeof v.description === "string" ? v.description : "";
          const taxIncluded =
            v.taxIncluded == null ? true : Boolean(v.taxIncluded);
          const sectionId =
            typeof v.sectionId === "string" ? v.sectionId : null;

          return {
            productId,
            name,
            price,
            imageUri,
            soldOut,
            description,
            taxIncluded,
            docId: d.id,
            sectionId,
          };
        });

        setProducts(list);

        setQty((prev) => {
          const next = { ...prev };
          list.forEach((p) => {
            if (next[p.productId] == null) next[p.productId] = 0;
          });
          return next;
        });

        setProductsReady(true);
      },
      (err) => {
        console.error("products onSnapshot error:", err);
        setProductsReady(true);
      }
    );

    return () => unsub();
  }, [siteKey]);

  /* ---------- 未完了注文の購読（待ち時間 / 現在番号） ---------- */
  useEffect(() => {
    const qy = query(
      collection(db, "orders"),
      where("siteKey", "==", siteKey),
      where("isComp", "==", false),
      orderBy("orderNo", "asc")
    );
    return onSnapshot(qy, (snap) => {
      if (snap.empty) {
        setActiveOrders([]);
        setCurrentNo(0);
        return;
      }
      const list = snap.docs.map((d) => d.data() as ActiveOrder);
      setActiveOrders(list);
      setCurrentNo(list[0]?.orderNo ?? 0);
    });
  }, [siteKey]);

  /* ---------- activeOrders 変化で MyOrder の待ち時間更新 ---------- */
  useEffect(() => {
    if (!activeOrders.length || !myOrders.length) return;
    const updated = myOrders.map((mo) => {
      const before = activeOrders.filter((o) => o.orderNo < mo.orderNo);
      const itemsBefore = before.reduce((s, o) => s + (o.totalItems ?? 0), 0);
      const selfItems =
        activeOrders.find((o) => o.orderNo === mo.orderNo)?.totalItems ??
        mo.totalItems;
      return { ...mo, waitMinutes: itemsBefore * 5 + selfItems * 5 };
    });
    setMyOrders(updated);
    localStorage.setItem(localKey, JSON.stringify(updated));
  }, [activeOrders, myOrders.length, localKey]);

  /* ---------- 自分の注文完了通知（前景フォールバック + モーダル） ---------- */
  useEffect(() => {
    if (!myOrders.length) return;
    const unsubs = myOrders.map((mo) => {
      const ref = doc(db, "orders", mo.docId);
      return onSnapshot(ref, (snap) => {
        const data = snap.data() as { isComp?: boolean } | undefined;
        if (data?.isComp && !mo.notified) {
          // 通知（前景フォールバック）
          // notifyUser(mo.orderNo);

          setCompletedOrderNo(mo.orderNo);
          setFinishOpen(true);
          setMyOrders((prev) => {
            const next = prev
              .map((x) =>
                x.orderNo === mo.orderNo ? { ...x, notified: true } : x
              )
              .filter((x) => x.orderNo !== mo.orderNo);
            localStorage.setItem(localKey, JSON.stringify(next));
            return next;
          });
        }
      });
    });
    return () => unsubs.forEach((u) => u());
  }, [myOrders, localKey]);

  /* ---------- 合計 ---------- */
  const totalItems = useMemo(
    () => Object.values(qty).reduce((a, b) => a + b, 0),
    [qty]
  );
  const totalPrice = useMemo(
    () => products.reduce((s, p) => s + p.price * (qty[p.productId] || 0), 0),
    [products, qty]
  );

  /* ---------- イベント ---------- */
  const openConfirm = () => {
    if (isOpen === false) {
      alert("現在はクローズ中です。時間をおいてお試しください。");
      return;
    }
    if (totalItems === 0) {
      alert("数量を入力してください。");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmOrder = async () => {
    setSubmitting(true);
    setConfirmOpen(false);
    try {
      const key = siteKey;
      if (!key) {
        alert(
          "店舗コードが見つかりません。トップに戻ってQRを読み込んでください。"
        );
        return;
      }

      // ここで FCM token / iOS WebPush subId を拾う
      const fcmToken =
        typeof window !== "undefined" ? localStorage.getItem("fcmToken") : null;
      const webpushSubId =
        typeof window !== "undefined"
          ? localStorage.getItem("webpushSubId")
          : null;

      // 現在の未完了注文（待ち時間計算用）
      const snap = await getDocs(
        query(
          collection(db, "orders"),
          where("siteKey", "==", key),
          where("isComp", "==", false),
          orderBy("orderNo", "asc")
        )
      );
      const current = snap.docs.map((d) => d.data() as ActiveOrder);

      // 採番
      const orderNo = await getNextOrderNoForSite(key);

      // 注文アイテム
      const items = products
        .filter((p) => (qty[p.productId] || 0) > 0)
        .map((p) => ({
          productId: p.productId,
          name: p.name,
          price: p.price,
          quantity: qty[p.productId] || 0,
          subtotal: p.price * (qty[p.productId] || 0),
        }));

      if (items.length === 0) {
        alert("数量を入力してください。");
        return;
      }

      const totalItemsLocal = items.reduce((s, it) => s + it.quantity, 0);
      const totalPriceLocal = items.reduce((s, it) => s + it.subtotal, 0);

      const itemsBefore = current.reduce((s, o) => s + (o.totalItems ?? 0), 0);
      const waitMin = itemsBefore * 5 + totalItemsLocal * 5;

      // 注文保存（FCMトークン / iOS WebPush 購読ID も一緒に）
      const ref = await addDoc(collection(db, "orders"), {
        siteKey: key,
        orderNo,
        items,
        totalItems: totalItemsLocal,
        totalPrice: totalPriceLocal,
        isComp: false,
        createdAt: serverTimestamp(),
        customerFcmToken: fcmToken ?? null,
        customerWebPushSubId: webpushSubId ?? null,
      });

      const newMy: MyOrder = {
        orderNo,
        docId: ref.id,
        notified: false,
        totalItems: totalItemsLocal,
        waitMinutes: waitMin,
      };
      setLastOrderNo(orderNo);
      setMyOrders((prev) => {
        const next = [...prev, newMy];
        localStorage.setItem(localKey, JSON.stringify(next));
        return next;
      });

      setQty(Object.fromEntries(products.map((p) => [p.productId, 0])));
      setDoneOpen(true);
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました。通信状況をご確認ください。");
    } finally {
      setSubmitting(false);
    }
  };

  // 先頭ローディング
  if (!productsReady) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
      </main>
    );
  }

  // 商品なし
  if (productsReady && products.length === 0) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-4">
        <p className="text-sm text-gray-600">
          この店舗にはまだ商品が登録されていません。
          管理画面から商品を追加してください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-3 pb-28 ">
      {isOpen === false && (
        <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm grid place-items-center">
          <p className="text-white text-6xl md:text-8xl font-extrabold tracking-widest select-none">
            CLOSE
          </p>
        </div>
      )}

      {!siteKey ? (
        <div className="min-h-[60vh] grid place-items-center px-4">
          <p className="text-sm text-gray-600">
            店舗コードが未設定です。トップに戻って QR を読み込んでください。
          </p>
        </div>
      ) : (
        <>
          {/* ヘッダー（現在番号） */}
          <div className="sticky top-14 z-40 -mx-3">
            <div className="rounded-none bg-gradient-to-r from-teal-500 to-pink-500 py-4 px-3 text-white shadow">
              {currentNo > 0 ? (
                <div className="flex items-center justify-center gap-2 text-xl font-semibold">
                  <span>現在作成中の注文番号:</span>
                  <span>{currentNo}</span>
                </div>
              ) : (
                <p className="py-0.5 text-center text-xl font-semibold">
                  すぐにお作りできます！
                </p>
              )}
            </div>
          </div>

          {/* Push通知の設定（iPhone PWA と Android/PC を出し分け） */}
          {/* <div className="mt-2">
            {isIOS ? (
              iosSubscribed ? (
                <div className="rounded-md border p-3 text-sm bg-white text-teal-700">
                  通知は<strong>ON</strong>
                  になっています。出来上がり時に通知します。
                </div>
              ) : (
                <>
                  {!isStandalone && (
                    <div className="mb-2 rounded-md border p-3 text-sm bg-white">
                      <p className="font-medium mb-1">
                        iPhoneで通知を使うには：
                      </p>
                      <ol className="list-decimal ml-5 space-y-1">
                        <li>Safariでこのページを開く</li>
                        <li>
                          共有 → <strong>ホーム画面に追加</strong>
                        </li>
                        <li>ホームのアイコンから起動して下のボタンを押す</li>
                      </ol>
                    </div>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    onClick={async () => {
                      try {
                        if (!siteKey) {
                          alert("店舗コードが未設定です。");
                          return;
                        }
                        const id = await subscribeWebPush(siteKey);
                        if (id) {
                          setIosSubscribed(true);
                          alert("通知をONにしました。");
                        } else {
                          alert(
                            "通知が許可されませんでした。設定から許可してください。"
                          );
                        }
                      } catch (e) {
                        console.error(e);
                        alert("通知の有効化に失敗しました。");
                      }
                    }}
                  >
                    🔔（iPhone）完成時に通知を受け取る（通知をON）
                  </button>
                </>
              )
            ) : (
              // ---- Android / PC（FCM）用 ----
              notifSupported &&
              !notifGranted && (
                <>
                  <button
                    type="button"
                    onClick={() => setAskNotif(true)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    🔔 完成時に通知を受け取る（通知をON）
                  </button>
                  <FcmInit
                    run={askNotif}
                    onToken={() => {
                      setNotifGranted(true);
                      setAskNotif(false);
                    }}
                  />
                </>
              )
            )}
          </div> */}

          {/* セクションピッカー */}
          {sections.length > 0 && (
            <div className="mt-3">
              <label className="block text-sm mb-1">カテゴリー</label>
              <select
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="h-10 w-full rounded-md border px-2"
              >
                <option value={ALL_SECTIONS}>商品一覧</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 自分の注文状況（ローカル） */}
          <div className="mt-2 space-y-2">
            {myOrders.map((o) => {
              const remaining = Math.max(o.orderNo - currentNo, 0);
              return (
                <div key={o.orderNo} className="rounded-md bg-blue-50 p-2">
                  <p className="text-teal-700">
                    ご注文番号 {o.orderNo} は
                    {remaining === 0
                      ? "現在お作りしています。"
                      : remaining === 1
                      ? "次です。"
                      : `あと ${remaining} 番目です`}
                  </p>
                  {/* {remaining > 0 && (
                    <p className="text-sm text-gray-600">
                      約 {o.waitMinutes ?? 0} 分ほどで出来上がります
                    </p>
                  )} */}
                </div>
              );
            })}
          </div>

          {/* 商品一覧：2列グリッド */}
          <div className="mt-6 grid grid-cols-2 gap-6">
            {displayProducts.map((p) => {
              const count = qty[p.productId] || 0;
              return (
                <div key={p.docId} className="rounded-md bg-white shadow-sm">
                  <div className="relative aspect-square w-full overflow-hidden rounded-t-md">
                    <Image
                      src={p.imageUri}
                      alt={p.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, 240px"
                    />
                    {p.soldOut && (
                      <div className="absolute inset-0 z-10 grid place-items-center bg-black/40">
                        <Image
                          src="/images/soldOut.png"
                          alt="SOLD OUT"
                          width={200} // お好みで調整
                          height={200} // お好みで調整
                          className="w-2/3 max-w-[220px] h-auto pointer-events-none select-none object-contain"
                          priority
                          unoptimized
                        />
                      </div>
                    )}
                  </div>

                  <div className="p-2">
                    <p className="line-clamp-1 text-sm font-semibold">
                      {p.name}
                    </p>
                    <p className="text-xs text-gray-600">
                      ￥{p.price.toLocaleString("ja-JP")}
                      {p.taxIncluded ? "(税込)" : "(税抜)"}
                    </p>

                    {p.description && (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-gray-700">
                        {p.description}
                      </p>
                    )}

                    <div className="mt-2 flex items-center justify-between">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-gray-50 text-base disabled:opacity-40"
                        onClick={() =>
                          setQty((q) => ({
                            ...q,
                            [p.productId]: Math.max(
                              0,
                              (q[p.productId] || 0) - 1
                            ),
                          }))
                        }
                        disabled={p.soldOut || count <= 0}
                      >
                        －
                      </button>
                      <div className="w-10 select-none text-center text-sm">
                        {count}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-gray-50 text-base disabled:opacity-40"
                        onClick={() =>
                          setQty((q) => ({
                            ...q,
                            [p.productId]: (q[p.productId] || 0) + 1,
                          }))
                        }
                        disabled={p.soldOut}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* フッター注文バー */}
          <div className="fixed inset-x-0 bottom-0 z-40 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            <div className="mx-auto flex max-w-md items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="grid h-10 w-10 place-items-center rounded-full border">
                  🛒
                </div>
                {totalItems > 0 && (
                  <>
                    <span className="font-bold">{totalItems} 点</span>
                    <span className="text-gray-600">
                      / ￥{totalPrice.toLocaleString("ja-JP")}
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={openConfirm}
                disabled={submitting || isOpen === false}
                className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white disabled:opacity-50"
              >
                注文する
              </button>
            </div>
          </div>

          {/* 確認モーダル */}
          {confirmOpen && (
            <Modal onClose={() => setConfirmOpen(false)} title="注文内容の確認">
              <div className="space-y-2">
                {products
                  .filter((p) => (qty[p.productId] || 0) > 0)
                  .map((p) => (
                    <div
                      key={p.docId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{p.name}</span>
                      <span>
                        {qty[p.productId]}×￥{p.price}＝￥
                        {(qty[p.productId] * p.price).toLocaleString("ja-JP")}
                      </span>
                    </div>
                  ))}
              </div>
              <p className="mt-4 text-right text-base font-semibold">
                合計 ￥{totalPrice.toLocaleString("ja-JP")}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  className="flex-1 rounded-md border px-3 py-2"
                  onClick={() => setConfirmOpen(false)}
                >
                  キャンセル
                </button>
                <button
                  className="flex-1 rounded-md bg-teal-600 px-3 py-2 text-white"
                  onClick={confirmOrder}
                >
                  確定
                </button>
              </div>
            </Modal>
          )}

          {/* 注文完了モーダル */}
          {doneOpen && (
            <Modal onClose={() => setDoneOpen(false)} title="注文完了！">
              <p className="mb-2 text-center">注文を受け付けました！</p>
              <div className="my-2 text-center">
                <div className="text-sm">注文番号:</div>
                <div className="text-4xl font-bold text-teal-600">
                  {lastOrderNo}
                </div>
              </div>
              <p className="mt-2 text-center text-sm">
                画面をスクリーンショットしてスタッフにお見せください。
              </p>
              <button
                className="mt-4 w-full rounded-md bg-teal-600 px-3 py-2 text-white"
                onClick={() => setDoneOpen(false)}
              >
                閉じる
              </button>
            </Modal>
          )}

          {/* 完成通知モーダル */}
          {finishOpen && (
            <Modal
              onClose={() => setFinishOpen(false)}
              title="ご注文の商品ができあがりました！"
            >
              <div className="text-center text-3xl font-bold text-teal-700">
                注文番号: {completedOrderNo}
              </div>
              <p className="mt-3 text-center text-sm">
                スタッフにこの番号をお見せください。
              </p>
              <button
                className="mt-4 w-full rounded-md bg-teal-600 px-3 py-2 text-white"
                onClick={() => setFinishOpen(false)}
              >
                閉じる
              </button>
            </Modal>
          )}
        </>
      )}
    </main>
  );
}

/* ---------- シンプルなモーダル ---------- */
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md bg-white p-4 shadow-lg">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
