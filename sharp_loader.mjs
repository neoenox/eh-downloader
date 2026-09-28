// sharp 読み込みヘルパー (image_viewer.mjs / convert_images.mjs 共通)
//
// SEA (単一exe) では require("sharp") がそのままでは解決できないため、
// 埋め込みアセットから %TEMP%\eh-viewer-assets-<hash>\ へ node_modules
// レイアウトで展開し、そこから require する。
//
// 探索順: SEA埋め込みアセット → スクリプト隣 → exe隣 → カレント → 通常解決

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// SEA (単一exe) で動作する場合は import.meta.url が使えないためフォールバックする
const __filename = (() => {
  try { return fileURLToPath(import.meta.url); } catch { return process.execPath; }
})();
const __dirname = path.dirname(__filename);

const require = createRequire(__filename);

// SEA (単一exe) の埋め込みアセットから sharp 一式を一時フォルダへ展開する。
// ネイティブ拡張 (.node) はディスク上にある必要があるため初回起動時に展開し、
// 以降はマーカーファイルがあるので再展開しない。
function seaSharpDir() {
  try {
    const sea = require("node:sea");
    if (!sea.isSea()) return null;
    const manifest = JSON.parse(Buffer.from(sea.getAsset("asset-manifest.json")).toString("utf8"));
    const dir = path.join(os.tmpdir(), "eh-viewer-assets-" + (manifest.hash || "v1"));
    const marker = path.join(dir, ".ready");
    if (!fs.existsSync(marker)) {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const key of manifest.files) {
        const dest = path.join(dir, ...key.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(sea.getAsset(key)));
      }
      // 古いバージョンの展開残りを掃除 (ベストエフォート)
      try {
        const prefix = path.join(os.tmpdir(), "eh-viewer-assets-");
        for (const n of fs.readdirSync(os.tmpdir())) {
          if (!n.startsWith("eh-viewer-assets-")) continue;
          const p = path.join(os.tmpdir(), n);
          if (p === dir) continue;
          try {
            if (fs.statSync(p).mtimeMs < Date.now() - 72 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      fs.writeFileSync(marker, "ok");
    }
    return dir;
  } catch {
    return null;
  }
}

let sharpLib; // undefined=未試行 / null=利用不可 / 関数=利用可
export function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  const seaDir = seaSharpDir();
  const bases = [
    seaDir,
    __dirname,
    path.dirname(process.execPath),
    process.cwd(),
  ];
  for (const base of bases) {
    if (!base) continue;
    try { sharpLib = require(path.join(base, "node_modules", "sharp")); return sharpLib; } catch { /* 次を試す */ }
  }
  try { sharpLib = require("sharp"); return sharpLib; } catch { sharpLib = null; }
  return null;
}
