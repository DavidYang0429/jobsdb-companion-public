import { build } from "vite";
import { build as bundle } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
await build({ logLevel: "warn", build: { reportCompressedSize: false } });
console.log("UI production bundle built.");
await bundle({
  entryPoints: ["src/background/serviceWorker.ts"],
  outfile: "dist/background.js",
  bundle: true,
  format: "esm",
  target: "chrome120",
});
await bundle({
  entryPoints: ["src/content/jobsdbExtractor.ts"],
  outfile: "dist/content.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
});
const result = await bundle({
  entryPoints: ["src/manifest.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { manifest } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));
await mkdir("dist/gas", { recursive: true });
await copyFile("gas/Code.gs", "dist/gas/Code.gs");
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length);
  t.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return b;
}
for (const size of [16, 48, 128]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const tick =
        (x > size * 0.22 &&
          x < size * 0.43 &&
          Math.abs(y - (0.57 * size + (x - size * 0.32))) < size * 0.065) ||
        (x >= size * 0.4 &&
          x < size * 0.78 &&
          Math.abs(y - (0.63 * size - (x - size * 0.4))) < size * 0.065);
      raw.set(tick ? [255, 255, 255, 255] : [27, 76, 65, 255], i);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await mkdir("dist/icons", { recursive: true });
  await writeFile(`dist/icons/icon-${size}.png`, png);
}
