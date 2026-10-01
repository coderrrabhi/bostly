// Pre-compresses the production bundle once at build time so the static server
// can hand out .br/.gz variants without spending CPU per request.
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const root = path.resolve(import.meta.dirname, "../dist/public");
const compressible = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".webmanifest", ".txt", ".xml"]);
const minBytes = 1024;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let files = 0;
let original = 0;
let brotliTotal = 0;
for await (const file of walk(root)) {
  if (!compressible.has(path.extname(file))) continue;
  const source = await fs.readFile(file);
  if (source.length < minBytes) continue;
  const [br, gz] = await Promise.all([
    brotli(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
    gzipAsync(source, { level: 9 }),
  ]);
  await Promise.all([fs.writeFile(`${file}.br`, br), fs.writeFile(`${file}.gz`, gz)]);
  files += 1;
  original += source.length;
  brotliTotal += br.length;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`[compress-dist] ${files} files: ${kb(original)} -> ${kb(brotliTotal)} brotli`);
