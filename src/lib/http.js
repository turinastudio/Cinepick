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
