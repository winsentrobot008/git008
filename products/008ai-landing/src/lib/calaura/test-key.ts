/**
 * QA test-key channel for /api/calaura/recognize (client half).
 *
 * The server unlocks its privileged path only when the presented key matches
 * CALORIE_TEST_KEY, an environment variable that never reaches the browser.
 * This module captures the key from a `?test_key=` landing URL, remembers it in
 * localStorage so it survives navigation, and hands it back as a request header.
 *
 * The key is stripped from the address bar immediately after capture: a
 * privileged secret left in the URL leaks through history, screenshots, shared
 * links and outbound referrers.
 */

export const TEST_KEY_HEADER = "x-calaura-test-key";
export const TEST_KEY_PARAM = "test_key";

const STORAGE_KEY = "008ai:calaura:test-key";

/**
 * Reads the stored test key, first promoting one offered in the current URL.
 * Returns an empty string when no key is on file, so callers can treat "no key"
 * and "empty key" identically.
 */
export function readTestKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const offered = new URLSearchParams(window.location.search).get(TEST_KEY_PARAM)?.trim();
    if (offered) {
      window.localStorage.setItem(STORAGE_KEY, offered);
      const url = new URL(window.location.href);
      url.searchParams.delete(TEST_KEY_PARAM);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return offered;
    }
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || "";
  } catch {
    // Private mode or a locked-down browser: run as an ordinary anonymous user.
    return "";
  }
}

/** Request headers for a recognize call: empty unless a key is on file. */
export function testKeyHeaders(): Record<string, string> {
  const key = readTestKey();
  return key ? { [TEST_KEY_HEADER]: key } : {};
}
