export const TM_ESTIMATE = "tm-spatial-2026-10";
export function captureEstimate(profile, area, creative = false) {
  if (
    profile !== TM_ESTIMATE ||
    !/^\d{1,9}$/.test(String(area)) ||
    Number(area) <= 0
  )
    return null;
  const sqft = Number(area);
  const rateCents = sqft <= 5000 ? 15 : sqft < 20000 ? 12 : 10;
  const captureCents = sqft * rateCents;
  const creativeCents = creative ? 90000 : 0;
  return {
    profile,
    sqft,
    rateCents,
    captureCents,
    creativeCents,
    totalCents: captureCents + creativeCents,
    currency: "USD",
  };
}
export const estimateMoney = (cents, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );
