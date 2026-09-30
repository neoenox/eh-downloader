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
  const opts = { dir: ".", port: 8420, recursive: false, open: true, help: false, version: false, thumbs: true, thumbSize: THUMB_DEFAULT_SIZE, windowSize: null };
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
    else if (a === "--window-size") opts.windowSize = argv[++i];
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
  if (opts.windowSize != null) {
    const m = /^(\d+)[xX*](\d+)$/.exec(String(opts.windowSize).trim());
    if (!m || +m[1] < 200 || +m[1] > 7680 || +m[2] < 200 || +m[2] > 4320) {
      console.error("[ERROR] --window-size には 幅x高さ (例: 1280x860、各 200-7680 / 200-4320) を指定してください");
      process.exit(1);
    }
    opts.windowSize = { w: +m[1], h: +m[2] };
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
  --window-size WxH     Windows 専用: Edge アプリモードの初期ウィンドウサイズ (例: 1280x860)。デフォルトは 1280x860
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
  /                     タグ検索パネルを開く
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

// ---------------------------------------------------------------------------
// タグ検索 (metadata.json 走査)
// ---------------------------------------------------------------------------

// baseDir 配下の metadata.json をすべて走査して検索インデックスを構築する。
// キャッシュ: mtime が変わらない限り再走査しない (大きなコレクションでも高速)。
let searchIndex = null; // { entries: [{ dir, title, category, tags, mtimeMs }], }

async function buildSearchIndex(baseAbs) {
  const entries = [];
  const walk = async (rel) => {
    const abs = path.resolve(baseAbs, rel);
    let list;
    try { list = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const sub = rel ? rel + "/" + e.name : e.name;
      const metaPath = path.join(baseAbs, sub, "metadata.json");
      try {
        const st = await fsp.stat(metaPath);
        const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
        entries.push({
          dir: sub,
          title: String(meta.title || e.name),
          category: String(meta.category || ""),
          tags: meta.tags && typeof meta.tags === "object" ? meta.tags : {},
          uploadedAt: String(meta.uploadedAt || ""),
          rating: parseFloat(meta.rating) || null,
          mtimeMs: st.mtimeMs,
        });
      } catch { /* metadata.json なし/壊れ → スキップ */ }
      await walk(sub);
    }
  };
  await walk("");
  return { entries };
}

async function getSearchIndex(baseAbs) {
  // 簡易キャッシュ: baseDir ごとに 1 エントリ (同一 baseDir を連続検索するケースが大半)
  if (searchIndex && searchIndex.base === baseAbs) return searchIndex.index;
  const index = await buildSearchIndex(baseAbs);
  searchIndex = { base: baseAbs, index };
  return index;
}
function invalidateSearchIndex() { searchIndex = null; }

// クエリに一致するギャラリーを検索する。
// q: 空白区切りの語。タグ値 / タイトル / カテゴリに部分一致 (大文字小文字を無視)。
// tag: "namespace:value" 形式 (artist:alice など)。value は部分一致。
// from / to: 投稿日の範囲フィルタ (YYYY-MM-DD または YYYY/MM/DD、from ≤ uploadedAt ≤ to)。
// minRating: 評価の下限 (例: 4.0 → rating >= 4.0)。
async function searchGalleries(baseAbs, { q = "", tag = "", from = "", to = "", minRating = null } = {}) {
  const { entries } = await getSearchIndex(baseAbs);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const tagTerms = tag.toLowerCase().split(/\s+/).filter(Boolean);
  // 日付は "YYYY-MM-DD" に正規化して文字列比較 (uploadedAt は "2026-09-26 12:34" 形式)
  const normDate = (s) => String(s || "").trim().replace(/\//g, "-");
  const fromD = normDate(from);
  const toD = normDate(to);
  const fromOk = /^\d{4}-\d{2}-\d{2}$/.test(fromD);
  const toOk = /^\d{4}-\d{2}-\d{2}$/.test(toD);
  const out = entries.filter((e) => {
    const flatTags = Object.entries(e.tags).flatMap(([ns, vals]) =>
      (Array.isArray(vals) ? vals : []).map((v) => `${ns}:${String(v).toLowerCase()}`));
    for (const t of tagTerms) {
      if (!flatTags.some((ft) => ft.includes(t))) return false;
    }
    const hay = [e.title, e.category, ...flatTags].join(" ").toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return false;
    // 日付範囲 (uploadedAt 先頭 10 文字 = YYYY-MM-DD で比較)
    const up = e.uploadedAt.slice(0, 10);
    if (fromOk && (!up || up < fromD)) return false;
    if (toOk && (!up || up > toD)) return false;
    // 評価下限
    if (minRating != null && (e.rating == null || e.rating < minRating)) return false;
    return true;
  });
  return out.map((e) => ({ dir: e.dir, title: e.title, category: e.category, tags: e.tags, uploadedAt: e.uploadedAt, rating: e.rating }));
}

// 登録済みタグの一覧 (namespace ごとに集計、件数付き)
async function collectTags(baseAbs) {
  const { entries } = await getSearchIndex(baseAbs);
  const byNs = {};
  for (const e of entries) {
    for (const [ns, vals] of Object.entries(e.tags)) {
      if (!Array.isArray(vals)) continue;
      byNs[ns] = byNs[ns] || {};
      for (const v of vals) byNs[ns][v] = (byNs[ns][v] || 0) + 1;
    }
  }
  return byNs;
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

function openBrowser(url, windowSize = null) {
  try {
    if (process.platform === "win32") {
      // Edge の --app モードを優先: アドレスバー無しの専用ウィンドウで開く (ネイティブアプリ風)。
      // Edge が見つからない環境では従来どおり既定ブラウザにフォールバック。
      const edgeCandidates = [
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(process.env["LocalAppData"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
      ].filter((p) => p && p !== "\\Microsoft\\Edge\\Application\\msedge.exe");
      const edge = edgeCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
      if (edge) {
        // --app ウィンドウは Edge プロセスが生きている間だけ開くため detached で起動する
        const sz = windowSize ? `--window-size=${windowSize.w},${windowSize.h}` : "--window-size=1280,860";
        spawn(edge, ["--app=" + url, sz], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
        return;
      }
      exec(`start "" "${url}"`);
    } else if (process.platform === "darwin") exec(`open "${url}"`);
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

      if (p === "/api/search") {
        const q = u.searchParams.get("q") || "";
        const tag = u.searchParams.get("tag") || "";
        const from = u.searchParams.get("from") || "";
        const to = u.searchParams.get("to") || "";
        const minRatingRaw = u.searchParams.get("minRating");
        const minRating = minRatingRaw != null && minRatingRaw !== "" ? Math.min(5, Math.max(0, parseFloat(minRatingRaw))) : null;
        const results = await searchGalleries(baseDir, { q, tag, from, to, minRating });
        return sendJson(res, { q, tag, from, to, minRating, count: results.length, results });
      }

      if (p === "/api/tags") {
        const byNs = await collectTags(baseDir);
        return sendJson(res, { tags: byNs });
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
:root {
  --bg: #0b0d12;
  --bg-elev: rgba(22, 26, 36, .82);
  --bg-input: rgba(10, 12, 18, .6);
  --border: rgba(255, 255, 255, .08);
  --border-strong: rgba(255, 255, 255, .16);
  --text: #e7eaf0;
  --text-dim: #9aa3b2;
  --text-faint: #6b7484;
  --accent: #6ea8ff;
  --accent-soft: rgba(110, 168, 255, .14);
  --accent-strong: rgba(110, 168, 255, .28);
  --danger: #ff7a90;
  --radius: 10px;
  --radius-sm: 8px;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font-family: "Segoe UI Variable Display", "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif; overflow: hidden;
  -webkit-font-smoothing: antialiased; }

/* ── ヘッダー (フローティング・ガラス風) ───────────────── */
header { position: fixed; top: 10px; left: 12px; right: 12px; height: 48px; z-index: 20;
  display: flex; align-items: center; gap: 5px; padding: 0 10px;
  background: var(--bg-elev); backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .45); }
header .grow { flex: 1; }

button { background: rgba(255, 255, 255, .04); color: var(--text); border: 1px solid transparent;
  border-radius: var(--radius-sm); padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap;
  font-family: inherit; transition: background .15s, border-color .15s, color .15s, transform .1s; }
button:hover { background: var(--accent-soft); color: var(--accent);
  border-color: var(--accent-strong); }
button:active { transform: scale(.96); }
button:disabled { opacity: .3; cursor: default; border-color: transparent; }
button.on { background: var(--accent-strong); border-color: var(--accent); color: #dce9ff; }

#crumb { font-size: 13px; color: var(--text-dim); margin: 0 8px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }

/* ── サムネイルグリッド ─────────────────────────── */
#grid { position: fixed; top: 70px; left: 0; right: 0; bottom: 44px; overflow: auto; padding: 8px 16px 20px; }
.sec-label { width: 100%; color: var(--text-faint); font-size: 12px; margin: 2px 4px 8px;
  letter-spacing: .04em; }
.folders { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.folders button { border-radius: 999px; padding: 7px 15px; font-size: 13px;
  background: rgba(255, 255, 255, .05); border: 1px solid var(--border); color: var(--text); }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.thumb { position: relative; height: 200px; background: rgba(255, 255, 255, .03);
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; cursor: zoom-in;
  display: flex; align-items: center; justify-content: center;
  transition: transform .18s ease, border-color .18s, box-shadow .18s; }
.thumb:hover { border-color: var(--accent); transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, .5), 0 0 0 1px var(--accent-strong); }
.thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.thumb .no { position: absolute; left: 8px; bottom: 6px; font-size: 11px; color: #cfd6e4;
  background: rgba(8, 10, 16, .7); backdrop-filter: blur(6px);
  padding: 2px 8px; border-radius: 6px; font-variant-numeric: tabular-nums; }

.empty { color: var(--text-faint); padding: 64px; text-align: center; font-size: 14px; }

/* ── 画像ステージ ─────────────────────────── */
#stage { position: fixed; top: 70px; left: 0; right: 0; bottom: 40px; overflow: hidden; background: var(--bg); }
#wrap { position: absolute; transform-origin: center; will-change: transform; }
#img { display: block; user-select: none; -webkit-user-drag: none;
  border-radius: 4px; box-shadow: 0 12px 48px rgba(0, 0, 0, .6); }

/* ── ステータスバー ─────────────────────────── */
#status { position: fixed; left: 12px; right: 12px; bottom: 10px; height: 28px; z-index: 20;
  display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-elev); backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border: 1px solid var(--border); border-radius: 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.hide { display: none !important; }

/* ── ヘルプ / モーダル ─────────────────────────── */
#help { position: fixed; inset: 0; background: rgba(4, 6, 10, .6); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); z-index: 50;
  display: flex; align-items: center; justify-content: center; }
#help .box { background: var(--bg-elev); backdrop-filter: blur(24px);
  border: 1px solid var(--border-strong); border-radius: 16px;
  padding: 24px 30px; font-size: 13px; line-height: 2.2; max-width: 580px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, .6); }
#help h2 { margin: 0 0 12px; font-size: 15px; color: var(--accent); letter-spacing: .02em; }
#help kbd { background: rgba(255, 255, 255, .07); border: 1px solid var(--border-strong);
  border-bottom-width: 2px; border-radius: 5px; padding: 1px 7px;
  font-family: Consolas, monospace; font-size: 12px; color: var(--text); }

/* ── トースト ─────────────────────────── */
#toast { position: fixed; bottom: 52px; left: 50%; transform: translateX(-50%) translateY(8px);
  background: var(--bg-elev); backdrop-filter: blur(18px);
  border: 1px solid var(--accent-strong); color: #dce9ff; padding: 8px 18px;
  border-radius: 10px; font-size: 13px; z-index: 60; opacity: 0; pointer-events: none;
  box-shadow: 0 10px 32px rgba(0, 0, 0, .5);
  transition: opacity .25s, transform .25s; }
#toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ── 検索パネル ─────────────────────────── */
#search-panel { position: fixed; top: 66px; left: 50%; transform: translateX(-50%);
  z-index: 50; width: min(740px, 92vw); }
#search-panel .box { background: var(--bg-elev); backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: 1px solid var(--border-strong); border-radius: 16px; padding: 14px 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .55); }
.search-row { display: flex; gap: 8px; }
.search-row input { flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px;
  font-family: inherit; transition: border-color .15s, background .15s; }
.search-row input:focus { outline: none; border-color: var(--accent);
  background: rgba(10, 12, 18, .85); box-shadow: 0 0 0 3px var(--accent-soft); }
.search-row input[type="date"] { flex: 0 1 150px; color-scheme: dark; }
.search-row select { background: var(--bg-input); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; font-family: inherit; }
.date-sep { color: var(--text-faint); align-self: center; }
.search-row button { background: var(--accent-strong); border: 1px solid var(--accent); color: #dce9ff;
  border-radius: var(--radius-sm); padding: 8px 16px; cursor: pointer; font-size: 13px; }
#search-close { background: rgba(255, 255, 255, .05); border-color: var(--border); color: var(--text-dim); }
#tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; max-height: 170px; overflow: auto; }
#tag-cloud button { background: rgba(110, 168, 255, .08); border: 1px solid transparent; color: #a9c7f5;
  border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
#tag-cloud button:hover { border-color: var(--accent); background: var(--accent-soft); }

/* ── 検索結果 ─────────────────────────── */
#search-results { position: fixed; top: 70px; left: 0; right: 0; bottom: 0; z-index: 40;
  background: var(--bg); padding: 12px 16px; overflow: auto; }
.sr-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
#sr-label { color: var(--text-dim); font-size: 13px; }
#sr-clear { background: rgba(255, 255, 255, .05); border: 1px solid var(--border); color: var(--text-dim);
  border-radius: var(--radius-sm); padding: 5px 12px; cursor: pointer; font-size: 12px; }

/* ── スクロールバー ─────────────────────────── */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .12); border-radius: 999px;
  border: 2px solid var(--bg); }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, .22); }
</style>
</head>
<body>
<header>
  <button id="btn-grid" title="一覧表示 (g)">一覧</button>
  <span id="crumb"></span>
  <button id="btn-prevf" title="前のフォルダ (PageUp)">‹ 前フォルダ</button>
  <button id="btn-nextf" title="次のフォルダ (PageDown)">次フォルダ ›</button>
  <button id="btn-search" title="タグ検索 (/)">🔍 検索</button>
  <span class="grow"></span>
  <button id="btn-zout" title="ズームアウト (-)">−</button>
  <span id="zoomlabel" style="font-size:12px;color:#9a9aa4;min-width:52px;text-align:center">フィット</span>
  <button id="btn-zin" title="ズームイン (+)">＋</button>
  <button id="btn-fit" title="ウィンドウにフィット (0)">フィット</button>
  <button id="btn-100" title="等倍 (100%)">100%</button>
  <button id="btn-rot" title="回転 (r)">回転</button>
  <button id="btn-slide" title="スライドショー (s)">▶ スライド</button>
  <button id="btn-full" title="フルスクリーン (f)">⛶</button>
  <button id="btn-help" title="操作ヘルプ (?)">？</button>
  <button id="btn-quit" title="サーバーを終了">✕ 終了</button>
</header>

<main id="grid"></main>

<div id="stage" class="hide">
  <div id="wrap"><img id="img" alt=""></div>
</div>

<footer id="status" class="hide"></footer>

<div id="search-panel" class="hide">
  <div class="box">
    <div class="search-row">
      <input id="search-input" type="text" placeholder="検索語 (タイトル / タグ) 例: alice honkai">
      <input id="search-tag" type="text" placeholder="タグ (namespace:値) 例: artist:alice">
      <button id="search-go">検索</button>
      <button id="search-close">閉じる</button>
    </div>
    <div class="search-row" style="margin-top:8px">
      <input id="search-from" type="date" title="投稿日 (from)">
      <span class="date-sep">〜</span>
      <input id="search-to" type="date" title="投稿日 (to)">
      <select id="search-rating" title="最低評価">
        <option value="">評価指定なし</option>
        <option value="4.5">★ 4.5+</option>
        <option value="4">★ 4.0+</option>
        <option value="3.5">★ 3.5+</option>
        <option value="3">★ 3.0+</option>
      </select>
    </div>
    <div id="tag-cloud"></div>
  </div>
</div>

<div id="search-results" class="hide">
  <div class="sr-head">
    <span id="sr-label"></span>
    <button id="sr-clear">× 検索をやめる</button>
  </div>
  <div id="sr-body" class="folders"></div>
</div>

<div id="help" class="hide">
  <div class="box">
    <h2>操作方法</h2>
    <kbd>←</kbd>/<kbd>→</kbd> / <kbd>Space</kbd> 前・次の画像　<kbd>Home</kbd>/<kbd>End</kbd> 先頭・末尾<br>
    <kbd>PageUp</kbd>/<kbd>PageDown</kbd> 前・次のフォルダ（兄弟フォルダを巡回）<br>
    <kbd>-</kbd> / <kbd>+</kbd> / <kbd>0</kbd> ズーム / フィット　<kbd>r</kbd> 回転　<kbd>s</kbd> スライドショー<br>
    <kbd>f</kbd> フルスクリーン　<kbd>g</kbd> 一覧に戻る　<kbd>Esc</kbd> 閉じる　<kbd>/</kbd> タグ検索<br>
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
function quitApp() {
  if (!confirm('ビューワー（ローカルサーバー）を終了しますか？')) return;
  fetch('/api/quit').then(function () {
    toast('終了しました。このタブを閉じてください');
  }).catch(function () {
    toast('終了しました。このタブを閉じてください');
  });
}

// --- タグ検索 ---
function openSearch() {
  $('search-panel').classList.remove('hide');
  $('search-input').focus();
  api('/api/tags').then(function (d) {
    var cloud = $('tag-cloud');
    cloud.textContent = '';
    Object.keys(d.tags).sort().forEach(function (ns) {
      var vals = d.tags[ns];
      Object.keys(vals).sort(function (a, b) { return vals[b] - vals[a]; }).forEach(function (v) {
        var b = document.createElement('button');
        b.textContent = ns + ':' + v + ' (' + vals[v] + ')';
        b.onclick = function () {
          $('search-tag').value = ns + ':' + v;
          runSearch();
        };
        cloud.appendChild(b);
      });
    });
    if (!cloud.children.length) cloud.textContent = 'タグが見つかりません (metadata.json があるフォルダがありません)';
  }).catch(function () {});
}
function closeSearch() {
  $('search-panel').classList.add('hide');
  $('search-results').classList.add('hide');
}
function runSearch() {
  var q = $('search-input').value.trim();
  var tag = $('search-tag').value.trim();
  var from = $('search-from').value;
  var to = $('search-to').value;
  var minRating = $('search-rating').value;
  if (!q && !tag && !from && !to && !minRating) { toast('検索条件を入力してください'); return; }
  var qs = [];
  if (q) qs.push('q=' + encodeURIComponent(q));
  if (tag) qs.push('tag=' + encodeURIComponent(tag));
  if (from) qs.push('from=' + encodeURIComponent(from));
  if (to) qs.push('to=' + encodeURIComponent(to));
  if (minRating) qs.push('minRating=' + encodeURIComponent(minRating));
  api('/api/search?' + qs.join('&')).then(function (d) {
    $('search-panel').classList.add('hide');
    var panel = $('search-results');
    var body = $('sr-body');
    body.textContent = '';
    var conds = [];
    if (q) conds.push('語: ' + q);
    if (tag) conds.push('タグ: ' + tag);
    if (from || to) conds.push('日付: ' + (from || '…') + '〜' + (to || '…'));
    if (minRating) conds.push('評価: ' + minRating + '+');
    $('sr-label').textContent = '検索結果: ' + d.count + ' 件' + (conds.length ? ' (' + conds.join(' / ') + ')' : '');
    if (!d.count) {
      var em = document.createElement('div');
      em.className = 'empty';
      em.textContent = '一致するギャラリーがありません。';
      body.appendChild(em);
    }
    d.results.forEach(function (r) {
      var b = document.createElement('button');
      var tagCount = Object.values(r.tags).reduce(function (s, a) { return s + a.length; }, 0);
      var extra = [];
      if (r.uploadedAt) extra.push(r.uploadedAt.slice(0, 10));
      if (r.rating != null) extra.push('★' + r.rating);
      b.textContent = '📁 ' + (r.title || r.dir) + (r.category ? '  [' + r.category + ']' : '') + '  (' + tagCount + ' タグ)' + (extra.length ? '  ' + extra.join(' / ') : '');
      b.title = r.dir;
      b.onclick = function () {
        closeSearch();
        loadDir(r.dir, 0);
      };
      body.appendChild(b);
    });
    panel.classList.remove('hide');
  }).catch(function (e) { toast('検索に失敗: ' + e.message); });
}
$('btn-search').onclick = openSearch;
$('search-go').onclick = runSearch;
$('search-close').onclick = closeSearch;
$('sr-clear').onclick = closeSearch;
$('search-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
$('search-tag').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });

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
  // 検索パネル / 入力フィールド中は通常のキー操作を無効化
  var inSearch = !$('search-panel').classList.contains('hide');
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    if (e.key === 'Escape') { closeSearch(); e.preventDefault(); }
    return;
  }
  if (inSearch && e.key === 'Escape') { closeSearch(); e.preventDefault(); return; }
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
    case '/': openSearch(); e.preventDefault(); break;
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

  if (opts.open) openBrowser(url, opts.windowSize);

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
