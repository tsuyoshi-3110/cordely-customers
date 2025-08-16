"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useSetAtom, useAtom, useAtomValue } from "jotai";
import { siteKeyAtom } from "@/lib/atoms/siteKeyAtom";
import { addToCartAtom, cartAtom, cartTotalPriceAtom, cartTotalQtyAtom, clearCartAtom } from "@/lib/atoms/cartAtom";
import type { Product } from "@/lib/types";
import { toInclusive } from "@/lib/price";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  addDoc,
  serverTimestamp,
  doc,
  runTransaction,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function CustomerMenuPage() {
  const params = useParams<{ siteKey: string }>();
  const setSiteKey = useSetAtom(siteKeyAtom);
  const sk = params.siteKey;

  const [items, setItems] = useAtom(cartAtom);
  const addToCart = useSetAtom(addToCartAtom);
  const clearCart = useSetAtom(clearCartAtom);
  const totalQty = useAtomValue(cartTotalQtyAtom);
  const totalPrice = useAtomValue(cartTotalPriceAtom);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // URL から siteKey を jotai に反映
  useEffect(() => {
    if (sk) setSiteKey(sk);
  }, [sk, setSiteKey]);

  // siteKey で商品購読（公開用コレクション例：products）
  useEffect(() => {
    if (!sk) return;
    const qy = query(
      collection(db, "products"),
      where("siteKey", "==", sk),
      orderBy("productId", "asc")
    );
    const unsub = onSnapshot(qy, (snap) => {
      const arr: Product[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          docId: d.id,
          productId: Number(data.productId ?? 0),
          name: data.name,
          price: Number(data.price ?? 0),
          taxIncluded: Boolean(data.taxIncluded ?? true),
          imageUri: data.imageUri,
          description: data.description || "",
          soldOut: Boolean(data.soldOut ?? false),
          siteKey: sk,
        };
      });
      setProducts(arr);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [sk]);

  const displayPrice = (p: Product) => toInclusive(p.price, p.taxIncluded);

  // 注文番号の採番（counters/{siteKey}.orderSeq を +1）
  const getNextOrderNo = async (siteKey: string) => {
    const cntrRef = doc(db, "counters", siteKey);
    const next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(cntrRef);
      const cur = snap.exists() ? (snap.data().orderSeq as number) : 0;
      const val = cur + 1;
      if (!snap.exists()) {
        tx.set(cntrRef, { orderSeq: val });
      } else {
        tx.update(cntrRef, { orderSeq: val });
      }
      return val;
    });
    return next;
  };

  const placeOrder = async () => {
    if (!sk) return;
    if (items.length === 0) {
      toast.warning("カートが空です");
      return;
    }
    try {
      const orderNo = await getNextOrderNo(sk);
      await addDoc(collection(db, "orders"), {
        siteKey: sk,
        orderNo,
        items: items.map((l) => ({
          name: l.name,
          quantity: l.qty,
          subtotal: l.price * l.qty,
        })),
        totalItems: items.reduce((s, l) => s + l.qty, 0),
        totalPrice: items.reduce((s, l) => s + l.price * l.qty, 0),
        isComp: false,
        createdAt: serverTimestamp(),
      });
      clearCart();
      toast.success(`ご注文を受け付けました（No. ${orderNo}）`);
    } catch (e) {
      console.error(e);
      toast.error("注文に失敗しました。時間をおいて再度お試しください。");
    }
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] grid place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-md px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">メニュー</h1>

      {/* 商品グリッド */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {products.map((p) => {
          const price = displayPrice(p);
          const disabled = p.soldOut;
        return (
          <Card key={p.docId} className="overflow-hidden">
            <div className="relative aspect-square">
              <Image
                src={p.imageUri}
                alt={p.name}
                fill
                className="object-cover"
                sizes="(max-width:640px) 50vw, 33vw"
              />
              {disabled && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <Badge variant="secondary" className="text-base">売切</Badge>
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="line-clamp-1 text-sm font-medium">{p.name}</p>
              <p className="text-sm text-gray-600">¥{price.toLocaleString()}</p>
              <Button
                disabled={disabled}
                onClick={() => addToCart({ product: p, displayPrice: price })}
                className="mt-2 w-full"
              >
                追加
              </Button>
            </div>
          </Card>
        )})}
      </div>

      {/* カート */}
      <div className="fixed bottom-4 right-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button className="shadow-lg">
              カート ({totalQty}) ¥{totalPrice.toLocaleString()}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-96 max-w-[95vw]">
            <SheetHeader>
              <SheetTitle>ご注文内容</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-3">
              {items.length === 0 && <p className="text-sm text-gray-500">カートは空です</p>}
              {items.map((l) => (
                <div key={l.docId} className="flex items-center justify-between rounded border p-2">
                  <div>
                    <p className="text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-gray-600">¥{l.price.toLocaleString()} × {l.qty}</p>
                  </div>
                  <p className="text-sm font-semibold">¥{(l.price * l.qty).toLocaleString()}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm">合計点数</p>
                <p className="text-sm font-medium">{totalQty}</p>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-base font-medium">合計金額</p>
                <p className="text-base font-bold">¥{totalPrice.toLocaleString()}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="w-1/3" onClick={() => clearCart()}>
                  クリア
                </Button>
                <Button className="w-2/3" disabled={items.length === 0} onClick={placeOrder}>
                  注文する
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </main>
  );
}
