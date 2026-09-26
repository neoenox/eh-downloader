// Integration test for convert_images.mjs using real sharp conversions.
// Run: node test_convert_images.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(repoDir, "convert_images.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eh-convert-test-"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = (inputDir, args = []) =>
  spawnSync(process.execPath, [scriptPath, inputDir, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    timeout: 60000,
  });

const makeWebp = async (file, seed = 0) => {
  const width = 32;
  const height = 32;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + seed * 17) % 256;
  await sharp(data, { raw: { width, height, channels } }).webp({ quality: 80 }).toFile(file);
};

try {
  // Default PNG conversion.
  const pngInput = path.join(tmp, "png-input");
  fs.mkdirSync(pngInput);
  await makeWebp(path.join(pngInput, "sample.webp"));

  let result = run(pngInput, ["--parallel", "1"]);
  assert(result.status === 0, `PNG conversion failed: ${result.stderr}\n${result.stdout}`);
  const pngOut = path.join(pngInput, "png", "sample.png");
  assert(fs.existsSync(pngOut), "PNG output was not created");
  assert((await sharp(pngOut).metadata()).format === "png", "PNG output format mismatch");

  // Existing output is skipped unless --force is supplied.
  result = run(pngInput, ["--parallel", "1"]);
  assert(result.status === 0 && /スキップ1/.test(result.stdout), "existing output was not skipped");

  result = run(pngInput, ["--parallel", "1", "--force"]);
  assert(result.status === 0 && /変換1/.test(result.stdout) && /スキップ0/.test(result.stdout), "--force did not reconvert");

  // JPEG conversion accepts --quality and custom --out.
  const jpegInput = path.join(tmp, "jpeg-input");
  const jpegOutDir = path.join(tmp, "custom-jpeg-output");
  fs.mkdirSync(jpegInput);
  await makeWebp(path.join(jpegInput, "photo.webp"), 1);
  result = run(jpegInput, [
    "--format", "jpeg",
    "--quality", "37",
    "--out", jpegOutDir,
    "--parallel", "1",
  ]);
  assert(result.status === 0, `JPEG conversion failed: ${result.stderr}\n${result.stdout}`);
  const jpegOut = path.join(jpegOutDir, "photo.jpg");
  assert(fs.existsSync(jpegOut), "custom JPEG output was not created");
  assert((await sharp(jpegOut).metadata()).format === "jpeg", "JPEG output format mismatch");

  // --del removes source only after a successful conversion.
  const delInput = path.join(tmp, "del-input");
  fs.mkdirSync(delInput);
  const delSource = path.join(delInput, "delete-me.webp");
  await makeWebp(delSource, 2);
  result = run(delInput, ["--del", "--parallel", "1"]);
  assert(result.status === 0, `--del conversion failed: ${result.stderr}\n${result.stdout}`);
  assert(!fs.existsSync(delSource), "--del did not remove successfully converted source");
  assert(fs.existsSync(path.join(delInput, "png", "delete-me.png")), "--del output is missing");

  // Corrupt input is reported as a conversion failure, not a successful conversion.
  const badInput = path.join(tmp, "bad-input");
  fs.mkdirSync(badInput);
  fs.writeFileSync(path.join(badInput, "broken.webp"), Buffer.from("not-a-webp"));
  result = run(badInput, ["--parallel", "1"]);
  assert(result.status === 2, `corrupt WebP should exit 2, got ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert(/失敗1/.test(result.stdout), "corrupt WebP was not counted as failed");

  console.log("PASS: convert_images.mjs integration coverage");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
