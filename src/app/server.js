import http from "node:http";
import { handleAddonRequest } from "./handler.js";

// ── Configuration ──────────────────────────────────────────────
const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

// ── HTTP Server ────────────────────────────────────────────────
const server = http.createServer((req, res) => handleAddonRequest(req, res, { host, port }));

// ── Start server ───────────────────────────────────────────────
server.listen(port, host, () => {
  console.log(`Addon disponible en http://${host}:${port}/manifest.json`);
});

// ── Graceful shutdown ──────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err.message);
      process.exit(1);
    }
    console.log("Server closed. Exiting.");
    process.exit(0);
  });

  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error("Forced exit after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
