import axios from "axios";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br"
};

const cookieJar = new Map();
const REQUEST_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.WEBSTREAM_HTTP_TIMEOUT_MS || "15000", 10) || 15000
);

function mergeHeaders(headers) {
  return { ...DEFAULT_HEADERS, ...(headers || {}) };
}

function getCookieHeader(url) {
  const hostname = new URL(url).hostname;
  return cookieJar.get(hostname) || "";
}

function storeCookies(url, response) {
  const hostname = new URL(url).hostname;
  const existing = cookieJar.get(hostname) || "";
  const cookieMap = new Map();

  if (existing) {
    existing.split(/;\s*/).forEach((pair) => {
      const [name, ...rest] = pair.split("=");
      if (!name || !rest.length) {
        return;
      }

      cookieMap.set(name.trim(), rest.join("=").trim());
    });
  }

  const setCookie = response.headers?.["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  cookies.forEach((cookie) => {
    const pair = String(cookie).split(";")[0];
    const [name, ...rest] = pair.split("=");
    if (!name || !rest.length) {
      return;
    }

    cookieMap.set(name.trim(), rest.join("=").trim());
  });

  if (cookieMap.size > 0) {
    cookieJar.set(
      hostname,
      Array.from(cookieMap.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ")
    );
  }
}

async function issueRequest(url, options = {}) {
  const cookieHeader = getCookieHeader(url);
  const response = await axios({
    url,
    method: options.method || "GET",
    headers: mergeHeaders({
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(options.headers || {})
    }),
    data: options.body,
    responseType: options.responseType || "text",
    maxRedirects: 5,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true
  });

  storeCookies(url, response);
  return response;
}

async function warmHost(url, headers) {
  const parsed = new URL(url);
  await issueRequest(parsed.origin, {
    headers: {
      Referer: parsed.origin,
      ...(headers || {})
    }
  }).catch(() => null);
}

export async function fetchPage(url, options = {}) {
  let response = await issueRequest(url, options);

  if (response.status === 403 && !options._warmed) {
    await warmHost(url, options.headers);
    response = await issueRequest(url, { ...options, _warmed: true });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} para ${url}`);
  }

  return {
    text: typeof response.data === "string" ? response.data : String(response.data || ""),
    url: response.request?.res?.responseUrl || response.config?.url || url,
    headers: response.headers || {}
  };
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  const response = await issueRequest(url, { ...options, responseType: "json" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} para ${url}`);
  }

  return response.data;
}
