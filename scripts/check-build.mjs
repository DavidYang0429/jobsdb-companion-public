import { readFile, access, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const m = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.equal(m.manifest_version, 3);
assert.equal(m.minimum_chrome_version, "120");
assert(!m.action.default_popup);
for (const path of [
  m.background.service_worker,
  m.side_panel.default_path,
  m.options_ui.page,
  ...m.content_scripts.flatMap((c) => c.js),
  "gas/Code.gs",
])
  await access(`dist/${path}`);
for (const [size, path] of Object.entries(m.icons)) {
  const b = await readFile(`dist/${path}`);
  assert.equal(b.readUInt32BE(16), Number(size));
  assert.equal(b.readUInt32BE(20), Number(size));
}
console.log("Manifest, entrypoints, GAS and PNG dimensions verified.");

for (const name of [
  "Inter-Regular.ttf",
  "NotoSansSC-Regular.ttf",
  "NotoSansTC-Regular.ttf",
]) {
  const bytes = await readFile(`dist/fonts/pdf-v1/${name}`);
  assert.equal(
    bytes.readUInt32BE(0),
    0x00010000,
    `Invalid bundled TrueType font: ${name}`,
  );
}
console.log("Offline PDF fonts verified.");

assert(m.content_security_policy.extension_pages.includes("worker-src 'self'"));
const assets = await readdir("dist/assets");
assert(assets.some((name) => /^pdf\.worker\.min-.*\.mjs$/.test(name)));
assert(assets.some((name) => /^resumePdfReader-.*\.js$/.test(name)));
for (const path of [
  "pdfjs-assets/cmaps/Adobe-GB1-UCS2.bcmap",
  "pdfjs-assets/standard_fonts/FoxitSerif.pfb",
  "licenses/PDFjs-Apache-2.0.txt",
])
  await access(`dist/${path}`);
console.log("Local resume PDF reader, worker, resources and license verified.");
