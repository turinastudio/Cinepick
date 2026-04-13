export function setCache(res, value = "max-age=86400, stale-while-revalidate=86400, stale-if-error=259200") {
  res.header("Cache-Control", value);
}

export function json(res, payload, cacheControl) {
  if (cacheControl) {
    setCache(res, cacheControl);
  }
  res.json(payload);
}

export function serverError(res, error) {
  res.status(500);
  res.json({
    error: "Internal server error",
    details: error instanceof Error ? error.message : String(error)
  });
}
