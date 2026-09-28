#!/usr/bin/env node
// 単一 exe ビルド: Node.js SEA (Single Executable Applications) 方式
//
//   node build_exe.mjs [--out dist] [--name eh-viewer] [--no-sharp] [--keep]
//
// 流れ:
//   1. esbuild で image_viewer.mjs を CJS 1 ファイルにバンドル (sharp は外部化)
//   2. sharp 一式を SEA アセットとして同梱した blob を生成
//   3. 現在の node.exe をコピーし、postject で blob を注入して exe を生成
//
// 出力: dist/eh-viewer.exe (Node ランタイム同梱、Node.js 不要で動作)
// sharp は初回起動時に %TEMP%\eh-viewer-assets-<hash>\ へ展開されて読み込まれる
// (展開処理は image_viewer.mjs 側の seaSharpDir() が担当)。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// --- 引数解析 ---
const argv = process.argv.slice(2);
const getOpt = (names) => {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
  }
  return null;
};
const hasFlag = (n) => argv.includes(n);

const OUT_DIR = path.resolve(rootDir, getOpt(["--out", "-o"]) || "dist");
const ENTRY_KIND = hasFlag("--runall") ? "runall" : "viewer";
const DEFAULT_NAME = ENTRY_KIND === "runall" ? "eh-runall" : "eh-viewer";
const NAME = getOpt(["--name"]) || DEFAULT_NAME;
const NO_SHARP = hasFlag("--no-sharp");
const KEEP = hasFlag("--keep");

console.log(`eh-viewer 単一exe ビルド (Node ${process.versions.node}, ${process.platform}-${process.arch})`);
if (NO_SHARP) console.log("  --no-sharp: サムネイル無効 (ビューワー本体のみ)");

// --- 依存チェック ---
for (const m of ["esbuild", "postject"]) {
  try { require.resolve(m); } catch {
    console.error(`[ERROR] ${m} がありません。 npm install -D ${m} を実行してください`);
    process.exit(1);
  }
}
if (!hasFlag("--no-sharp") && !fs.existsSync(path.join(rootDir, "node_modules", "sharp", "package.json"))) {
  console.error("[ERROR] sharp がありません。 npm install sharp を実行してください (--no-sharp でスキップ可)");
  process.exit(1);
}

// バージョン: --version <v1.2.3> があればそれを使い、無ければ package.json の version
const VERSION = getOpt(["--version"]) || JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
console.log(`  バージョン: ${VERSION}`);

const esbuild = await import("esbuild");
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) {
  console.error(`[ERROR] SEA ビルドには Node.js 20 以上が必要です (現在: ${process.versions.node})`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-viewer-build-"));

// エントリ: --runall で run_all 統合版 (4 スクリプトを 1 バンドルに束ねる)
const ENTRY_FILE = ENTRY_KIND === "runall" ? "run_all_sea_entry.mjs" : "image_viewer.mjs";

// ---------------------------------------------------------------------------
// 1. バンドル (sharp は外部化して SEA アセットで運ぶ)
// ---------------------------------------------------------------------------
console.log(`1/4 esbuild でバンドル中... (${ENTRY_KIND} 統合版)`);
const bundleCjs = path.join(workDir, "bundle.cjs");
await esbuild.build({
  entryPoints: [path.join(rootDir, ENTRY_FILE)],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${major}`,
  outfile: bundleCjs,
  external: ["sharp", "@img/*", "colour", "semver", "detect-libc", "node:*"],
  logLevel: "warning",
});

// バージョンをバンドルに埋め込む (--version 表示用)。shebang の後に入れる。
// runall 版は --help 用に run_all.mjs 冒頭コメントから抽出したヘルプ文字列も埋め込む
// (SEA ではソースファイルが読めないため)。
{
  const src = fs.readFileSync(bundleCjs, "utf8");
  let shebang = "";
  if (src.startsWith("#!")) {
    const nl = src.indexOf("\n");
    shebang = nl >= 0 ? src.slice(0, nl + 1) : src;
  }
  const body = shebang ? src.slice(shebang.length) : src;
  let prelude = `globalThis.EH_VIEWER_VERSION = ${JSON.stringify(String(VERSION))};\n`;
  if (ENTRY_KIND === "runall") {
    const srcLines = fs.readFileSync(path.join(rootDir, "run_all.mjs"), "utf8").split("\n");
    const end = srcLines.findIndex((l) => l.trim() === "// ---------- 引数解析 ----------");
    const help = srcLines.slice(1, end - 1).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
    prelude += `globalThis.EH_RUNALL_HELP = ${JSON.stringify(help)};\n`;
  }
  fs.writeFileSync(bundleCjs, shebang + prelude + body);
}

// ---------------------------------------------------------------------------
// 2. sharp の node_modules ツリーを SEA アセットとして収集
// ---------------------------------------------------------------------------
function collectSharpFiles() {
  // キーは "node_modules/<pkg>/<rel>" 形式。展開先で通常の require 解決
  // (上位の node_modules を辿る) がそのまま働くレイアウトになる。
  const out = {};
  const pkgs = [
    "sharp",
    "@img/colour",
    "@img/sharp-win32-x64",
    "@img/sharp-win32-arm64",
    "@img/sharp-linux-x64",
    "@img/sharp-linux-arm64",
    "@img/sharp-linuxmusl-x64",
    "@img/sharp-darwin-arm64",
    "@img/sharp-darwin-x64",
    "colour",
    "semver",
    "detect-libc",
  ];
  for (const pkg of pkgs) {
    const base = path.join(rootDir, "node_modules", ...pkg.split("/"));
    if (!fs.existsSync(base)) continue; // この OS/アーキ用の実体が無い場合はスキップ
    const walker = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDirectory()) {
          if (["test", "tests", "docs", "example", "examples", "obj"].includes(e.name)) continue;
          walker(path.join(dir, e.name), r);
        } else {
          if (/\.(map|md|ts)$/.test(e.name)) continue; // 実行に不要なものは運ばない
          out["node_modules/" + pkg + "/" + r] = path.join(dir, e.name);
        }
      }
    };
    walker(base, "");
  }
  if (!Object.keys(out).some((k) => k === "node_modules/sharp/package.json")) {
    throw new Error("sharp のファイル収集に失敗しました");
  }
  return out;
}

const sharpAssets = NO_SHARP ? {} : collectSharpFiles();
const sharpAssetKeys = Object.keys(sharpAssets);

// アセット一覧のハッシュ: 展開先 temp フォルダの一意性に使用
// (構成が変われば別フォルダに展開され、古いフォルダは 72 時間後に自動掃除)
const assetHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(sharpAssetKeys))
  .digest("hex")
  .slice(0, 8);

console.log(`2/4 SEA blob を生成中... (アセット: ${sharpAssetKeys.length} ファイル)`);

fs.writeFileSync(
  path.join(workDir, "asset-manifest.json"),
  JSON.stringify({ hash: assetHash, files: sharpAssetKeys })
);

const seaConfig = {
  main: bundleCjs,
  output: path.join(workDir, "blob.bin"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  ...(NO_SHARP ? {} : { assets: { "asset-manifest.json": path.join(workDir, "asset-manifest.json"), ...sharpAssets } }),
};
fs.writeFileSync(path.join(workDir, "sea-config.json"), JSON.stringify(seaConfig, null, 2));

const blob = spawnSync(process.execPath, ["--experimental-sea-config", path.join(workDir, "sea-config.json")], {
  encoding: "utf8",
});
if (blob.status !== 0 || !fs.existsSync(path.join(workDir, "blob.bin"))) {
  console.error("[ERROR] SEA blob の生成に失敗しました:\n" + (blob.stdout || "") + (blob.stderr || ""));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. exe へ注入
// ---------------------------------------------------------------------------
console.log("3/4 exe を生成中...");
await fsp.mkdir(OUT_DIR, { recursive: true });
// 拡張子は Windows のみ .exe。Linux/macOS は拡張子なし (実行ビットを立てる)
const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";
const outExe = path.join(OUT_DIR, `${NAME}${EXE_SUFFIX}`);
fs.copyFileSync(process.execPath, outExe);
if (process.platform !== "win32") fs.chmodSync(outExe, 0o755);

const postject = require.resolve("postject/dist/cli.js");
const inject = spawnSync(
  process.execPath,
  [
    postject,
    outExe,
    "NODE_SEA_BLOB",
    path.join(workDir, "blob.bin"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "--macho-segment-name",
    "NODE_SEA",
  ],
  { encoding: "utf8" }
);
if (inject.status !== 0) {
  console.error("[ERROR] postject 注入に失敗しました:\n" + (inject.stdout || "") + (inject.stderr || ""));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. 完了 (SHA-256 チェックサムの生成と表示)
// ---------------------------------------------------------------------------
const size = (fs.statSync(outExe).size / 1048576).toFixed(1);
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(outExe)).digest("hex").toUpperCase();

// サイドカー (<exe名>.sha256) を出力する。形式は shasum -a 256 / certutil 互換の
// "<hex>  <ファイル名>" (2スペース区切り、バイナリモードマーク *)。
const sidecar = path.join(OUT_DIR, `${NAME}${EXE_SUFFIX}.sha256`);
fs.writeFileSync(sidecar, `${sha256.toLowerCase()} *${NAME}${EXE_SUFFIX}\n`);

console.log(`4/4 完了: ${outExe}`);
console.log(`  サイズ: ${size} MB (Node ランタイム同梱${NO_SHARP ? "" : ` + sharp ${sharpAssetKeys.length} ファイル`})`);
console.log(`  SHA-256: ${sha256}`);
console.log(`  チェックサム: ${sidecar} (検証: PowerShell で verify_checksums.bat または certutil -hashfile)`);
if (ENTRY_KIND === "runall") {
  console.log(`  使い方: ${NAME}${EXE_SUFFIX} <URL...|urls.txt|フォルダ> [--format png|jpeg] [--no-view] など (node run_all.mjs と同じ)`);
  console.log(`          ${NAME}${EXE_SUFFIX} --open-only <フォルダ>  # 変換済みフォルダを開くだけ`);
} else {
  console.log(`  使い方: ${NAME}${EXE_SUFFIX} <フォルダ> [--recursive] [--port N] など (node image_viewer.mjs と同じ)`);
}

if (!KEEP) fs.rmSync(workDir, { recursive: true, force: true });
