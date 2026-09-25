#!/usr/bin/env node
/**
 * WebP → PNG/JPEG 一括変換バッチ (要: sharp)
 *
 * 使い方:
 *   node convert_images.mjs <画像ディレクトリ> [オプション]
 *
 * 例:
 *   node convert_images.mjs "3553112_badpeach - Asta (Honkai Star Rail) AI Generated"
 *   node convert_images.mjs ./pics --format jpeg --quality 90
 *   node convert_images.mjs ./pics --format png --out ./png_out
 *
 * オプション:
 *   --format F      出力形式: png / jpeg (jpg) (デフォルト: png)
 *   --quality N     JPEG品質 1-100 (デフォルト: 90, PNGでは無視)
 *   --out DIR       出力先 (デフォルト: <入力DIR>/png または <入力DIR>/jpeg)
 *   --parallel N    同時変換数 (デフォルト: CPUコア数, 最大4)
 *   --force         出力済みファイルも再変換する
 *   --del           変換成功後に元のWebPを削除 (慎重に!)
 *   --help          ヘルプ表示
 *
 * 注意: PNG はロスレスなのでファイルが大きくなります (WebPの数倍〜)。
 *       サイズ重視なら --format jpeg --quality 90 を推奨。
 *       出力先に同名の正常なファイルがあればスキップします (再実行OK)。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

sharp.cache(false);

// ---------- 引数解析 ----------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n");
  const end = lines.findIndex((l) => l.trim() === "*/");
  console.log(lines.slice(1, end).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  process.exit(args.length === 0 ? 1 : 0);
}

const VALUE_FLAGS = new Set(["--format", "--quality", "--out", "--parallel"]);
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (VALUE_FLAGS.has(args[i])) { i++; continue; }
  if (args[i].startsWith("--")) continue;
  positionals.push(args[i]);
}

const inDir = positionals[0];
const fmtArg = (() => {
  const i = args.indexOf("--format");
  return i !== -1 ? args[i + 1].toLowerCase() : "png";
})();
const format = fmtArg === "jpg" ? "jpeg" : fmtArg;
const qualityIdx = args.indexOf("--quality");
const quality = qualityIdx !== -1 ? Math.min(100, Math.max(1, parseInt(args[qualityIdx + 1], 10) || 90)) : 90;
const outIdx = args.indexOf("--out");
const force = args.includes("--force");
const del = args.includes("--del");
const parallelIdx = args.indexOf("--parallel");
const parallel = Math.max(1, Math.min(8, parallelIdx !== -1 ? parseInt(args[parallelIdx + 1], 10) || os.cpus().length : Math.min(os.cpus().length, 4)));

// ---------- バリデーション ----------
if (format !== "png" && format !== "jpeg") {
  console.error("エラー: --format は png または jpeg を指定してください");
  process.exit(1);
}
if (!inDir || !fs.existsSync(inDir) || !fs.statSync(inDir).isDirectory()) {
  console.error(`エラー: 入力ディレクトリが不正です: ${inDir || "(未指定)"}`);
  process.exit(1);
}

const ext = format === "jpeg" ? ".jpg" : ".png";
const outDir = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(path.resolve(inDir), format);
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter((f) => /\.webp$/i.test(f) && fs.statSync(path.join(inDir, f)).isFile()).sort();
if (files.length === 0) {
  console.error(`エラー: ${inDir} にWebPファイルがありません`);
  process.exit(1);
}

const log = (...a) => console.log(...a);
const fmtKB = (n) => `${(n / 1024).toFixed(0)}KB`;
log(`▶ 変換: ${files.length} ファイル → ${format.toUpperCase()} (同時${parallel})`);
log(`▶ 出力先: ${outDir}${del ? " (変換後に元WebPを削除)" : ""}`);

let done = 0, skipped = 0, failed = 0;
let bytesIn = 0, bytesOut = 0;
const pad = String(files.length).length;
const startedAt = Date.now();

async function convertOne(file) {
  const src = path.join(inDir, file);
  const base = file.replace(/\.webp$/i, "");
  const dest = path.join(outDir, base + ext);

  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    skipped++;
    return;
  }

  let pipe = sharp(src);
  if (format === "jpeg") pipe = pipe.jpeg({ quality, mozjpeg: true });
  else pipe = pipe.png({ compressionLevel: 9 });

  await pipe.toFile(dest);

  const inSize = fs.statSync(src).size;
  const outSize = fs.statSync(dest).size;
  bytesIn += inSize; bytesOut += outSize;
  done++;
  log(`[${String(done + skipped).padStart(pad)}] OK ${file} → ${path.basename(dest)} ${fmtKB(inSize)}→${fmtKB(outSize)}`);

  if (del) fs.unlinkSync(src);
}

// ワーカープール
let cursor = 0;
const worker = async () => {
  for (;;) {
    const i = cursor++;
    if (i >= files.length) return;
    try {
      await convertOne(files[i]);
    } catch (e) {
      failed++;
      log(`[${String(i + 1).padStart(pad)}] 失敗: ${files[i]} - ${e.message}`);
      try { fs.unlinkSync(path.join(outDir, files[i].replace(/\.webp$/i, "") + ext)); } catch {}
    }
  }
};
await Promise.all(Array.from({ length: Math.min(parallel, files.length) }, worker));

const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
log(`\n■ 完了: 変換${done} / スキップ${skipped} / 失敗${failed} / 所要${secs}秒`);
if (done > 0) log(`  合計サイズ: ${fmtKB(bytesIn)} → ${fmtKB(bytesOut)} (${((bytesOut / bytesIn) * 100).toFixed(0)}%) → ${outDir}`);
if (failed > 0) process.exitCode = 2;
