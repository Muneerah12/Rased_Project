// Address of the Rasid server. Empty (the default) means the origin that serves this page, as when the
// Python server serves web/dist. A UI hosted elsewhere is built with VITE_API_BASE=https://<server>.
export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');

/** A server path ("/api/...") on API_BASE; any other URL (blob:, data:, https:) is returned unchanged. */
export function apiUrl(url: string): string {
  return API_BASE && url.startsWith('/api/') ? API_BASE + url : url;
}

/** WebSocket URL of a server path on API_BASE (or on this page's origin). */
export function apiWsUrl(path: string): string {
  const base = API_BASE ? new URL(API_BASE) : location;
  return `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}${path}`;
}

/** Sends every fetch('/api/...') to API_BASE, so the call sites keep their relative paths. */
export function routeApiFetches(): void {
  if (!API_BASE || typeof window === 'undefined') return;
  const send = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => send(typeof input === 'string' ? apiUrl(input) : input, init);
}
