import path from "node:path";
import { existsSync } from "node:fs";
import sirv from "sirv";
import app from "./app";
import { logger } from "./lib/logger";
import { startMultiProviderRotationWorkers } from "./workers/multiProviderRotationWorker";

const port = Number(process.env["PORT"] ?? 3000);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

// In production, also serve the built frontend so one process runs the whole site.
const staticDir = path.resolve(
  process.env["STATIC_DIR"] ?? path.join(process.cwd(), "../artifacts/boostly-pro/dist/public"),
);
if (existsSync(path.join(staticDir, "index.html"))) {
  app.use(sirv(staticDir, { single: true, brotli: true, gzip: true, etag: true }));
  logger.info({ staticDir }, "Serving frontend build");
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  if (process.env["DISABLE_WORKERS"] !== "true") startMultiProviderRotationWorkers();
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
