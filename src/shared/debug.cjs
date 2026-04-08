function createDebugLogger(namespace, enabled) {
  return function debugLog(event, payload = {}) {
    const isEnabled = typeof enabled === "function" ? enabled() : enabled;
    if (!isEnabled) {
      return;
    }

    try {
      console.log(`[${namespace}] ${event} ${JSON.stringify(payload)}`);
    } catch {
      console.log(`[${namespace}] ${event}`);
    }
  };
}

module.exports = {
  createDebugLogger
};
