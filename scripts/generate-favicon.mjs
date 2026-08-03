import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourcePath = path.join(projectRoot, "public", "favicon.svg");
const outputPath = path.join(projectRoot, "public", "favicon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const source = await readFile(sourcePath);
const images = await Promise.all(
  sizes.map((size) =>
    sharp(source, { density: 384 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ),
);

const directorySize = 6 + images.length * 16;
const header = Buffer.alloc(directorySize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let imageOffset = directorySize;
images.forEach((image, index) => {
  const entryOffset = 6 + index * 16;
  const size = sizes[index];
  header.writeUInt8(size === 256 ? 0 : size, entryOffset);
  header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  header.writeUInt8(0, entryOffset + 2);
  header.writeUInt8(0, entryOffset + 3);
  header.writeUInt16LE(1, entryOffset + 4);
  header.writeUInt16LE(32, entryOffset + 6);
  header.writeUInt32LE(image.length, entryOffset + 8);
  header.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += image.length;
});

await writeFile(outputPath, Buffer.concat([header, ...images]));
console.log(
  `Generated ${path.relative(projectRoot, outputPath)} from favicon.svg`,
);
