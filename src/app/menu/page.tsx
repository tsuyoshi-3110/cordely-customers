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
import { useEffect, useMemo, useRef, useState } from "react";

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
  const [qty, setQty] = useState<Record<number, number>>({});
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [currentNo, setCurrentNo] = useState(0);
  const [waitTimeText, setWaitTimeText] = useState("現在の待ち時間: 0分");

  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [lastOrderNo, setLastOrderNo] = useState<number | null>(null);
  const [completedOrderNo, setCompletedOrderNo] = useState<number | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const localKey = siteKey ? `myOrders:${siteKey}` : "myOrders";

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

  /* ---------- 商品一覧（サイトの並び順 sortOrder 優先） ---------- */
  useEffect(() => {
    if (!siteKey) return;

    const qy = query(
      collection(db, "products"),
      where("siteKey", "==", siteKey)
    );

    const unsub = onSnapshot(qy, (snap) => {
      const items = snap.docs.map((d) => {
        const v = d.data() as any;
        const base: Product = {
          productId: Number(v.productId ?? 0),
          name: String(v.name ?? ""),
          price: Number(v.price ?? 0),
          imageUri: String(v.imageUri ?? ""),
          soldOut: Boolean(v.soldOut ?? false),
          description: v.description ? String(v.description) : "",
          taxIncluded: v.taxIncluded == null ? true : Boolean(v.taxIncluded),
          docId: d.id,
        };
        const sortKey =
          typeof v.sortOrder === "number" ? v.sortOrder : base.productId;
        return { base, sortKey };
      });

      items.sort((a, b) => {
        if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
        return a.base.productId - b.base.productId;
      });

      const list = items.map((x) => x.base);
      setProducts(list);

      setQty((prev) => {
        const next = { ...prev };
        list.forEach((p) => {
          if (next[p.productId] == null) next[p.productId] = 0;
        });
        return next;
      });
    });

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
        setWaitTimeText("現在の待ち時間: 0分");
        return;
      }
      const list = snap.docs.map((d) => d.data());
      setActiveOrders(list);
      setCurrentNo(list[0]?.orderNo ?? 0);

      const totalItemsAll = list.reduce(
        (s: number, o: any) => s + (o.totalItems || 0),
        0
      );
      const mins = totalItemsAll * 5;
      setWaitTimeText(
        `現在の待ち時間: 約${Math.floor(mins / 60)}時間${mins % 60}分`
      );
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
      // siteKey を string に絞り込み
      const key = siteKey;
      if (!key) {
        alert(
          "店舗コードが見つかりません。トップに戻ってQRを読み込んでください。"
        );
        return;
      }

      // いまの未完了注文を取得（並びはクライアントでもOKだがここでは orderBy を使用）
      const snap = await getDocs(
        query(
          collection(db, "orders"),
          where("siteKey", "==", key),
          where("isComp", "==", false),
          orderBy("orderNo", "asc")
        )
      );
      const current = snap.docs.map((d) => d.data());

      // 店舗ごとの注文番号を採番
      const orderNo = await getNextOrderNoForSite(key);

      // 選択された商品だけ抽出
      const items = products
        .filter((p) => (qty[p.productId] || 0) > 0)
        .map((p) => ({
          productId: p.productId,
          name: p.name,
          price: p.price,
          quantity: qty[p.productId] || 0,
          subtotal: p.price * (qty[p.productId] || 0),
        }));

      // 数量0なら中断
      if (items.length === 0) {
        alert("数量を入力してください。");
        return;
      }

      const totalItemsLocal = items.reduce((s, it) => s + it.quantity, 0);
      const totalPriceLocal = items.reduce((s, it) => s + it.subtotal, 0);

      // 待ち時間（前にあるアイテム数×5分 + 自分のアイテム×5分）
      const itemsBefore = current.reduce(
        (s: number, o: any) => s + (o.totalItems || 0),
        0
      );
      const waitMin = itemsBefore * 5 + totalItemsLocal * 5;

      // 注文ドキュメント作成
      const ref = await addDoc(collection(db, "orders"), {
        siteKey: key,
        orderNo,
        items,
        totalItems: totalItemsLocal,
        totalPrice: totalPriceLocal,
        isComp: false,
        createdAt: serverTimestamp(),
      });

      // ローカル追跡用に保存
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

      // 数量リセット & 完了モーダル
      setQty(Object.fromEntries(products.map((p) => [p.productId, 0])));
      setDoneOpen(true);
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました。通信状況をご確認ください。");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- UI ---------- */
  if (!products.length) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-3 pb-28 pt-4">
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
                <p className="mt-1 text-center font-bold">{waitTimeText}</p>
              </>
            ) : (
              <p className="py-3 text-center text-[17px] font-bold">
                すぐにお作りできます！
              </p>
            )}
          </div>

          {/* 自分の注文状況（ローカル） */}
          <div className="mt-2 space-y-2">
            {myOrders.map((o) => {
              const remaining = Math.max(o.orderNo - currentNo, 0);
              return (
                <div key={o.orderNo} className="rounded-md bg-blue-50 p-2">
                  <p className="text-teal-700">
                    ご注文番号 {o.orderNo} は{" "}
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

          {/* 商品一覧：2列グリッド／「カートに入れる」ボタン削除 */}
          <div className="mt-6 grid grid-cols-2 gap-6">
            {products.map((p) => {
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
                      ￥{p.price.toLocaleString()}{" "}
                      {p.taxIncluded ? "(税込)" : "(税抜)"}
                    </p>

                    {/* 説明は省スペースのため2行まで（line-clamp がなければ外してOK） */}
                    {p.description && (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-gray-700">
                        {p.description}
                      </p>
                    )}

                    {/* 数量コントロールのみ（カートに入れるボタンは削除） */}
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
                      / ￥{totalPrice.toLocaleString()}
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={openConfirm}
                disabled={submitting}
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
                        {(qty[p.productId] * p.price).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
              <p className="mt-4 text-right text-base font-semibold">
                合計 ￥{totalPrice.toLocaleString()}
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
              title="ご注文ができあがりました！"
            >
              <p className="mb-2 text-center">クレープの完成です 🎉</p>
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
