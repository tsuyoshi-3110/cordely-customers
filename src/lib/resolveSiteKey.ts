import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";

/** QRの code から siteKey を取得。見つからなければ null */
export async function resolveSiteKeyByCode(code: string): Promise<string | null> {
  const q = query(
    collection(db, "qrCodes"),
    where("code", "==", code),
    where("active", "==", true),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const doc = snap.docs[0].data() as { siteKey?: string };
  return doc.siteKey ?? null;
}
