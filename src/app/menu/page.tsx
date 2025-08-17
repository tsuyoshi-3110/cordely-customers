"use client";

import FcmInit from "@/components/FcmInit";
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
import { useEffect, useMemo, useRef, useState } from "react";

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
  sectionId?: string | null; // ← 追加：セクション紐付け
};

type Section = {
  id: string; // sections の doc.id
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
  const [sections, setSections] = useState<Section[]>([]); // ← 追加
  const [selectedSectionId, setSelectedSectionId] =
    useState<string>(ALL_SECTIONS);

  const [qty, setQty] = useState<Record<number, number>>({});
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [currentNo, setCurrentNo] = useState(0);
  // const [waitTimeText, setWaitTimeText] = useState("現在の待ち時間: 0分");

  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [lastOrderNo, setLastOrderNo] = useState<number | null>(null);
  const [completedOrderNo, setCompletedOrderNo] = useState<number | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productsReady, setProductsReady] = useState(false);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  const [notifSupported, setNotifSupported] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const [askNotif, setAskNotif] = useState(false);

  const localKey = siteKey ? `myOrders:${siteKey}` : "myOrders";

  const displayProducts = useMemo(() => {
    if (sections.length === 0 || selectedSectionId === ALL_SECTIONS)
      return products;
    return products.filter((p) => p.sectionId === selectedSectionId);
  }, [products, sections, selectedSectionId]);

  // マウント時にサポート/許可状況を反映
  useEffect(() => {
    const ok = typeof window !== "undefined" && "Notification" in window;
    setNotifSupported(ok);
    if (ok) setNotifGranted(Notification.permission === "granted");
  }, []);

  // クリックで通知許可をリクエスト
  const enableNotifications = async () => {
    try {
      const res = await Notification.requestPermission();
      const granted = res === "granted";
      setNotifGranted(granted);
      if (!granted)
        alert("通知が許可されませんでした。ブラウザの設定をご確認ください。");
    } catch (e) {
      console.error(e);
    }
  };

  // 実際に通知を出すヘルパ
  const notifyUser = (orderNo: number) => {
    try {
      if (notifSupported && Notification.permission === "granted") {
        const n = new Notification("ご注文ができあがりました！", {
          body: `注文番号: ${orderNo} をお受け取りください`,
          tag: `order-${orderNo}`, // 同じタグは置き換えられる
          // renotify: true, // ← 外す
        });
        n.onclick = () => window.focus();
      } else {
        document.title = `🔔 注文 ${orderNo} 完成！`;
        try {
          (navigator as any).vibrate?.(200);
        } catch {}
      }
    } catch (e) {
      console.error(e);
    }
  };

  // isOpen 購読
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

  /* ---------- 初回復元 / 再表示復元 ---------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(localKey);
      if (saved) setMyOrders(JSON.parse(saved));
    } catch {}
    const onVis = () => {
      if (document.visibilityState === "visible") {
        try {
          const saved = localStorage.getItem(localKey);
          if (saved) setMyOrders(JSON.parse(saved));
        } catch {}
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
          const v = d.data() as any;
          return {
            id: d.id,
            name: String(v.name ?? ""),
            sortIndex:
              typeof v.sortIndex === "number" ? v.sortIndex : (i + 1) * 1000,
          };
        });
        setSections(arr);

        // セクションが無い or 既存選択が消えたら「全セクション」に戻す
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

  /* ---------- 商品一覧（並び順 sortIndex 優先） ---------- */
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
          const v = d.data() as any;
          return {
            productId: Number(v.productId ?? 0),
            name: String(v.name ?? ""),
            price: Number(v.price ?? 0),
            imageUri: String(v.imageUri ?? ""),
            soldOut: Boolean(v.soldOut ?? false),
            description: v.description ? String(v.description) : "",
            taxIncluded: v.taxIncluded == null ? true : Boolean(v.taxIncluded),
            docId: d.id,
            sectionId: typeof v.sectionId === "string" ? v.sectionId : null,
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
        // setWaitTimeText("現在の待ち時間: 0分");
        return;
      }
      const list = snap.docs.map((d) => d.data());
      setActiveOrders(list);
      setCurrentNo(list[0]?.orderNo ?? 0);

      const totalItemsAll = list.reduce(
        (s: number, o: any) => s + (o.totalItems || 0),
        0
      );
      // const mins = totalItemsAll * 5;
      // setWaitTimeText(
      //   `現在の待ち時間: 約${Math.floor(mins / 60)}時間${mins % 60}分`
      // );
    });
  }, [siteKey]);

  /* ---------- activeOrders 変化で MyOrder の待ち時間更新 ---------- */
  useEffect(() => {
    if (!activeOrders.length || !myOrders.length) return;
    const updated = myOrders.map((mo) => {
      const before = activeOrders.filter((o: any) => o.orderNo < mo.orderNo);
      const itemsBefore = before.reduce(
        (s: number, o: any) => s + (o.totalItems || 0),
        0
      );
      const selfItems =
        activeOrders.find((o: any) => o.orderNo === mo.orderNo)?.totalItems ??
        mo.totalItems;
      return { ...mo, waitMinutes: itemsBefore * 5 + selfItems * 5 };
    });
    setMyOrders(updated);
    localStorage.setItem(localKey, JSON.stringify(updated));
  }, [activeOrders, myOrders.length, localKey]);

  /* ---------- 自分の注文完了通知 ---------- */
  useEffect(() => {
    if (!myOrders.length) return;
    const unsubs = myOrders.map((mo) => {
      const ref = doc(db, "orders", mo.docId);
      return onSnapshot(ref, (snap) => {
        const data = snap.data();
        if (data?.isComp && !mo.notified) {
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

  useEffect(() => {
    if (!myOrders.length) return;
    const unsubs = myOrders.map((mo) => {
      const ref = doc(db, "orders", mo.docId);
      return onSnapshot(ref, (snap) => {
        const data = snap.data();
        if (data?.isComp && !mo.notified) {
          // ★ 通知を出す
          notifyUser(mo.orderNo);

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
  }, [myOrders, localKey, notifSupported]);

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

      // ★ ここでトークンを取得
      const fcmToken =
        typeof window !== "undefined" ? localStorage.getItem("fcmToken") : null;

      // 現在の未完了注文を取得（待ち時間などの計算用）
      const snap = await getDocs(
        query(
          collection(db, "orders"),
          where("siteKey", "==", key),
          where("isComp", "==", false),
          orderBy("orderNo", "asc")
        )
      );
      const current = snap.docs.map((d) => d.data());

      // 採番
      const orderNo = await getNextOrderNoForSite(key);

      // 注文アイテムを作成
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

      const itemsBefore = current.reduce(
        (s: number, o: any) => s + (o.totalItems || 0),
        0
      );
      const waitMin = itemsBefore * 5 + totalItemsLocal * 5;

      // ★ 注文保存時に customerFcmToken を一緒に保存
      const ref = await addDoc(collection(db, "orders"), {
        siteKey: key,
        orderNo,
        items,
        totalItems: totalItemsLocal,
        totalPrice: totalPriceLocal,
        isComp: false,
        createdAt: serverTimestamp(),
        customerFcmToken: fcmToken ?? null, // ← 追加
      });

      // ローカルの自分の注文情報を更新
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

      // カートをリセット & 完了モーダル
      setQty(Object.fromEntries(products.map((p) => [p.productId, 0])));
      setDoneOpen(true);
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました。通信状況をご確認ください。");
    } finally {
      setSubmitting(false);
    }
  };

  // 先頭のローディング判定
  if (!productsReady) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
      </main>
    );
  }

  /* ---------- UI ---------- */
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
    <main className="mx-auto max-w-md px-3 pb-28 pt-4">
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
          {/* ヘッダー（現在番号 & 待ち時間） */}
          <div className="rounded-md bg-gradient-to-r from-teal-500 to-pink-500 p-3 text-white shadow">
            {currentNo > 0 ? (
              <>
                <div className="flex items-center justify-center gap-2 text-[17px] font-bold">
                  <span>現在作成中の注文番号:</span>
                  <span>{currentNo}</span>
                </div>
                {/* <p className="mt-1 text-center font-bold">{waitTimeText}</p> */}
              </>
            ) : (
              <p className="py-3 text-center text-[17px] font-bold">
                すぐにお作りできます！
              </p>
            )}
          </div>

          {notifSupported && !notifGranted && (
            <>
              <button
                type="button"
                onClick={() => setAskNotif(true)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                🔔 完成時に通知を受け取る（通知をON）
              </button>

              {/* ボタン押下時にだけ走る */}
              <FcmInit
                run={askNotif}
                onToken={() => {
                  setNotifGranted(true);
                  setAskNotif(false); // 1回走ったら停止
                }}
              />
            </>
          )}

          {/* セクションピッカー（セクションがあるときだけ表示） */}
          {sections.length > 0 && (
            <div className="mt-3">
              <label className="block text-sm mb-1">セクション</label>
              <select
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="h-10 w-full rounded-md border px-2"
              >
                <option value={ALL_SECTIONS}>全セクション</option>
                {/* ← 追加 */}
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
                  {remaining > 0 && (
                    <p className="text-sm text-gray-600">
                      約 {o.waitMinutes ?? 0} 分ほどで出来上がります
                    </p>
                  )}
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
                      <div className="absolute left-0 top-0 z-10 h-7 w-full bg-red-600/90 text-center text-xs font-bold text-white">
                        <span className="leading-7">SOLD OUT</span>
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
  children: React.ReactNode;
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
