export function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

export function notFound(res, message = "Not found") {
  json(res, 404, { error: message });
}

export function serverError(res, error) {
  json(res, 500, {
    error: "Internal server error",
    details: error instanceof Error
      ? `${error.message}${error.cause ? ` | cause: ${String(error.cause)}` : ""}`
      : String(error)
  });
}

export async function proxyStream(req, res, targetUrl, targetHeaders = {}) {
  try {
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...targetHeaders
    };

    if (req.headers.range) {
      headers.range = req.headers.range;
    }

    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow"
    });

    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*"
    };

    const copyHeader = (name) => {
      const val = response.headers?.[name] || response.headers?.get?.(name);
      if (val) responseHeaders[name] = val;
    };

    // Forward important headers
    ["content-type", "content-length", "content-range", "accept-ranges"].forEach(copyHeader);

    res.writeHead(response.status, responseHeaders);

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();

    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      return pump();
    };

    pump().catch((err) => {
      console.error("Proxy pump error:", err);
      if (!res.writableEnded) res.end();
    });

    req.on("close", () => {
      reader.cancel();
    });
  } catch (error) {
    serverError(res, error);
  }
}
