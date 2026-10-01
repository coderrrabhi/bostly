import app from "./app";
import { logger } from "./lib/logger";
import { startMultiProviderRotationWorkers } from "./workers/multiProviderRotationWorker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startMultiProviderRotationWorkers();
});

// Keep upstream connections from the platform proxy open longer than its own
// idle timeout, so requests reuse warm sockets instead of re-handshaking, and
// so the proxy never sends a request on a socket we are simultaneously closing.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
