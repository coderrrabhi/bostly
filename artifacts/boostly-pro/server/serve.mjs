// Production static server for the built SPA.
//
// Replaces the platform's default static handler, which sent every asset
// uncompressed with no caching headers. Here hashed assets are immutable for a
// year, index.html is revalidated with an ETag, and pre-compressed brotli/gzip
// variants (see scripts/compress-dist.mjs) are served when the browser accepts them.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import sirv from "sirv";

const root = path.resolve(import.meta.dirname, "../dist/public");
if (!existsSync(path.join(root, "index.html"))) {
  throw new Error(`No build found at ${root}. Run "pnpm --filter @workspace/boostly-pro run build" first.`);
}

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT environment variable is required but was "${process.env.PORT ?? ""}".`);
}

const ONE_YEAR = 60 * 60 * 24 * 365;

const serve = sirv(root, {
  brotli: true,
  gzip: true,
  etag: true,
  single: true,
  maxAge: ONE_YEAR,
  immutable: true,
  setHeaders(res, pathname) {
    if (pathname.startsWith("/assets/")) return; // content-hashed: keep immutable
    const hasExtension = /\.[a-z0-9]+$/i.test(pathname) && !pathname.endsWith(".html");
    // Public files (icons, manifest, sitemap) may change between releases;
    // the HTML shell must always be revalidated so a new release is picked up.
    res.setHeader("Cache-Control", hasExtension ? "public, max-age=3600, must-revalidate" : "no-cache");
  },
});

const server = createServer((req, res) => {
  serve(req, res, () => {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  });
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(port, "0.0.0.0", () => {
  console.log(`[boostly-pro] serving ${root} on port ${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
