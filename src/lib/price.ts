const TAX_RATE = 0.1 as const;

export const toInclusive = (p: number, taxIncluded: boolean) =>
  taxIncluded ? p : Math.round(p * (1 + TAX_RATE));

export const toExclusive = (p: number, taxIncluded: boolean) =>
  taxIncluded ? Math.round(p / (1 + TAX_RATE)) : p;
