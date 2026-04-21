import { BadRequestError, ProxyError } from "../errors.js";
import { json, proxyStream } from "../../lib/http.js";

/**
 * Proxy router: handles /p/<payload> route.
 * Validates the payload before proxying to prevent abuse.
 */

function validateProxyPayload(encodedPayload) {
  if (!encodedPayload || typeof encodedPayload !== "string") {
    throw new BadRequestError("Missing proxy payload");
  }

  // Basic format validation: should be a valid base64url string
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) {
    throw new BadRequestError("Invalid proxy payload format");
  }

  return true;
}

function parseProxyPayload(encodedPayload) {
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"));

    if (!decoded.url || typeof decoded.url !== "string") {
      throw new BadRequestError("Missing target URL in proxy payload");
    }

    // Validate URL format
    try {
      new URL(decoded.url);
    } catch {
      throw new BadRequestError("Invalid target URL format");
    }

    return {
      url: decoded.url,
      headers: decoded.headers || {}
    };
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }
    throw new ProxyError("Failed to decode proxy payload", { statusCode: 400 });
  }
}

export async function handleProxy(req, res) {
  const match = req.normalizedPathname.match(/^\/p\/(.+)$/);

  if (!match) {
    return false;
  }

  try {
    const encodedPayload = match[1].replace(/\.(mp4|m3u8|ts|m4s|key|bin)$/i, "");

    validateProxyPayload(encodedPayload);
    const { url, headers } = parseProxyPayload(encodedPayload);

    await proxyStream(req, res, url, headers);
    return true;
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof ProxyError) {
      json(res, error.statusCode || 400, {
        error: error.message || "Proxy error",
        code: error.code || "PROXY_ERROR"
      });
      return true;
    }
    // Re-throw for global error handler
    throw error;
  }
}
