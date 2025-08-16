import { atom } from "jotai";
import type { Product } from "@/lib/types";

export type CartLine = {
  docId: string;
  name: string;
  price: number;       // 表示用の最終価格（例：税込）
  qty: number;
};

export const cartAtom = atom<CartLine[]>([]);

export const addToCartAtom = atom(null, (get, set, p: { product: Product; displayPrice: number }) => {
  const cur = get(cartAtom);
  const idx = cur.findIndex((l) => l.docId === p.product.docId);
  if (idx >= 0) {
    const next = [...cur];
    next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
    set(cartAtom, next);
  } else {
    set(cartAtom, [...cur, { docId: p.product.docId, name: p.product.name, price: p.displayPrice, qty: 1 }]);
  }
});

export const decFromCartAtom = atom(null, (get, set, docId: string) => {
  const cur = get(cartAtom);
  const idx = cur.findIndex((l) => l.docId === docId);
  if (idx < 0) return;
  const line = cur[idx];
  if (line.qty <= 1) {
    set(cartAtom, cur.filter((l) => l.docId !== docId));
  } else {
    const next = [...cur];
    next[idx] = { ...line, qty: line.qty - 1 };
    set(cartAtom, next);
  }
});

export const clearCartAtom = atom(null, (_get, set) => set(cartAtom, []));
export const cartTotalQtyAtom = atom((get) => get(cartAtom).reduce((s, l) => s + l.qty, 0));
export const cartTotalPriceAtom = atom((get) => get(cartAtom).reduce((s, l) => s + l.price * l.qty, 0));
