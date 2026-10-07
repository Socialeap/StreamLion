import { handleCredits } from "../../../server/stripe-credits.js";
export const onRequest = (context) =>
  context.params.path?.length ? handleCredits(context) : context.next();
