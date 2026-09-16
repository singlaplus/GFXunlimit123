export const AUTH_BUSY_START = "auth-busy-start";
export const AUTH_BUSY_END = "auth-busy-end";

export function dispatchAuthBusyStart(type) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_BUSY_START, { detail: { type } }));
}

export function dispatchAuthBusyEnd() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_BUSY_END));
}
