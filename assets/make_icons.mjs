#!/usr/bin/env node
// アイコン生成: SVG ソースから複数サイズを含む .ico を作成する (要: sharp)
//
//   node assets/make_icons.mjs
//
// 出力:
//   assets/icon-viewer.ico ... eh-viewer.exe 用 (フォト + 拡大鏡風フレーム)
//   assets/icon-runall.ico ... eh-runall.exe 用 (フォト + ダウンロードバッジ)
//
// .ico は PNG エントリ形式 (Vista 以降で対応) で自前で組み立てる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "assets");

// ---------- 共通パーツ ----------
// 角丸のベース板 (下に厚みのあるフォトスタック)
const base = (fill, stroke) => `
  <rect x="14" y="20" width="100" height="82" rx="10" fill="${stroke}" opacity="0.55"/>
  <rect x="10" y="14" width="100" height="82" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="6"/>`;

// 山と太陽のプレースホルダー画像
const scenery = `
  <circle cx="42" cy="40" r="10" fill="#ffd54f"/>
  <path d="M 20 82 L 46 52 L 64 72 L 78 58 L 100 82 Z" fill="#66bb6a"/>
  <path d="M 20 82 L 40 60 L 52 74 Z" fill="#43a047" opacity="0.85"/>`;

// ダウンロードバッジ (runall 用)
const dlBadge = `
  <circle cx="94" cy="84" r="26" fill="#1e88e5" stroke="#ffffff" stroke-width="5"/>
  <path d="M 94 70 L 94 92 M 84 83 L 94 94 L 104 83" stroke="#ffffff" stroke-width="8"
        stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

// 拡大レンズ風アクセント (viewer 用)
const lensBadge = `
  <circle cx="92" cy="82" r="22" fill="none" stroke="#26c6da" stroke-width="9" opacity="0.95"/>
  <circle cx="92" cy="82" r="14" fill="#4dd0e1" opacity="0.35"/>
  <path d="M 108 98 L 122 112" stroke="#26c6da" stroke-width="12" stroke-linecap="round"/>`;

const svgFor = (accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  ${base("#37474f", "#263238")}
  ${scenery}
  ${accent}
</svg>`;

// ---------- ICO 组み立て ----------
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function makeIco(svg, outFile) {
  const pngs = [];
  for (const size of SIZES) {
    const png = await sharp(Buffer.from(svg), { density: 96 * (256 / size) })
      .resize(size, size)
      .png()
      .toBuffer();
    pngs.push({ size, png });
  }
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes x N) + PNG blobs
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = Buffer.alloc(16 * pngs.length);
  let offset = 6 + 16 * pngs.length;
  pngs.forEach(({ size, png }, i) => {
    const e = entries.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
  });
  fs.writeFileSync(outFile, Buffer.concat([header, entries, ...pngs.map((p) => p.png)]));
  console.log("生成:", path.relative(rootDir, outFile), `(${SIZES.join(", ")})`);
}

fs.mkdirSync(outDir, { recursive: true });
await makeIco(svgFor(lensBadge), path.join(outDir, "icon-viewer.ico"));
await makeIco(svgFor(dlBadge), path.join(outDir, "icon-runall.ico"));
console.log("完了");
