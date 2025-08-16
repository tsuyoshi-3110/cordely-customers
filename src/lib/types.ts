export type Product = {
  docId: string;
  productId: number;
  name: string;
  price: number;        // 保存されている基準価格
  taxIncluded: boolean; // 価格が税込か
  imageUri: string;
  description?: string;
  soldOut?: boolean;
  siteKey?: string;
};
