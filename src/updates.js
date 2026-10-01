let ready = false;
let apply = () => {};
const listeners = new Set();
export const updateReady = () => ready;
export function subscribeUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function offerUpdate(handler) {
  apply = handler;
  ready = true;
  listeners.forEach((listener) => listener());
}
export const applyUpdate = () => apply();
