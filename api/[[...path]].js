import { handleAddonRequest } from "../src/app/handler.js";

function normalizeServerlessUrl(url = "/") {
  const [pathname, search = ""] = String(url).split("?");
  const normalizedPath = pathname === "/api" || pathname === "/api/"
    ? "/"
    : pathname.startsWith("/api/")
      ? pathname.slice("/api".length)
      : pathname;

  return search ? `${normalizedPath}?${search}` : normalizedPath;
}

export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  req.url = normalizeServerlessUrl(req.url);
  return handleAddonRequest(req, res, {
    host: "127.0.0.1",
    port: 443
  });
}

