#!/usr/bin/env node
/**
 * E-Hentai gallery downloader (Node.js, 依存ライブラリなし)
 *
 * 使い方:
 *   node eh_download.mjs <ギャラリーURL...> [保存先ディレクトリ] [オプション]
 *   node eh_download.mjs --list <URL一覧ファイル> [保存先ディレクトリ] [オプション]
 *
 * 例:
 *   node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/
 *   node eh_download.mjs https://e-hentai.org/g/AAA/xxx/ https://e-hentai.org/g/BBB/yyy/   # 複数URLを連続指定
 *   node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/ ./pics --original
 *   node eh_download.mjs <URL> --parallel 3 --delay 1
 *   node eh_download.mjs --list urls.txt ./pics --parallel 3
 *
 * URL一覧ファイルの形式 (1行1URL, # 以降はコメント, 空行は無視):
 *   # お気に入り
 *   https://e-hentai.org/g/3553112/f4c015ef04/
 *   https://e-hentai.org/g/1234567/abcdef1234/  # 行末コメントも可
 *
 * オプション:
 *   --list <file>   URL一覧ファイルを一括処理 (1行1URL)。URL直指定との併用は不可
 *   --parallel N    同時接続数 (デフォルト: 2。推奨 2〜3)
 *   --original      オリジナル画質を試みる (要ログインCookie。失敗時は通常画質にフォールバック)
 *   --cookie "..."  Cookie文字列 (exhentai.org や --original にはログインCookieが必要)
 *   --delay 秒      リクエスト間隔 (デフォルト: 1.2)
 *   --resync        差分更新モード: 既存フォルダに再実行して新規ページだけ取得。
 *                   欠けたページ番号・消えたファイルを検出して報告する
 *   --retries N     失敗時の最大試行回数 (デフォルト: ページ 5 / 画像 4。1 で再試行なし)
 *   --convert F     ダウンロード完了後に png / jpeg へ変換
 *   --quality N     --convert jpeg の品質 1-100 (デフォルト: 90)
 *   --del           --convert 成功後に元の WebP を削除
 *   --no-metadata   metadata.json を保存しない
 *   --help          ヘルプ表示
 *
 * 環境変数 EH_COOKIE でもCookieを渡せます。
 * 再実行するとダウンロード済みのファイルはスキップされます(レジューム)。
 *
 * 509対策 (節度付き並列):
 *   - リクエストの開始間隔は全接続で共有 (--delay が全体の最小インターバル)。
 *     そのためリクエストレートは逐次版と同じで、画像の転送時間だけ並列化される。
 *   - 509/帯域制限を検出すると全接続が一時停止し、全員で自動再試行する。
 *   - バッチモードではギャラリー間でも --delay x 2 の間隔を空ける。
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------- 引数解析 ----------
// モジュール top-level での argv 解析は行わない (単一exe埋め込み時は runDownload(argv)
// 経由で実行されるため)。直接実行時は末尾の isDirectRun ブロックから batchMain() が呼ばれる。
// 実行パラメータは batchMain() 冒頭で代入する (取得系関数から参照されるためモジュールスコープ)。
let listFile = null, urlArgs = [], outRoot = ".";
let wantOriginal = false, cookie = "", delayMs = 1200, parallel = 2, resync = false;
let timeoutSec = null, retries = null;
let timeoutMsPage = 45000, timeoutMsImage = 120000, maxRetriesPage = 5, maxRetriesImage = 4;
let convertFormat = null, convertQuality = 90, deleteAfterConvert = false, saveMetadata = true;

function printHelpFromComment() {
  try {
    const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n");
    const end = lines.findIndex((l) => l.trim() === "*/");
    console.log(lines.slice(1, end).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  } catch {
    // SEA (単一exe) ではソースが読めないため固定文字列で代替
    console.log("使い方: eh_download.mjs <ギャラリーURL...> [保存先ディレクトリ] [オプション]\n\nオプション:\n  --list <file>   URL一覧ファイルを一括処理 (1行1URL)\n  --parallel N    同時接続数 (デフォルト: 2。推奨 2〜3)\n  --original      オリジナル画質を試みる (要ログインCookie)\n  --cookie \"...\" Cookie文字列 (exhentai.org や --original には必要)\n  --delay 秒      リクエスト間隔 (デフォルト: 1.2)\n  --timeout 秒    リクエストのタイムアウト秒数 (デフォルト: ページ 45 / 画像 120)\n  --retries N     失敗時の最大試行回数 (デフォルト: ページ 5 / 画像 4。1 で再試行なし)\n  --resync        差分更新モード (欠けページの検出・報告付きで再同期)\n  --help          ヘルプ表示\n\n環境変数 EH_COOKIE でもCookieを渡せます。\n再実行するとダウンロード済みのファイルはスキップされます(レジューム)。");
  }
}

function parseCli(args) {
  // 値を1つ取るオプションの次の引数は位置引数から除外する
  const VALUE_FLAGS = new Set(["--cookie", "--delay", "--parallel", "-j", "--list", "--convert", "--quality", "--timeout", "--retries"]);
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (args[i].startsWith("--")) continue;
    positionals.push(args[i]);
  }

  const listFlagIdx = args.indexOf("--list");
  let listFile = listFlagIdx !== -1 ? args[listFlagIdx + 1] : null;

  // 位置引数を URL とそれ以外 (保存先など) に分類 → 複数 URL の直接指定が可能に
  const urlArgs = positionals.filter((p) => /^https?:\/\//i.test(p));
  const dirArgs = positionals.filter((p) => !/^https?:\/\//i.test(p));

  // --list 未指定でも、非 URL 位置引数に実在ファイルがあれば一覧ファイルとして扱う (位置は不問)
  if (!listFile) {
    const fileIdx = dirArgs.findIndex((d) => { try { return fs.statSync(d).isFile(); } catch { return false; } });
    if (fileIdx !== -1) listFile = dirArgs.splice(fileIdx, 1)[0];
  }
  // 保存先は残った非 URL 位置引数の先頭 (省略時はカレントディレクトリ)
  const outRoot = dirArgs[0] || ".";

  const wantOriginal = args.includes("--original");
  const cookieArgIdx = args.indexOf("--cookie");
  const cookie = cookieArgIdx !== -1 ? args[cookieArgIdx + 1] : process.env.EH_COOKIE || "";
  const delayIdx = args.indexOf("--delay");
  const delayMs = Math.round((delayIdx !== -1 ? parseFloat(args[delayIdx + 1]) : 1.2) * 1000);
  const parallelIdx = Math.max(args.indexOf("--parallel"), args.indexOf("-j"));
  const parallel = Math.max(1, parallelIdx !== -1 ? parseInt(args[parallelIdx + 1], 10) || 2 : 2);
  const convertIdx = args.indexOf("--convert");
  const convertArg = convertIdx !== -1 ? (args[convertIdx + 1] || "").toLowerCase() : null;
  const convertFormat = convertArg === "jpg" ? "jpeg" : convertArg;
  const qualityIdx = args.indexOf("--quality");
  const convertQuality = qualityIdx !== -1 ? Math.min(100, Math.max(1, parseInt(args[qualityIdx + 1], 10) || 90)) : 90;
  const deleteAfterConvert = args.includes("--del");
  const saveMetadata = !args.includes("--no-metadata");
  const resync = args.includes("--resync");

  // タイムアウト (秒) / リトライ回数。未指定時は従来の内部固定値を使う
  const timeoutIdx = args.indexOf("--timeout");
  const timeoutSec = timeoutIdx !== -1 ? parseFloat(args[timeoutIdx + 1]) : NaN;
  const retriesIdx = args.indexOf("--retries");
  const retries = retriesIdx !== -1 ? parseInt(args[retriesIdx + 1], 10) : NaN;
  if (timeoutIdx !== -1 && (!Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
    console.error("エラー: --timeout には正の数値 (秒) を指定してください");
    process.exit(1);
  }
  if (retriesIdx !== -1 && (!Number.isInteger(retries) || retries < 1 || retries > 20)) {
    console.error("エラー: --retries には 1-20 の整数を指定してください (1 = 再試行なし)");
    process.exit(1);
  }

  return {
    listFile, urlArgs, outRoot, wantOriginal, cookie, delayMs, parallel, resync,
    convertFormat, convertQuality, deleteAfterConvert, saveMetadata,
    timeoutSec: Number.isFinite(timeoutSec) ? timeoutSec : null,
    retries: Number.isInteger(retries) ? retries : null,
  };
}

// ---------- ユーティリティ ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

function sanitizeGalleryDirName(title, gid) {
  let safe = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .replace(/[. ]+$/g, "");

  if (!safe) return `gallery_${gid}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[ .]|$)/i.test(safe)) {
    safe = `_${safe}`;
  }
  return `${gid}_${safe}`;
}

function convertDownloadedGallery(outDir) {
  const webpFiles = fs.readdirSync(outDir).filter((name) => /\.webp$/i.test(name));
  if (webpFiles.length === 0) {
    log("▶ 変換対象の WebP がないため変換をスキップ");
    return;
  }

  const converter = fileURLToPath(new URL("./convert_images.mjs", import.meta.url));
  const converterArgs = [
    converter,
    outDir,
    "--format", convertFormat,
    "--quality", String(convertQuality),
  ];
  if (deleteAfterConvert) converterArgs.push("--del");

  log(`▶ ダウンロード完了 → ${convertFormat.toUpperCase()} 変換を開始`);
  const result = spawnSync(process.execPath, converterArgs, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`convert_images.mjs が終了コード ${result.status} で失敗しました`);
  }
}


function htmlText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function extractGalleryMetadata(html, galleryUrl, gid, title) {
  const categoryMatch = html.match(/id=["']gdc["'][^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const category = categoryMatch ? htmlText(categoryMatch[1]) : null;

  const field = (label) => {
    const re = new RegExp(
      `<td[^>]*>\\s*${label}:?\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
      "i",
    );
    const match = html.match(re);
    return match ? htmlText(match[1]) : null;
  };

  const ratingLabel = html.match(/id=["']rating_label["'][^>]*>([\s\S]*?)<\//i);
  const posted = field("Posted");
  const rating = ratingLabel ? htmlText(ratingLabel[1]).replace(/^Average:\s*/i, "") : field("Rating");

  const tags = { artist: [], character: [], series: [], language: [], category: [] };
  const rowRe = /<tr[^>]*>\s*<td[^>]*class=["'][^"']*\btc\b[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const namespace = htmlText(row[1]).replace(/:$/, "").toLowerCase();
    const mapped = namespace === "parody" ? "series" : namespace;
    if (!(mapped in tags)) continue;

    const values = [];
    const linkRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    let link;
    while ((link = linkRe.exec(row[2])) !== null) {
      const value = htmlText(link[1]);
      if (value && !values.includes(value)) values.push(value);
    }
    tags[mapped].push(...values.filter((value) => !tags[mapped].includes(value)));
  }
  if (category && !tags.category.includes(category)) tags.category.push(category);

  return {
    galleryUrl,
    galleryId: gid,
    title,
    category,
    uploadedAt: posted,
    rating,
    tags,
  };
}

// ---------- 全接続共有のレート制限 ----------
// lastStart: 直前のリクエスト開始時刻 / pauseUntil: 509検出時に全ワーカーが待つ時刻
let lastStart = 0;
let pauseUntil = 0;
let currentProgress = null;

function formatLimitWait(sec, snapshot = currentProgress?.()) {
  if (!snapshot) return `509: ${sec}秒待機中`;
  const remaining = Math.max(0, Number(snapshot.remaining) || 0);
  const etaMinutes = Math.max(0, Number(snapshot.etaMinutes) || 0);
  const eta = etaMinutes > 0 ? `${etaMinutes}分` : "1分未満";
  return `509: ${sec}秒待機中 (残り ${remaining} 枚 / 推定 ${eta})`;
}

function isExhentaiNlPage(html) {
  if (/\/s\/[0-9a-f]{10}\//i.test(html)) return false;
  return /content\s*warning|never\s*warn\s*me\s*again|[?&](?:nl|incognito)=1|name=["']nl["']/i.test(html);
}

function withNlBypass(url) {
  const next = new URL(url);
  next.searchParams.set("nl", "1");
  return next.href;
}

async function acquireSlot() {
  for (;;) {
    const now = Date.now();
    const wait = Math.max(lastStart + delayMs - now, pauseUntil - now);
    if (wait <= 0) {
      lastStart = Date.now();
      return;
    }
    await sleep(wait + Math.random() * 250); // ジッターで再開時の同時突撃を防ぐ
  }
}

const isLimitError = (msg) => /509|帯域/.test(msg);
// 404/410/401 などは再試行しても意味がない (削除済み・死 URL・認証不足) ので即失敗
const isPermanentHttpError = (msg) => /^HTTP (401|403|404|410)\b/.test(msg);

function waitOrAbort(e, attempt, maxAttempts, retryLog) {
  if (attempt >= maxAttempts || isPermanentHttpError(e.message)) {
    if (isPermanentHttpError(e.message)) log(`  ✖ ${e.message} (再試行不可のエラーのため即失敗)`);
    throw e;
  }
  retryLog(attempt);
  return sleep(attempt * 3000);
}

async function fetchText(url, referer) {
  for (let attempt = 1; attempt <= maxRetriesPage; attempt++) {
    try {
      await acquireSlot();
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
          ...(referer ? { Referer: referer } : {}),
          ...(cookie && /e-hentai\.org|exhentai\.org/.test(new URL(url).host) ? { Cookie: cookie } : {}),
        },
        signal: AbortSignal.timeout(timeoutMsPage),
        redirect: "follow",
      });
      const body = await res.text();
      if (res.status === 403 && /Just a moment|cf-browser-verification/i.test(body)) {
        throw new Error("Cloudflareのチェックページが返されました。時間をおくか --cookie を試してください。");
      }
      // 509は実際のステータスコードか明確なフレーズのみで判定 (広告IDなどの誤検知を防ぐ)
      if (res.status === 509 || /your (ip|bandwidth)|temporarily (banned|suspended)|bandwidth.{0,30}(exceeded|limit)/i.test(body.slice(0, 3000))) {
        throw new Error(`509: 帯域/速度制限です (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return body;
    } catch (e) {
      if (isLimitError(e.message)) {
        if (attempt === maxRetriesPage) throw e;
        const sec = 60 * attempt;
        pauseUntil = Math.max(pauseUntil, Date.now() + sec * 1000);
        log(`⚠ 509検出: 全${parallel}接続を${sec}秒停止 / ${formatLimitWait(sec)} → 自動再試行 (${attempt}/${maxRetriesPage})`);
      } else {
        await waitOrAbort(e, attempt, maxRetriesPage, (a) => log(`  ! 取得失敗 (${e.message}) - ${a * 3}秒後に再試行 (${a}/${maxRetriesPage})...`));
      }
    }
  }
}

async function fetchGalleryText(url, referer) {
  let body = await fetchText(url, referer);
  if (new URL(url).hostname.toLowerCase() !== "exhentai.org" || !isExhentaiNlPage(body)) {
    return body;
  }

  if (!cookie) {
    throw new Error("ExHentai 用の cookie が不足しています (--cookie または EH_COOKIE を指定してください)");
  }

  const bypassUrl = withNlBypass(url);
  log("▶ ExHentai の Content Warning を検出: nl=1 で再取得します");
  body = await fetchText(bypassUrl, referer);
  if (isExhentaiNlPage(body)) {
    throw new Error("ExHentai の Content Warning を解除できません。cookie が有効か確認してください");
  }
  return body;
}

async function fetchImage(url, referer, dest) {
  for (let attempt = 1; attempt <= maxRetriesImage; attempt++) {
    try {
      await acquireSlot();
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
          ...(referer ? { Referer: referer } : {}),
          ...(cookie && /e-hentai\.org|exhentai\.org/.test(new URL(url).host) ? { Cookie: cookie } : {}),
        },
        signal: AbortSignal.timeout(timeoutMsImage),
        redirect: "follow",
      });
      const type = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      // 画像のはずがHTMLが返ってきたら失敗(NLループや帯域制限など)→リトライ
      if (res.ok && type.startsWith("image/")) {
        fs.writeFileSync(dest, buf);
        return { ok: true, size: buf.length, type };
      }
      const asText = buf.toString("utf8").slice(0, 500);
      if (res.status === 509 || /temporarily suspended|Please wait.*retry/i.test(asText)) {
        const sec = 60 * attempt;
        pauseUntil = Math.max(pauseUntil, Date.now() + sec * 1000);
        throw new Error(formatLimitWait(sec));
      }
      throw new Error(type.startsWith("text/html") ? "HTMLが返された(要ログインの可能性)" : `HTTP ${res.status}`);
    } catch (e) {
      if (isLimitError(e.message)) {
        if (attempt === maxRetriesImage) return { ok: false, size: 0, error: e.message };
        log(`⚠ ${e.message} (${attempt}/${maxRetriesImage})`); // 待機は acquireSlot が全ワーカー共通で処理
      } else {
        try {
          await waitOrAbort(e, attempt, maxRetriesImage, (a) => log(`  ! ${e.message} → ${a * 5}秒後に再試行 (${a}/${maxRetriesImage})`));
        } catch (e2) {
          return { ok: false, size: 0, error: e2.message };
        }
      }
    }
  }
}

// ---------- ギャラリーページ解析 ----------
function collectImagePages(html, baseUrl) {
  const out = [];
  const re = /href="([^"]*\/s\/[0-9a-f]{10}\/[0-9]+-\d+\/?)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1].startsWith("http") ? m[1] : new URL(m[1], baseUrl).href);
  }
  return out;
}

function collectPaginationPages(html) {
  const out = new Set([0]);
  const re = /href="([^"]*\?p=(\d+))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.add(parseInt(m[2], 10));
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- 1ギャラリーのダウンロード ----------
async function downloadGallery(galleryUrl) {
  const host = new URL(galleryUrl).host; // e-hentai.org / exhentai.org
  log(`▶ ギャラリー: ${galleryUrl}`);

  // 1) 1ページ目を取得
  const firstHtml = await fetchGalleryText(galleryUrl);
  if (!/\/s\/[0-9a-f]{10}\//.test(firstHtml)) {
    if (host === "exhentai.org") {
      throw new Error(
        cookie
          ? "ExHentai のギャラリーを取得できません。URLまたはcookieが有効か確認してください"
          : "ExHentai 用の cookie が不足しています (--cookie または EH_COOKIE を指定してください)",
      );
    }
    throw new Error("サムネイルが見つかりません (URLが無効/削除済み/要Cookieの可能性)");
  }

  // タイトル取得
  const tMatch = firstHtml.match(/<h1 id="gn">([\s\S]*?)<\/h1>/) || firstHtml.match(/<title>([\s\S]*?)<\/title>/);
  const title = tMatch ? decodeEntities(tMatch[1].replace(/<[^>]*>/g, "")).replace(/ - E-Hentai.*/, "") : "gallery";
  const gidMatch = galleryUrl.match(/\/g\/(\d+)\//);
  const gid = gidMatch ? gidMatch[1] : "gallery";
  const dirName = sanitizeGalleryDirName(title, gid);
  const outDir = path.resolve(outRoot, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  log(`▶ 保存先: ${outDir}`);

  if (saveMetadata) {
    const metadata = extractGalleryMetadata(firstHtml, galleryUrl, gid, title);
    fs.writeFileSync(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  }

  // 2) 全ページから画像ページURLを収集 (一覧は逐次で取得)
  const pageNums = collectPaginationPages(firstHtml);
  log(`▶ ギャラリー一覧ページ数: ${pageNums.length}`);
  const pageUrls = pageNums.map((n) => (n === 0 ? galleryUrl : `${galleryUrl.replace(/\/$/, "")}/?p=${n}`));

  const imagePageUrls = [];
  const seenPages = new Set();
  for (let i = 0; i < pageUrls.length; i++) {
    const html = i === 0 ? firstHtml : await fetchGalleryText(pageUrls[i], galleryUrl);
    const urls = collectImagePages(html, pageUrls[i]);
    let added = 0;
    for (const u of urls) {
      const n = parseInt((u.match(/-(\d+)\/?$/) || [])[1], 10);
      if (!seenPages.has(n)) {
        seenPages.add(n);
        imagePageUrls.push(u);
        added++;
      }
    }
    log(`  一覧 ${i + 1}/${pageUrls.length}: +${added} 枚 (計 ${imagePageUrls.length})`);
    if (i < pageUrls.length - 1) await sleep(delayMs);
  }
  imagePageUrls.sort((a, b) => {
    const na = parseInt((a.match(/-(\d+)\/?$/) || [])[1], 10);
    const nb = parseInt((b.match(/-(\d+)\/?$/) || [])[1], 10);
    return na - nb;
  });
  const total = imagePageUrls.length;
  if (total === 0) throw new Error("画像ページが見つかりませんでした");
  const pad = String(total).length;

  // 3) index.json と実ファイルからレジューム情報を復元
  const indexFile = path.join(outDir, "index.json");
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
  const saveIndex = () => fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
  for (const f of fs.readdirSync(outDir)) {
    const m = f.match(/^(\d+)\.(webp|jpe?g|png|gif)$/i);
    if (m && !index[parseInt(m[1], 10)]) index[parseInt(m[1], 10)] = { file: f };
  }
  saveIndex();

  // --resync: 差分更新の明示モード。既存ファイルの内、index に記録がなく
  // 対応するページ番号が今回の一覧に存在しない場合は「欠け」として報告する。
  // また index に記録があるが実ファイルが消えているページは再取得対象に戻す。
  if (resync) {
    const removed = [];
    for (const [num, rec] of Object.entries(index)) {
      if (rec && rec.file && !fs.existsSync(path.join(outDir, rec.file))) removed.push(parseInt(num, 10));
    }
    if (removed.length > 0) {
      log(`⚠ --resync: index にあるが実ファイルが欠けているページを再取得対象に戻します: ${removed.sort((a, b) => a - b).join(", ")}`);
    }
  }

  // 4) ダウンロード対象を組み立て (取得済みは除外)
  let done = 0, skipped = 0, failed = 0;
  const referer = `https://${host}/`;
  const tasks = [];
  const fetchedPageNums = new Set();
  for (const pageUrl of imagePageUrls) {
    const pageNum = parseInt((pageUrl.match(/-(\d+)\/?$/) || [])[1], 10);
    fetchedPageNums.add(pageNum);
    const rec = index[pageNum];
    if (rec && rec.file && fs.existsSync(path.join(outDir, rec.file)) && fs.statSync(path.join(outDir, rec.file)).size > 0) {
      skipped++;
      continue;
    }
    tasks.push({ pageUrl, pageNum });
  }

  // --resync: 今回の一覧に無いページ番号が index に残っていれば報告する
  // (サイト側で削除されたページ。実ファイルがあればそのまま残す)
  if (resync) {
    const stale = Object.keys(index).map(Number).filter((n) => !fetchedPageNums.has(n));
    if (stale.length > 0) {
      log(`⚠ --resync: サイト側で見つからないページ番号が index に残っています (ファイルはそのまま保持): ${stale.sort((a, b) => a - b).join(", ")}`);
    }
  }

  log(`▶ 設定: 同時${parallel}接続 / 間隔${(delayMs / 1000).toFixed(1)}秒 / 対象${tasks.length}枚 (スキップ${skipped}枚)`);

  // 5) ワーカープールで並列ダウンロード
  let cursor = 0;
  let completedTasks = 0;
  let emaTaskMs = null;
  const progressSnapshot = () => {
    const remaining = Math.max(0, tasks.length - completedTasks);
    const estimatedPerTaskMs = emaTaskMs ?? Math.max(delayMs, 1000);
    return {
      remaining,
      etaMinutes: remaining === 0
        ? 0
        : Math.max(1, Math.ceil((remaining * estimatedPerTaskMs) / 60000)),
    };
  };
  currentProgress = progressSnapshot;

  const runOne = async ({ pageUrl, pageNum }) => {
    const name = String(pageNum).padStart(pad, "0");
    const html = await fetchText(pageUrl, referer);
    const imgMatch = html.match(/<img id="img" src="([^"]+)"/);
    if (!imgMatch) {
      log(`[${name}] ! 画像URLが見つかりません (${pageUrl})`);
      failed++;
      return;
    }
    const imgUrl = decodeEntities(imgMatch[1]);

    // オリジナル画質 (要ログイン)
    if (wantOriginal) {
      const orig = html.match(/href="(https?:\/\/[^"]*\/fullimg\/[^"]+)"/);
      if (orig) {
        const tmp = path.join(outDir, `${name}_orig.bin`);
        const r = await fetchImage(decodeEntities(orig[1]), pageUrl, tmp);
        if (r.ok) {
          const ext = (path.extname(new URL(decodeEntities(orig[1])).pathname) || ".bin").toLowerCase();
          fs.renameSync(tmp, path.join(outDir, name + ext));
          index[pageNum] = { pageUrl, url: imgUrl, original: true, file: name + ext };
          saveIndex();
          log(`[${name}/${total}] OK original ${(r.size / 1024).toFixed(0)}KB ${name + ext}`);
          done++;
          return;
        }
        log(`[${name}] オリジナル取得失敗(${r.error}) → 通常画質で保存`);
        try { fs.unlinkSync(tmp); } catch {}
      }
    }

    const ext = (path.extname(new URL(imgUrl).pathname) || ".jpg").toLowerCase().split("?")[0];
    const dest = path.join(outDir, name + ext);
    const r = await fetchImage(imgUrl, pageUrl, dest);
    if (r.ok) {
      index[pageNum] = { pageUrl, url: imgUrl, original: false, file: name + ext };
      saveIndex();
      log(`[${name}/${total}] OK ${(r.size / 1024).toFixed(0)}KB ${name + ext}`);
      done++;
    } else {
      log(`[${name}/${total}] 失敗: ${r.error}`);
      failed++;
    }
  };

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const startedAt = Date.now();
      try {
        await runOne(tasks[i]);
      } catch (e) {
        failed++;
        log(`[${String(tasks[i].pageNum).padStart(pad, "0")}] 失敗: ${e.message}`);
      } finally {
        const elapsed = Math.max(1, Date.now() - startedAt);
        emaTaskMs = emaTaskMs == null ? elapsed : (emaTaskMs * 0.7) + (elapsed * 0.3);
        completedTasks++;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(parallel, tasks.length) }, worker));
  } finally {
    currentProgress = null;
  }

  saveIndex();
  log(`■ 完了: 新規${done} / スキップ${skipped} / 失敗${failed} → ${outDir}`);
  return { url: galleryUrl, title, outDir, done, skipped, failed };
}

// ---------- URL一覧ファイルの読み込み ----------
function readUrlList(file) {
  const urls = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const url = s.split(/\s+#/)[0].trim(); // 行末コメントを除去
    if (/^https?:\/\//i.test(url)) {
      urls.push(url);
    } else {
      log(`⚠ 一覧の不正な行をスキップ: ${line}`);
    }
  }
  return [...new Set(urls)]; // 重複除去
}// ---------- メイン (バッチ制御) ----------
// 直接実行 (node eh_download.mjs ...) のときだけ起動する。
// run_all.mjs からは libraryMain(argv) として呼び出される (単一exe埋め込み対応)。
const isDirectRun =
  typeof process.argv[1] === "string" &&
  process.argv[1] !== process.execPath && // SEA (単一exe) では argv[1] が実行ファイル自身になるため除外
  (() => { try { return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; } })();

async function libraryMain(argv = process.argv.slice(2)) {
  const savedArgv = process.argv;
  process.argv = [process.argv[0], "eh_download.mjs", ...argv];
  try {
    return await batchMain(argv);
  } finally {
    process.argv = savedArgv;
  }
}

async function batchMain(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelpFromComment();
    return argv.length === 0 ? 1 : 0;
  }
  ({ listFile, urlArgs, outRoot, wantOriginal, cookie, delayMs, parallel, resync, convertFormat, convertQuality, deleteAfterConvert, saveMetadata, timeoutSec, retries } = parseCli(argv));
  if (timeoutSec != null) {
    timeoutMsPage = Math.round(timeoutSec * 1000);
    timeoutMsImage = Math.round(timeoutSec * 1000);
  }
  if (retries != null) {
    maxRetriesPage = retries;
    maxRetriesImage = retries;
  }
  if (convertFormat && convertFormat !== "png" && convertFormat !== "jpeg") {
    console.error("エラー: --convert は png または jpeg を指定してください");
    return 1;
  }
  if (deleteAfterConvert && !convertFormat) {
    console.error("エラー: --del は --convert png|jpeg と組み合わせて指定してください");
    return 1;
  }
  let urls;
  if (listFile) {
    if (!fs.existsSync(listFile)) {
      console.error(`エラー: 一覧ファイルが見つかりません: ${listFile}`);
      return 1;
    }
    if (urlArgs.length > 0) {

      console.error(
        `エラー: --list とギャラリーURLの同時指定はできません (--list を外すか、URL直指定に統一してください)\n` +
        `  一覧: ${listFile}\n  無視されるURL: ${urlArgs.join(" ")}`
      );
      return 1;
    }
    urls = readUrlList(listFile);
    if (urls.length === 0) {
      console.error("エラー: 一覧ファイルにURLがありません (1行1URLで記述してください)");
      return 1;
    }
    log(`▶ 一覧ファイル: ${listFile} (${urls.length} ギャラリー)`);
  } else {
    if (urlArgs.length === 0) {
      console.error("エラー: ギャラリーURLを指定してください (--help で使い方)");
      return 1;
    }
    urls = urlArgs;
    if (urls.length > 1) log(`▶ ${urls.length} ギャラリーを連続ダウンロードします`);
  }
  for (const u of urls) {
    try { new URL(u); } catch { console.error(`エラー: URLが不正です: ${u}`); return 1; }
  }

  if (parallel > 3) log("⚠ 同時接続数が多めです。509制限のリスクが上がります (推奨: 2〜3)");

  const batchStart = Date.now();
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    if (urls.length > 1) log(`\n════════════ [${i + 1}/${urls.length}] ════════════`);
    try {
      const result = await downloadGallery(urls[i]);
      if (convertFormat) {
        try {
          convertDownloadedGallery(result.outDir);
          result.converted = convertFormat;
        } catch (e) {
          result.error = `変換失敗: ${e.message}`;
          log(`✖ ${result.error} (次へ進みます)`);
        }
      }
      results.push(result);
    } catch (e) {
      log(`✖ このギャラリーは失敗: ${e.message} (次へ進みます)`);
      results.push({ url: urls[i], error: e.message, done: 0, skipped: 0, failed: 0 });
    }
    if (i < urls.length - 1) await sleep(delayMs * 2); // ギャラリー間も節度を持つ
  }

  // サマリ
  log(`\n■■ バッチ結果 (${results.length} ギャラリー) ■■`);
  let tDone = 0, tSkip = 0, tFail = 0;
  const failedUrls = [];
  for (const r of results) {
    const mark = r.error ? "✖" : r.failed > 0 ? "△" : "✔";
    const detail = r.error ? `エラー: ${r.error}` : `新規${r.done}/スキップ${r.skipped}/失敗${r.failed}`;
    log(`  ${mark} ${r.url}\n      → ${detail}`);
    tDone += r.done || 0; tSkip += r.skipped || 0; tFail += (r.failed || 0) + (r.error ? 1 : 0);
    if (r.error || r.failed > 0) failedUrls.push(r.url);
  }
  const secs = ((Date.now() - batchStart) / 1000).toFixed(0);
  log(`\n合計: 新規${tDone} / スキップ${tSkip} / 失敗${tFail} / 所要${secs}秒`);
  if (failedUrls.length > 0) {
    const failedFile = path.resolve(outRoot, "failed_urls.txt");
    fs.writeFileSync(failedFile, failedUrls.join("\n") + "\n");
    log(`⚠ 失敗ギャラリーを ${failedFile} に書き出しました`);
    log(`  再実行: node ${path.basename(process.argv[1] || "eh_download.mjs")} --list "${failedFile}"`);
    return 2; // 一部失敗
  }
  return 0;
}

if (isDirectRun) {
  batchMain().then((code) => {
    if (code) process.exitCode = code;
  }).catch((e) => {
    console.error("エラー:", e.stack || e.message);
    process.exit(1);
  });
}

export {
  libraryMain as runDownload,
  libraryMain as main,
  formatLimitWait,
  isExhentaiNlPage,
  withNlBypass,
};
