import { handlePurchase } from "../../../server/stripe-purchase.js";
export const onRequest = (context) =>
  context.params.path?.length ? handlePurchase(context) : context.next();
