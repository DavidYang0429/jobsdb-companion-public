import { cp, mkdir, copyFile } from "node:fs/promises";
await mkdir("public/pdfjs-assets", { recursive: true });
for (const folder of ["cmaps", "standard_fonts"])
  await cp(
    `node_modules/pdfjs-dist/${folder}`,
    `public/pdfjs-assets/${folder}`,
    { recursive: true },
  );
await copyFile(
  "node_modules/pdfjs-dist/LICENSE",
  "public/licenses/PDFjs-Apache-2.0.txt",
);
