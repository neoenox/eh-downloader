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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------- 引数解析 ----------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n");
  const end = lines.findIndex((l) => l.trim() === "*/");
  console.log(lines.slice(1, end).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
  process.exit(args.length === 0 ? 1 : 0);
}

// 値を1つ取るオプションの次の引数は位置引数から除外する
const VALUE_FLAGS = new Set(["--cookie", "--delay", "--parallel", "-j", "--list"]);
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

// ---------- ユーティリティ ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

// ---------- 全接続共有のレート制限 ----------
// lastStart: 直前のリクエスト開始時刻 / pauseUntil: 509検出時に全ワーカーが待つ時刻
let lastStart = 0;
let pauseUntil = 0;

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

async function fetchText(url, referer) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await acquireSlot();
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
          ...(referer ? { Referer: referer } : {}),
          ...(cookie && /e-hentai\.org|exhentai\.org/.test(new URL(url).host) ? { Cookie: cookie } : {}),
        },
        signal: AbortSignal.timeout(45000),
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
      if (attempt === 5) throw e;
      if (isLimitError(e.message)) {
        const sec = 60 * attempt;
        pauseUntil = Math.max(pauseUntil, Date.now() + sec * 1000);
        log(`⚠ 509検出: 全${parallel}接続を${sec}秒停止 → 自動再試行 (${attempt}/5)`);
      } else {
        log(`  ! 取得失敗 (${e.message}) - ${attempt * 3}秒後に再試行 (${attempt}/5)...`);
        await sleep(attempt * 3000);
      }
    }
  }
}

async function fetchImage(url, referer, dest) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await acquireSlot();
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
          ...(referer ? { Referer: referer } : {}),
          ...(cookie && /e-hentai\.org|exhentai\.org/.test(new URL(url).host) ? { Cookie: cookie } : {}),
        },
        signal: AbortSignal.timeout(120000),
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
        throw new Error(`509/帯域制限: 全${parallel}接続を${sec}秒停止します`);
      }
      throw new Error(type.startsWith("text/html") ? "HTMLが返された(要ログインの可能性)" : `HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 4) return { ok: false, size: 0, error: e.message };
      if (isLimitError(e.message)) {
        log(`⚠ ${e.message} (${attempt}/4)`); // 待機は acquireSlot が全ワーカー共通で処理
      } else {
        log(`  ! ${e.message} → ${attempt * 5}秒後に再試行 (${attempt}/4)`);
        await sleep(attempt * 5000);
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
  const firstHtml = await fetchText(galleryUrl);
  if (!/\/s\/[0-9a-f]{10}\//.test(firstHtml)) {
    throw new Error("サムネイルが見つかりません (URLが無効/削除済み/要Cookieの可能性)");
  }

  // タイトル取得
  const tMatch = firstHtml.match(/<h1 id="gn">([\s\S]*?)<\/h1>/) || firstHtml.match(/<title>([\s\S]*?)<\/title>/);
  const title = tMatch ? decodeEntities(tMatch[1].replace(/<[^>]*>/g, "")).replace(/ - E-Hentai.*/, "") : "gallery";
  const gidMatch = galleryUrl.match(/\/g\/(\d+)\//);
  const gid = gidMatch ? gidMatch[1] : "gallery";
  const dirName = `${gid}_${title.replace(/[\\/:*?"<>|.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "gallery"}`;
  const outDir = path.resolve(outRoot, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  log(`▶ 保存先: ${outDir}`);

  // 2) 全ページから画像ページURLを収集 (一覧は逐次で取得)
  const pageNums = collectPaginationPages(firstHtml);
  log(`▶ ギャラリー一覧ページ数: ${pageNums.length}`);
  const pageUrls = pageNums.map((n) => (n === 0 ? galleryUrl : `${galleryUrl.replace(/\/$/, "")}/?p=${n}`));

  const imagePageUrls = [];
  const seenPages = new Set();
  for (let i = 0; i < pageUrls.length; i++) {
    const html = i === 0 ? firstHtml : await fetchText(pageUrls[i], galleryUrl);
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

  // 4) ダウンロード対象を組み立て (取得済みは除外)
  let done = 0, skipped = 0, failed = 0;
  const referer = `https://${host}/`;
  const tasks = [];
  for (const pageUrl of imagePageUrls) {
    const pageNum = parseInt((pageUrl.match(/-(\d+)\/?$/) || [])[1], 10);
    const rec = index[pageNum];
    if (rec && rec.file && fs.existsSync(path.join(outDir, rec.file)) && fs.statSync(path.join(outDir, rec.file)).size > 0) {
      skipped++;
      continue;
    }
    tasks.push({ pageUrl, pageNum });
  }

  log(`▶ 設定: 同時${parallel}接続 / 間隔${(delayMs / 1000).toFixed(1)}秒 / 対象${tasks.length}枚 (スキップ${skipped}枚)`);

  // 5) ワーカープールで並列ダウンロード
  let cursor = 0;

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
      try {
        await runOne(tasks[i]);
      } catch (e) {
        failed++;
        log(`[${String(tasks[i].pageNum).padStart(pad, "0")}] 失敗: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, tasks.length) }, worker));

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
}

// ---------- メイン (バッチ制御) ----------
(async () => {
  let urls;
  if (listFile) {
    if (!fs.existsSync(listFile)) {
      console.error(`エラー: 一覧ファイルが見つかりません: ${listFile}`);
      process.exit(1);
    }
    if (urlArgs.length > 0) {
      console.error(
        `エラー: --list とギャラリーURLの同時指定はできません (--list を外すか、URL直指定に統一してください)\n` +
        `  一覧: ${listFile}\n  無視されるURL: ${urlArgs.join(" ")}`
      );
      process.exit(1);
    }
    urls = readUrlList(listFile);
    if (urls.length === 0) {
      console.error("エラー: 一覧ファイルにURLがありません (1行1URLで記述してください)");
      process.exit(1);
    }
    log(`▶ 一覧ファイル: ${listFile} (${urls.length} ギャラリー)`);
  } else {
    if (urlArgs.length === 0) {
      console.error("エラー: ギャラリーURLを指定してください (--help で使い方)");
      process.exit(1);
    }
    urls = urlArgs;
    if (urls.length > 1) log(`▶ ${urls.length} ギャラリーを連続ダウンロードします`);
  }
  for (const u of urls) {
    try { new URL(u); } catch { console.error(`エラー: URLが不正です: ${u}`); process.exit(1); }
  }
  if (parallel > 3) log("⚠ 同時接続数が多めです。509制限のリスクが上がります (推奨: 2〜3)");

  const batchStart = Date.now();
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    if (urls.length > 1) log(`\n════════════ [${i + 1}/${urls.length}] ════════════`);
    try {
      results.push(await downloadGallery(urls[i]));
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
    log(`  再実行: node ${path.basename(process.argv[1])} --list "${failedFile}"`);
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error("エラー:", e.stack || e.message);
  process.exit(1);
});
