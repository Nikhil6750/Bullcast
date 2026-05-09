export const DEMO_ENTRY_KEY = "bullcast_demo_entered";

export function hasEnteredLocalDemo() {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return window.localStorage.getItem(DEMO_ENTRY_KEY) === "true";
}

export function enterLocalDemoMode() {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(DEMO_ENTRY_KEY, "true");
}

export function clearLocalDemoMode() {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(DEMO_ENTRY_KEY);
}
