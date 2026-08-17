import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";

const indexPath = join(process.cwd(), "dist", "mainview", "index.html");
const html = await readFile(indexPath, "utf8");
const sources = [
  ...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g),
]
  .map((match) => match[1]!)
  .filter((value, index, all) => all.indexOf(value) === index);
let total = 0;
for (const source of sources) {
  const bytes = await readFile(
    join(dirname(indexPath), source.replace(/^\//, "")),
  );
  total += gzipSync(bytes).byteLength;
}
process.stdout.write(
  `${JSON.stringify({ initialJsGzipBytes: total, limit: 250_000, sources })}\n`,
);
if (total >= 250_000) process.exitCode = 1;
