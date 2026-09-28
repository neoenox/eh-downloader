#!/usr/bin/env node
// ローカル画像ビューワー (Windows 向け・Node.js 標準モジュールのみで動作)
// sharp がインストールされていれば一覧用サムネイルを自動生成してキャッシュする
//
// 使い方:
//   node image_viewer.mjs [フォルダ] [オプション]
//
// オプション:
//   --port N / -p N   ポート指定 (デフォルト: 8420、使用中なら自動で次を探す)
//   --recursive / -r  サブフォルダもまとめて表示
//   --no-open         ブラウザを自動で開かない
//   --help / -h       ヘルプ表示
//
// ブラウザ (既定のブラウザ) をビューワー UI として使うため、
// WebP / AVIF などの表示はブラウザ標準機能で行う。インストール不要。

import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getSharp } from "./sharp_loader.mjs";

const __filename = (() => {
  // SEA (単一exe) で動作する場合は import.meta.url が使えないためフォールバックする
  try { return fileURLToPath(import.meta.url); } catch { return process.execPath; }
})();
const __dirname = path.dirname(__filename);

const IMAGE_EXTS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".avif", ".svg"]);
const MIME = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

// --- sharp (オプション依存: サムネイル生成に使用) ---
// 未インストールでも本体は動作し、サムネイルは元画像のフォールバック表示になる。
// 読み込み処理 (SEA埋め込みアセットの展開を含む) は sharp_loader.mjs に共通化。
const THUMB_DEFAULT_SIZE = 400;
const thumbInflight = new Map(); // cachePath -> Promise (同一ファイルの生成重複防止)

// 自然順ソート (01, 02, ..., 10 の順。エクスプローラーと同じ並び)
const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const natCmp = (a, b) => collator.compare(a, b);

function parseArgs(argv) {
  const opts = { dir: ".", port: 8420, recursive: false, open: true, help: false, version: false, thumbs: true, thumbSize: THUMB_DEFAULT_SIZE };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--version" || a === "-v") opts.version = true;
    else if (a === "--port" || a === "-p") opts.port = parseInt(argv[++i], 10);
    else if (a === "--recursive" || a === "-r") opts.recursive = true;
    else if (a === "--no-open") opts.open = false;
    else if (a === "--no-thumbs") opts.thumbs = false;
    else if (a === "--thumb-size") opts.thumbSize = parseInt(argv[++i], 10);
    else if (a.startsWith("--")) { console.error(`不明なオプション: ${a} (--help を参照)`); process.exit(1); }
    else rest.push(a);
  }
  if (rest.length > 0) opts.dir = rest[0];
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error("[ERROR] --port には 0-65535 の数値を指定してください");
    process.exit(1);
  }
  if (!Number.isInteger(opts.thumbSize) || opts.thumbSize < 16 || opts.thumbSize > 2048) {
    console.error("[ERROR] --thumb-size には 16-2048 の数値を指定してください");
    process.exit(1);
  }
  return opts;
}

function printHelp() {
  console.log(`使い方: node image_viewer.mjs [フォルダ] [オプション]

ローカル画像フォルダをブラウザで閲覧するビューワーです。
WebP / PNG / JPEG / GIF / BMP / AVIF / SVG に対応 (追加インストール不要)。
sharp があれば一覧を高速表示するサムネイルを自動生成する (任意)。

引数:
  フォルダ              表示するフォルダ (デフォルト: カレントディレクトリ)

オプション:
  --port N, -p N        ポート指定 (デフォルト: 8420、使用中なら自動で次を探す)
  --recursive, -r       サブフォルダの画像もまとめて表示
  --no-open             ブラウザを自動で開かない
  --no-thumbs           サムネイル生成を無効化 (元画像を直接表示)
  --thumb-size N        サムネイルの長辺サイズ (デフォルト: 400、16-2048)
  --help, -h            このヘルプを表示

操作キー (ブラウザ内):
  ←/→ / Space           前・次の画像
  Home / End            先頭・末尾の画像
  PageUp / PageDown     前・次のフォルダ (兄弟フォルダを巡回)
  - / + / 0             ズームアウト / ズームイン / フィット
  r                     回転 (90度ずつ)
  s                     スライドショー (4秒間隔)
  f                     フルスクリーン
  g                     一覧に戻る
  Esc                   一覧に戻る / 閉じる
  ホイール              ページ送り (Ctrl+ホイールでズーム)
  ダブルクリック        フィット ⇄ 100%

終了: 画面右上の「終了」ボタン、または Ctrl+C`);
}

// ---------------------------------------------------------------------------
// サーバー側処理
// ---------------------------------------------------------------------------

// base 内に収まる絶対パスに解決する (パストラバーサル防止)。範囲外なら null。
function resolveWithin(baseAbs, rel) {
  const p = path.resolve(baseAbs, rel);
  const b = path.resolve(baseAbs);
  if (p !== b && !p.startsWith(b + path.sep)) return null;
  return p;
}

async function subdirsOf(baseAbs, relDir) {
  const abs = path.resolve(baseAbs, relDir);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort(natCmp);
}

async function scanDir(baseAbs, relDir, recursive) {
  const abs = path.resolve(baseAbs, relDir);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const dirNames = [];
  const imgNames = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) dirNames.push(e.name);
    else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) imgNames.push(e.name);
  }
  dirNames.sort(natCmp);
  imgNames.sort(natCmp);

  let images = imgNames.map((n) => ({ f: relDir ? relDir + "/" + n : n, s: -1 }));
  await Promise.all(
    images.map(async (o) => {
      try { o.s = (await fsp.stat(path.join(baseAbs, o.f))).size; } catch { /* 消えたファイルは無視 */ }
    })
  );

  if (recursive) {
    for (const d of dirNames) {
      const sub = await scanDir(baseAbs, relDir ? relDir + "/" + d : d, true);
      images = images.concat(sub.images);
    }
  }
  return { dirs: dirNames, images };
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, { error: message }, status);
}

async function sendFile(res, abs) {
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw Object.assign(new Error("not a file"), { statusCode: 404 });
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
    "Content-Length": st.size,
    "Cache-Control": "no-cache",
  });
  const rs = fs.createReadStream(abs);
  rs.on("error", () => res.destroy());
  rs.pipe(res);
}

// --- サムネイル生成 & キャッシュ (.thumbcache/) ---
// キャッシュキーは ソースパス+mtime+サイズ+画像内容 をハッシュ化したもの。
// ファイルを更新すると自動で再生成され、ゴミは残らない。

function thumbDirFor(baseAbs) {
  return path.join(baseAbs, ".thumbcache");
}

async function thumbCachePath(baseAbs, absFile, size) {
  const st = await fsp.stat(absFile).catch(() => null);
  if (!st || !st.isFile()) return null;
  const h = crypto.createHash("sha256");
  h.update(path.resolve(absFile).toLowerCase());
  h.update(`|${st.size}|${Math.floor(st.mtimeMs)}|${size}`);
  return path.join(thumbDirFor(baseAbs), h.digest("hex").slice(0, 32) + ".webp");
}

// 起動時に 1 回だけ実行: 72時間より古いキャッシュを削除 (アンインストール代わり)
let cacheCleaned = false;
async function cleanThumbCache(baseAbs) {
  if (cacheCleaned) return;
  cacheCleaned = true;
  const dir = thumbDirFor(baseAbs);
  const entries = await fsp.readdir(dir).catch(() => null);
  if (!entries) return;
  const limit = Date.now() - 72 * 3600 * 1000;
  await Promise.all(
    entries.map(async (n) => {
      if (!n.endsWith(".webp")) return;
      const p = path.join(dir, n);
      try {
        const st = await fsp.stat(p);
        if (st.mtimeMs < limit) await fsp.unlink(p);
      } catch { /* 同時削除競合などは無視 */ }
    })
  );
}

// 同時変換数を制限 (sharp の CPU 過負荷を防ぐ)
const MAX_CONCURRENT_THUMBS = Math.min(4, os.cpus().length || 1);
let runningThumbs = 0;
const thumbQueue = [];
function acquireThumbSlot() {
  if (runningThumbs < MAX_CONCURRENT_THUMBS) {
    runningThumbs++;
    return;
  }
  return new Promise((resolve) => thumbQueue.push(resolve));
}
function releaseThumbSlot() {
  const next = thumbQueue.shift();
  if (next) next();
  else runningThumbs--;
}

// サムネイルを取得 (キャッシュ優先)。生成できない場合は null を返す。
async function getThumbnail(baseAbs, absFile, size) {
  const sharp = getSharp();
  if (!sharp) return null;

  const cachePath = await thumbCachePath(baseAbs, absFile, size);
  if (!cachePath) return null;

  // キャッシュヒット
  const cached = await fsp.readFile(cachePath).catch(() => null);
  if (cached) return cached;

  // 生成済み/生成中の同一キャッシュがあればそれを待つ (重複生成の排除)
  let inflight = thumbInflight.get(cachePath);
  if (!inflight) {
    inflight = (async () => {
      await acquireThumbSlot();
      try {
        const input = await fsp.readFile(absFile).catch(() => null);
        if (!input) return null;
        let out;
        try {
          out = await sharp(input, { failOn: "none" })
            .rotate() // EXIF 方向を自動補正
            .resize(size, size, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 72 })
            .toBuffer();
        } catch {
          return null; // 非対応/破損データ → フォールバック
        }
        await fsp.mkdir(thumbDirFor(baseAbs), { recursive: true }).catch(() => {});
        await fsp.writeFile(cachePath, out).catch(() => {}); // 失敗してもレスポンスは返す
        return out;
      } finally {
        releaseThumbSlot();
        thumbInflight.delete(cachePath);
      }
    })();
    thumbInflight.set(cachePath, inflight);
  }
  return inflight;
}

function openInExplorer(target, select) {
  const safeSpawn = (cmd, args) => {
    // xdg-open 等が存在しない環境でも落ちないようにする
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  };
  if (process.platform === "win32") {
    // explorer /select,"path" で対象ファイルを選択状態でフォルダを開く
    safeSpawn("explorer", [select ? "/select," + target : target]);
  } else {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    safeSpawn(opener, [select ? path.dirname(target) : target]);
  }
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") exec(`start "" "${url}"`);
    else if (process.platform === "darwin") exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch { /* 開けなくてもサーバーは起動済みなので無視 */ }
}

function buildServer(baseDir, recursive, thumbs) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      const p = u.pathname;

      if (p === "/" || p === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(PAGE_HTML);
        return;
      }

      if (p === "/api/list") {
        // rel は "/" 区切りに正規化 (Windows から "a\\b" で来ても OK)
        const rel = (u.searchParams.get("d") || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
        const abs = resolveWithin(baseDir, rel);
        if (!abs) return sendError(res, 403, "フォルダが範囲外です");
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || !st.isDirectory()) return sendError(res, 400, "フォルダが見つかりません: " + rel);
        const { dirs, images } = await scanDir(baseDir, rel, recursive);
        const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        const siblings = rel ? await subdirsOf(baseDir, parentRel) : [];
        const curName = rel ? rel.slice(rel.lastIndexOf("/") + 1) : path.basename(baseDir);
        return sendJson(res, {
          base: path.basename(baseDir),
          cur: rel,
          curName,
          parent: parentRel,
          siblings,
          dirs,
          images,
          recursive,
          thumbs: thumbs && !!getSharp(),
        });
      }

      if (p === "/api/file") {
        const f = u.searchParams.get("f") || "";
        const abs = resolveWithin(baseDir, f);
        if (!abs) return sendError(res, 403, "パスが範囲外です");
        if (!IMAGE_EXTS.has(path.extname(abs).toLowerCase())) return sendError(res, 403, "画像ファイル以外は取得できません");
        try {
          return await sendFile(res, abs);
        } catch (e) {
          return sendError(res, e.statusCode || 404, "ファイルが見つかりません");
        }
      }

      if (p === "/api/thumb") {
        const f = u.searchParams.get("f") || "";
        const size = Math.min(2048, Math.max(16, parseInt(u.searchParams.get("s"), 10) || THUMB_DEFAULT_SIZE));
        const abs = resolveWithin(baseDir, f);
        if (!abs) return sendError(res, 403, "パスが範囲外です");
        if (!IMAGE_EXTS.has(path.extname(abs).toLowerCase())) return sendError(res, 403, "画像ファイル以外は取得できません");
        if (!thumbs || !getSharp()) return sendError(res, 503, "thumbnails disabled");

        const st = await fsp.stat(abs).catch(() => null);
        if (!st || !st.isFile()) return sendError(res, 404, "ファイルが見つかりません");

        cleanThumbCache(baseDir).catch(() => {});

        let buf = null;
        try { buf = await getThumbnail(baseDir, abs, size); } catch { buf = null; }
        if (!buf) return sendError(res, 404, "thumbnail unavailable");

        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Content-Length": buf.length,
          "Cache-Control": "private, max-age=86400",
        });
        return void res.end(buf);
      }

      if (p === "/api/open") {
        const d = (u.searchParams.get("d") || "").replace(/\\/g, "/");
        const f = u.searchParams.get("f") || "";
        const dirAbs = resolveWithin(baseDir, d);
        if (!dirAbs) return sendError(res, 403, "パスが範囲外です");
        let target = dirAbs;
        let select = false;
        if (f) {
          const fAbs = resolveWithin(baseDir, path.join(d, f));
          if (!fAbs) return sendError(res, 403, "パスが範囲外です");
          target = fAbs;
          select = true;
        }
        openInExplorer(target, select);
        return sendJson(res, { ok: true });
      }

      if (p === "/api/quit") {
        sendJson(res, { ok: true });
        // レスポンス送信を待ってから接続を切断して終了
        setTimeout(() => {
          try { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); } catch { /* ignore */ }
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 300).unref();
        }, 150).unref();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("error: " + (e && e.message));
    }
  });
  return server;
}

function listenOn(server, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryOnce = () => {
      const target = port + i;
      const onError = (e) => {
        server.removeListener("listening", onSuccess);
        if (e.code === "EADDRINUSE" && i + 1 < attempts && port !== 0) {
          i++;
          tryOnce();
        } else {
          reject(e);
        }
      };
      const onSuccess = () => {
        server.removeListener("error", onError);
        resolve(server.address().port);
      };
      server.once("error", onError);
      server.listen(target, "127.0.0.1", onSuccess);
    };
    tryOnce();
  });
}

// ---------------------------------------------------------------------------
// ビューワー UI (単一 HTML)
// ---------------------------------------------------------------------------

const PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image Viewer</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #101014; color: #d8d8dc;
  font-family: "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif; overflow: hidden; }
header { position: fixed; top: 0; left: 0; right: 0; height: 46px; z-index: 20;
  display: flex; align-items: center; gap: 6px; padding: 0 10px;
  background: #16161c; border-bottom: 1px solid #26262e; }
header .grow { flex: 1; }
button { background: #22222a; color: #d8d8dc; border: 1px solid #33333d;
  border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; white-space: nowrap; }
button:hover { background: #2c2c36; border-color: #4a9eff; }
button:disabled { opacity: .35; cursor: default; border-color: #33333d; }
button.on { background: #1d3a5f; border-color: #4a9eff; color: #cfe4ff; }
#crumb { font-size: 13px; color: #9a9aa4; margin: 0 6px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
#grid { position: fixed; top: 46px; left: 0; right: 0; bottom: 0; overflow: auto; padding: 14px; }
.sec-label { width: 100%; color: #77777f; font-size: 12px; margin: 2px 0 6px; }
.folders { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.folders button { border-radius: 999px; }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.thumb { position: relative; height: 190px; background: #000; border: 1px solid #26262e;
  border-radius: 6px; overflow: hidden; cursor: zoom-in; display: flex;
  align-items: center; justify-content: center; }
.thumb:hover { border-color: #4a9eff; }
.thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.thumb .no { position: absolute; left: 6px; bottom: 4px; font-size: 11px; color: #bbb;
  background: rgba(0,0,0,.55); padding: 1px 6px; border-radius: 4px; }
.empty { color: #77777f; padding: 48px; text-align: center; font-size: 14px; }
#stage { position: fixed; top: 46px; left: 0; right: 0; bottom: 30px; overflow: hidden; background: #0a0a0d; }
#wrap { position: absolute; transform-origin: center; will-change: transform; }
#img { display: block; user-select: none; -webkit-user-drag: none; }
#status { position: fixed; left: 0; right: 0; bottom: 0; height: 30px; z-index: 20;
  display: flex; align-items: center; padding: 0 12px; font-size: 12px; color: #9a9aa4;
  background: #16161c; border-top: 1px solid #26262e;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hide { display: none !important; }
#help { position: fixed; inset: 0; background: rgba(0,0,0,.72); z-index: 50;
  display: flex; align-items: center; justify-content: center; }
#help .box { background: #1a1a22; border: 1px solid #33333d; border-radius: 10px;
  padding: 22px 28px; font-size: 13px; line-height: 2.1; max-width: 560px; }
#help h2 { margin: 0 0 10px; font-size: 15px; color: #cfe4ff; }
#help kbd { background: #26262e; border: 1px solid #3a3a44; border-bottom-width: 2px;
  border-radius: 4px; padding: 0 6px; font-family: Consolas, monospace; font-size: 12px; }
#toast { position: fixed; bottom: 44px; left: 50%; transform: translateX(-50%);
  background: #1d3a5f; border: 1px solid #4a9eff; color: #cfe4ff; padding: 7px 16px;
  border-radius: 8px; font-size: 13px; z-index: 60; opacity: 0; pointer-events: none;
  transition: opacity .25s; }
#toast.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <button id="btn-grid" title="一覧表示 (g)">一覧</button>
  <span id="crumb"></span>
  <button id="btn-prevf" title="前のフォルダ (PageUp)">‹ 前フォルダ</button>
  <button id="btn-nextf" title="次のフォルダ (PageDown)">次フォルダ ›</button>
  <span class="grow"></span>
  <button id="btn-zout" title="ズームアウト (-)">−</button>
  <span id="zoomlabel" style="font-size:12px;color:#9a9aa4;min-width:52px;text-align:center">フィット</span>
  <button id="btn-zin" title="ズームイン (+)">＋</button>
  <button id="btn-fit" title="ウィンドウにフィット (0)">フィット</button>
  <button id="btn-100" title="等倍 (100%)">100%</button>
  <button id="btn-rot" title="回転 (r)">回転</button>
  <button id="btn-slide" title="スライドショー (s)">▶ スライド</button>
  <button id="btn-full" title="フルスクリーン (f)">⛶</button>
  <button id="btn-explorer" title="エクスプローラーで表示">📂</button>
  <button id="btn-help" title="操作ヘルプ (?)">？</button>
  <button id="btn-quit" title="サーバーを終了">✕ 終了</button>
</header>

<main id="grid"></main>

<div id="stage" class="hide">
  <div id="wrap"><img id="img" alt=""></div>
</div>

<footer id="status" class="hide"></footer>

<div id="help" class="hide">
  <div class="box">
    <h2>操作方法</h2>
    <kbd>←</kbd>/<kbd>→</kbd> / <kbd>Space</kbd> 前・次の画像　<kbd>Home</kbd>/<kbd>End</kbd> 先頭・末尾<br>
    <kbd>PageUp</kbd>/<kbd>PageDown</kbd> 前・次のフォルダ（兄弟フォルダを巡回）<br>
    <kbd>-</kbd> / <kbd>+</kbd> / <kbd>0</kbd> ズーム / フィット　<kbd>r</kbd> 回転　<kbd>s</kbd> スライドショー<br>
    <kbd>f</kbd> フルスクリーン　<kbd>g</kbd> 一覧に戻る　<kbd>Esc</kbd> 閉じる<br>
    ホイール: ページ送り（<kbd>Ctrl</kbd>+ホイールでズーム）<br>
    ダブルクリック: フィット ⇄ 100%　ドラッグ: 拡大時のスクロール<br>
    画像は左側の番号順（01, 02, …, 10）で並びます。終了は右上の「✕ 終了」。
  </div>
</div>

<div id="toast"></div>

<script>
'use strict';
var $ = function (id) { return document.getElementById(id); };
var state = { cur: '', curName: '', parent: '', siblings: [], dirs: [], images: [], baseLabel: '',
  recursive: false, thumbs: false, idx: 0, zoom: null, rot: 0, playing: false, timer: null };
var natW = 0, natH = 0, panX = 0, panY = 0, drag = null, toastTimer = null;

function api(p) {
  return fetch(p).then(function (r) {
    if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); }); }
    return r.json();
  });
}
function fileUrl(f) { return '/api/file?f=' + encodeURIComponent(f); }
function thumbUrl(f) {
  return state.thumbs ? '/api/thumb?f=' + encodeURIComponent(f) : fileUrl(f);
}
function enc(rel) { return encodeURIComponent(rel); }
function fmtSize(n) {
  if (n < 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
}

function setHash() {
  history.replaceState(null, '', '#p=' + enc(state.cur) + '&i=' + state.idx);
}
function parseHash() {
  var h = location.hash.replace(/^#/, '');
  var o = { p: '', i: 0 };
  h.split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i < 0) return;
    var k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === 'p') o.p = decodeURIComponent(v);
    if (k === 'i') o.i = parseInt(v, 10) || 0;
  });
  return o;
}

// --- フォルダ読み込み & 一覧グリッド ---
function loadDir(rel, idx) {
  return api('/api/list?d=' + enc(rel)).then(function (d) {
    state.cur = d.cur; state.curName = d.curName; state.parent = d.parent;
    state.siblings = d.siblings; state.dirs = d.dirs; state.images = d.images;
    state.recursive = d.recursive;
    state.thumbs = !!d.thumbs;
    state.idx = Math.min(Math.max(idx || 0, 0), Math.max(0, state.images.length - 1));
    state.zoom = null; state.rot = 0; stopSlide();
    renderGrid(); renderHeader(); setHash();
  }).catch(function (e) { toast('フォルダ読み込みに失敗: ' + e.message); });
}

function renderHeader() {
  $('crumb').textContent = state.cur ? state.baseLabel + ' / ' + state.cur.split('/').join(' / ') : (state.baseLabel || state.curName);
  var i = state.siblings.indexOf(state.curName);
  var prevName = i >= 0 ? state.siblings[(i - 1 + state.siblings.length) % state.siblings.length] : '';
  var nextName = i >= 0 ? state.siblings[(i + 1) % state.siblings.length] : '';
  $('btn-prevf').disabled = !(state.cur && state.siblings.length > 1);
  $('btn-nextf').disabled = !(state.cur && state.siblings.length > 1);
  $('btn-prevf').title = '前のフォルダ (PageUp)' + (prevName ? ': ' + prevName : '');
  $('btn-nextf').title = '次のフォルダ (PageDown)' + (nextName ? ': ' + nextName : '');
}

function renderGrid() {
  var g = $('grid');
  g.textContent = '';
  if (state.cur) {
    var up = document.createElement('button');
    up.textContent = '↑ 上のフォルダへ';
    up.onclick = function () { loadDir(state.parent, 0); };
    g.appendChild(up);
  }
  if (state.dirs.length) {
    var lab = document.createElement('div');
    lab.className = 'sec-label';
    lab.textContent = 'サブフォルダ (' + state.dirs.length + ')';
    g.appendChild(lab);
    var fwrap = document.createElement('div');
    fwrap.className = 'folders';
    state.dirs.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = '📁 ' + d;
      b.onclick = function () { loadDir(state.cur ? state.cur + '/' + d : d, 0); };
      fwrap.appendChild(b);
    });
    g.appendChild(fwrap);
  }
  if (!state.images.length) {
    var em = document.createElement('div');
    em.className = 'empty';
    em.textContent = '画像が見つかりません。別のフォルダを選んでください。';
    g.appendChild(em);
    return;
  }
  if (state.dirs.length) {
    var lab2 = document.createElement('div');
    lab2.className = 'sec-label';
    lab2.textContent = '画像 (' + state.images.length + ' 枚)';
    g.appendChild(lab2);
  }
  var box = document.createElement('div');
  box.className = 'thumbs';
  state.images.forEach(function (it, i) {
    var cell = document.createElement('div');
    cell.className = 'thumb';
    var im = document.createElement('img');
    im.loading = 'lazy';
    im.src = thumbUrl(it.f);
    im.alt = it.f;
    cell.appendChild(im);
    var no = document.createElement('span');
    no.className = 'no';
    no.textContent = (i + 1) + ' / ' + state.images.length;
    cell.appendChild(no);
    cell.onclick = function () { showViewer(i); };
    box.appendChild(cell);
  });
  g.appendChild(box);
}

// --- ビューワー本体 ---
function showViewer(i) {
  state.idx = i;
  $('grid').classList.add('hide');
  $('stage').classList.remove('hide');
  $('status').classList.remove('hide');
  show(state.idx);
}
function closeViewer() {
  stopSlide();
  $('stage').classList.add('hide');
  $('status').classList.add('hide');
  $('grid').classList.remove('hide');
  setHash();
}
function show(i) {
  var n = state.images.length;
  if (!n) return;
  state.idx = ((i % n) + n) % n;
  var it = state.images[state.idx];
  var img = $('img');
  img.onload = function () {
    natW = img.naturalWidth; natH = img.naturalHeight;
    applyZoom(); setStatus();
  };
  img.onerror = function () { natW = 0; natH = 0; setStatus(); };
  img.src = fileUrl(it.f);
  natW = 0; natH = 0;
  applyZoom(); setStatus(); preload(); setHash();
}
function next() { show(state.idx + 1); }
function prev() { show(state.idx - 1); }
function preload() {
  var n = state.images.length;
  [1, 2, -1].forEach(function (d) {
    var j = ((state.idx + d) % n + n) % n;
    var im = new Image();
    im.src = fileUrl(state.images[j].f);
  });
}
function setStatus() {
  var it = state.images[state.idx];
  if (!it) { $('status').textContent = ''; return; }
  var parts = [(state.idx + 1) + ' / ' + state.images.length, it.f.split('/').pop()];
  if (natW) parts.push(natW + '×' + natH);
  if (it.s >= 0) parts.push(fmtSize(it.s));
  $('status').textContent = parts.join('　');
}

// --- ズーム / 回転 / パン ---
function centerOf() { return { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }
function applyPos() {
  var c = centerOf();
  $('wrap').style.left = (c.x + panX) + 'px';
  $('wrap').style.top = (c.y + panY) + 'px';
}
function applyZoom() {
  var img = $('img'), wrap = $('wrap');
  wrap.style.transform = 'translate(-50%,-50%) rotate(' + state.rot + 'deg)';
  if (state.zoom == null) {
    img.style.maxWidth = '100%'; img.style.maxHeight = '100%';
    img.style.width = ''; img.style.height = '';
    panX = 0; panY = 0;
  } else {
    var w = Math.round(natW * state.zoom);
    if (w > 0) { img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = w + 'px'; img.style.height = 'auto'; }
  }
  applyPos();
  $('zoomlabel').textContent = state.zoom == null ? 'フィット' : Math.round(state.zoom * 100) + '%';
}
function zoomAt(px, py, factor) {
  if (!natW) return;
  if (state.zoom == null) {
    var r = $('img').getBoundingClientRect();
    state.zoom = natW ? r.width / natW : 1;
  }
  var nz = Math.min(32, Math.max(0.02, state.zoom * factor));
  var k = nz / state.zoom;
  state.zoom = nz;
  var c = centerOf();
  panX = (px - c.x) + (panX - (px - c.x)) * k;
  panY = (py - c.y) + (panY - (py - c.y)) * k;
  applyZoom();
}
function zoomStep(factor) { var c = centerOf(); zoomAt(c.x, c.y, factor); }
function setFit() { state.zoom = null; panX = 0; panY = 0; applyZoom(); }
function set100() { if (!natW) return; state.zoom = 1; panX = 0; panY = 0; applyZoom(); }
function rotate() { state.rot = (state.rot + 90) % 360; applyZoom(); }

$('stage').addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  e.preventDefault();
});
window.addEventListener('mousemove', function (e) {
  if (!drag) return;
  panX = drag.px + (e.clientX - drag.x);
  panY = drag.py + (e.clientY - drag.y);
  applyPos();
});
window.addEventListener('mouseup', function () { drag = null; });
$('stage').addEventListener('wheel', function (e) {
  e.preventDefault();
  if (e.ctrlKey) zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : 0.8);
  else if (e.deltaY < 0) prev();
  else next();
}, { passive: false });
$('stage').addEventListener('dblclick', function () {
  if (state.zoom == null) set100(); else setFit();
});
window.addEventListener('resize', applyZoom);

// --- スライドショー ---
function startSlide() {
  if (!state.images.length) return;
  state.playing = true;
  $('btn-slide').classList.add('on');
  toast('スライドショー開始（4秒間隔・ループ）');
  state.timer = setInterval(next, 4000);
}
function stopSlide() {
  state.playing = false;
  $('btn-slide').classList.remove('on');
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}
function toggleSlide() { state.playing ? stopSlide() : startSlide(); }

// --- フォルダ移動 ---
function folderStep(step) {
  if (!state.cur || state.siblings.length < 2) { toast('兄弟フォルダがありません'); return; }
  var i = state.siblings.indexOf(state.curName);
  if (i < 0) i = 0;
  var j = ((i + step) % state.siblings.length + state.siblings.length) % state.siblings.length;
  var name = state.siblings[j];
  loadDir(state.parent ? state.parent + '/' + name : name, 0);
}
function goGrid() { closeViewer(); }

// --- その他の操作 ---
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(function () {});
}
function openExplorer() {
  var inViewer = !$('stage').classList.contains('hide');
  var f = inViewer && state.images[state.idx] ? state.images[state.idx].f : '';
  fetch('/api/open?d=' + enc(state.cur) + (f ? '&f=' + enc(f) : ''))
    .then(function () { toast('エクスプローラーで開いています'); })
    .catch(function () { toast('開けませんでした'); });
}
function quitApp() {
  if (!confirm('ビューワー（ローカルサーバー）を終了しますか？')) return;
  fetch('/api/quit').then(function () {
    toast('終了しました。このタブを閉じてください');
  }).catch(function () {
    toast('終了しました。このタブを閉じてください');
  });
}

// --- ボタン配線 ---
$('btn-grid').onclick = goGrid;
$('btn-prevf').onclick = function () { folderStep(-1); };
$('btn-nextf').onclick = function () { folderStep(1); };
$('btn-zout').onclick = function () { zoomStep(0.8); };
$('btn-zin').onclick = function () { zoomStep(1.25); };
$('btn-fit').onclick = setFit;
$('btn-100').onclick = set100;
$('btn-rot').onclick = rotate;
$('btn-slide').onclick = toggleSlide;
$('btn-full').onclick = toggleFull;
$('btn-explorer').onclick = openExplorer;
$('btn-help').onclick = function () { $('help').classList.toggle('hide'); };
$('help').onclick = function () { $('help').classList.add('hide'); };
$('btn-quit').onclick = quitApp;
// ボタンクリック後にフォーカスを外す (Space キー誤爆防止)
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('button');
  if (b) b.blur();
});

// --- キーボード操作 ---
window.addEventListener('keydown', function (e) {
  if (!$('help').classList.contains('hide')) {
    if (e.key === 'Escape' || e.key === '?' || e.key === 'h') { $('help').classList.add('hide'); e.preventDefault(); }
    return;
  }
  var inViewer = !$('stage').classList.contains('hide');
  switch (e.key) {
    case 'ArrowRight': if (inViewer) { next(); e.preventDefault(); } break;
    case 'ArrowLeft': if (inViewer) { prev(); e.preventDefault(); } break;
    case ' ': if (inViewer) { next(); e.preventDefault(); } break;
    case 'Home': if (inViewer) { show(0); e.preventDefault(); } break;
    case 'End': if (inViewer) { show(state.images.length - 1); e.preventDefault(); } break;
    case 'PageUp': folderStep(-1); e.preventDefault(); break;
    case 'PageDown': folderStep(1); e.preventDefault(); break;
    case '+': case '=': zoomStep(1.25); e.preventDefault(); break;
    case '-': case '_': zoomStep(0.8); e.preventDefault(); break;
    case '0': setFit(); e.preventDefault(); break;
    case 'r': case 'R': rotate(); break;
    case 's': case 'S': toggleSlide(); break;
    case 'f': case 'F': toggleFull(); break;
    case 'g': case 'G': if (inViewer) { goGrid(); e.preventDefault(); } break;
    case '?': case 'h': case 'H': $('help').classList.remove('hide'); break;
    case 'Escape':
      if (inViewer) { goGrid(); e.preventDefault(); }
      break;
  }
});

// --- 初期化 (ハッシュがあれば前回位置を復元) ---
state.baseLabel = '';
var hadHash = location.hash.length > 1;
var h0 = parseHash();
loadDir(h0.p, h0.i).then(function () {
  state.baseLabel = state.cur ? state.cur.split('/')[0] : state.curName;
  renderHeader(); renderGrid();
  if (hadHash && state.images.length) showViewer(state.idx);
});
</script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// 起動処理
// ---------------------------------------------------------------------------

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) { printHelp(); return; }
  if (opts.version) {
    // バージョンはビルド時に埋め込む (build_exe.mjs)。スクリプト実行時は開発版を表示
    console.log("eh-viewer " + (globalThis.EH_VIEWER_VERSION || "dev"));
    return;
  }

  const baseDir = path.resolve(opts.dir);
  const st = await fsp.stat(baseDir).catch(() => null);
  if (!st) { console.error("[ERROR] フォルダが見つかりません: " + baseDir); process.exit(1); }
  if (!st.isDirectory()) { console.error("[ERROR] フォルダを指定してください（ファイルは不可）: " + baseDir); process.exit(1); }

  const server = buildServer(baseDir, opts.recursive, opts.thumbs);
  const sharpAvailable = !!getSharp();
  if (opts.thumbs && !sharpAvailable) {
    console.log("サムネイル: 無効 (sharp 未インストール。npm install sharp で有効化)");
  } else {
    console.log("サムネイル: " + (opts.thumbs ? `有効 (sharp / 長辺 ${opts.thumbSize}px、キャッシュ: .thumbcache/)` : "無効 (--no-thumbs)"));
  }
  let port;
  try {
    port = await listenOn(server, opts.port);
  } catch (e) {
    console.error("[ERROR] サーバーを起動できません: " + e.message);
    process.exit(1);
  }

  const url = "http://localhost:" + port + "/";
  console.log("Image Viewer: " + url);
  console.log("フォルダ: " + baseDir + (opts.recursive ? " (サブフォルダも含む)" : ""));
  console.log("終了: 画面右上の「✕ 終了」ボタン または Ctrl+C");

  if (opts.open) openBrowser(url);

  const shutdown = () => {
    try { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 300).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// 直接実行時のみ自動起動 (run_all_sea_entry からは runViewer(argv) で呼ばれる)
// SEA (単一exe) では import.meta.url が取れないため、CLI モード相当は run_all_sea_entry 側の
// 分岐で処理する (isDirectRun は通常スクリプト実行時のみ有効)。
const isDirectRun =
  typeof process.argv[1] === "string" &&
  process.argv[1] !== process.execPath && // SEA (単一exe) では argv[1] が実行ファイル自身になるため除外
  (() => { try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isDirectRun) {
  main().catch((e) => {
    console.error("[ERROR] " + (e && e.stack || e));
    process.exit(1);
  });
}

// eh-viewer.exe (ビューワー単体の SEA ビルド) 用の自動起動:
// SEA では process.argv[1] が実行ファイル自身になるため上の isDirectRun は常に false になる。
// 単体ビルド (EH_EMBEDDED 未設定) のときだけ自分がエントリとして起動する。
// run_all 統合版では run_all_sea_entry / run_all.mjs が制御するためここは発火しない。
// 注意: argv[1] は OS や起動方法 (相対パス) で表記が変わるため、解決済みパスで比較する。
if (
  !isDirectRun &&
  typeof process.argv[1] === "string" &&
  (() => { try { return path.resolve(process.argv[1]) === path.resolve(process.execPath); } catch { return false; } })() &&
  process.env.EH_EMBEDDED !== "1"
) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("[ERROR] " + (e && e.stack || e));
    process.exit(1);
  });
}

export { main as runViewer, main };
