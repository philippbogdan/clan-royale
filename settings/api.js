const DEFAULT_API_BASE_URL = "http://localhost:3001";

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return DEFAULT_API_BASE_URL;
  }

  const explicitBase = window.__API_BASE_URL;
  if (typeof explicitBase === "string" && explicitBase.trim()) {
    return trimTrailingSlash(explicitBase.trim());
  }

  return DEFAULT_API_BASE_URL;
}

export function getApiUrl(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getApiBaseUrl()}${path}`;
}

export function getDeepgramWsUrl() {
  const baseUrl = new URL(getApiBaseUrl());
  baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  baseUrl.pathname = "/deepgram";
  baseUrl.search = "";
  return baseUrl.toString();
}
