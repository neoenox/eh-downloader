#!/usr/bin/env node
// 統合ランチャー: ダウンロード → (WebP→PNG/JPEG) 変換 → ビューワーで閲覧 を 1 コマンドで実行
//
// 使い方:
//   node run_all.mjs <URL...|urls.txt> [オプション]   ダウンロードして変換して閲覧
//   node run_all.mjs --from <dir|一覧ファイル>        ダウンロード済みフォルダを変換して閲覧
//   node run_all.mjs --open-only [dir]               変換済みフォルダをビューワーで開くだけ
//   node run_all.mjs <フォルダ>                       フォルダを直接渡すと --from 相当 (D&D・送るメニュー向け)
//
// オプション:
//   --out DIR          基準フォルダ (デフォルト: カレントディレクトリ)
//   --from DIR|FILE    変換対象をダウンロード済みフォルダ / フォルダ一覧ファイルから指定
//   --format png|jpeg  変換形式 (デフォルト: png)
//   --quality N        JPEG 品質 1-100 (デフォルト: 90)
//   --del              変換成功後に元 WebP を削除 (⚠ 復元不可)
//   --force            変換済みの画像も再変換
//   --no-convert       変換せずダウンロードのみ (変換済みのものを再閲覧する場合など)
//   --no-view          ビューワーを起動せず終了
//   --open-only        ダウンロード/変換を行わずビューワーだけ起動
//   --port N           ビューワーのポート (デフォルト: 自動)
//   --recursive        ビューワーでサブフォルダもまとめて表示
//   --no-open          ビューワー用にブラウザを自動で開かない
//   --no-color         進捗表示を色なしにする
//   --verbose          子スクリプトの全出力をそのまま表示 (デフォルトは1行進捗に凝縮)
//   -- <args>          以降を eh_download.mjs にそのまま渡す (--parallel, --cookie, --original など)
//
// 終了コード: 0=成功 / 1=致命的エラー / 2=ダウンロードに一部失敗 (failed_urls.txt に書き出し)

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// SEA (単一exe) では import.meta.url が空になるためフォールバックする。
// rootDir は子スクリプトの spawn にのみ使う (SEA では子プロセスを使わないので未使用)。
const isSea = (() => { try { return createRequire(process.execPath)("node:sea").isSea(); } catch { return false; } })();
const scriptPath = (() => {
  try { return fileURLToPath(import.meta.url); } catch { return process.execPath; }
})();
const rootDir = isSea ? path.dirname(process.execPath) : path.dirname(scriptPath);
const DOWNLOAD = path.join(rootDir, "eh_download.mjs");
const CONVERT = path.join(rootDir, "convert_images.mjs");
const VIEWER = path.join(rootDir, "image_viewer.mjs");

// --- 埋め込みモード (単一exe) ---
// EH_EMBEDDED=1 のときは子プロセスを起動せず、同梱のライブラリをインプロセスで呼ぶ。
// バンドル時は同じチャンクに各モジュールが含まれるため、相対 import がそのまま解決される。
// top-level await は使えない (esbuild CJS バンドルの制約) ので async 関数にして main() 冒頭で待つ。
const isEmbedded = process.env.EH_EMBEDDED === "1";
let libDownload = null, libConvert = null, libViewer = null;
async function initEmbedded() {
  if (!isEmbedded) return;
  try { ({ runDownload: libDownload } = await import("./eh_download.mjs")); } catch { libDownload = null; }
  try { ({ runConvert: libConvert } = await import("./convert_images.mjs")); } catch { libConvert = null; }
  try { libViewer = await import("./image_viewer.mjs"); } catch { libViewer = null; }
  if (!libDownload || !libConvert || !libViewer || typeof libViewer.runViewer !== "function") {
    console.error("[ERROR] 埋め込みモジュールの読み込みに失敗しました");
    process.exit(1);
  }
}

// ---------- 引数解析 ----------
const helpText = (() => {
  // 単一exe (SEA) ではソースが読めないため、ビルド時に埋め込まれたヘルプ文字列を使う
  if (globalThis.EH_RUNALL_HELP) return globalThis.EH_RUNALL_HELP;
  try {
    const lines = fs.readFileSync(scriptPath, "utf8").split("\n");
    const end = lines.findIndex((l) => l.trim() === "// ---------- 引数解析 ----------");
    return lines.slice(1, end - 1).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
  } catch {
    return "使い方: run_all.mjs <URL...|urls.txt|フォルダ> [オプション]\n\nダウンロード → 変換 → ビューワー起動 を 1 コマンドで実行します。\n詳細は README.md を参照してください。";
  }
})();

function parseArgs(argv) {
  const opts = {
    urls: [], from: null, out: ".", format: "png", quality: 90,
    del: false, force: false, convert: true, view: true, openOnly: false,
    port: null, recursive: false, open: true, passThrough: [],
    noColor: false, verbose: false, fromDirs: [],
  };
  let i = 0;
  let noMoreFlags = false;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (noMoreFlags) { opts.passThrough.push(a); continue; }
    if (a === "--") { noMoreFlags = true; continue; }
    if (a === "--help" || a === "-h") { console.log(helpText); process.exit(0); }
    else if (a === "--version" || a === "-v") { console.log("eh-runall " + (globalThis.EH_VIEWER_VERSION || "dev")); process.exit(0); }
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--from") opts.from = argv[++i];
    else if (a === "--format") opts.format = argv[++i];
    else if (a === "--quality") opts.quality = parseInt(argv[++i], 10);
    else if (a === "--del") opts.del = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--no-convert") opts.convert = false;
    else if (a === "--no-view") opts.view = false;
    else if (a === "--open-only") opts.openOnly = true;
    else if (a === "--port") opts.port = parseInt(argv[++i], 10);
    else if (a === "--recursive") opts.recursive = true;
    else if (a === "--no-open") opts.open = false;
    else if (a === "--no-color") opts.noColor = true;
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--view=false") opts.view = false;
    else if (a === "--view") opts.view = true;
    else if (a === "--open") opts.open = true;
    else if (a.startsWith("--")) opts.passThrough.push(a);
    else opts.urls.push(a);
  }
  return opts;
}

// ---------- 色付き出力 & 1行進捗 ----------
// --no-color が渡されたかどうかは引数を軽く走査して判定する (opts は main() 内で生成)。
let opts = {
  urls: [], from: null, out: ".", format: "png", quality: 90,
  del: false, force: false, convert: true, view: true, openOnly: false,
  port: null, recursive: false, open: true, passThrough: [],
  noColor: false, verbose: false, fromDirs: [],
};
const useColor = (() => {
  if (process.argv.slice(2).includes("--no-color")) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.NO_COLOR) return false;
  return !!process.stdout.isTTY;
})();
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = (s) => paint("1", s);
const dim = (s) => paint("2", s);
const red = (s) => paint("31", s);
const green = (s) => paint("32", s);
const yellow = (s) => paint("33", s);
const cyan = (s) => paint("36", s);

let liveLine = "";
function clearLive() {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
}
// ライブ進捗行を更新 (非TTYでは何も表示しない — 完了行だけを出す)
function updateLive(text) {
  liveLine = text;
  if (process.stdout.isTTY) { clearLive(); process.stdout.write(text); }
}
// ライブ行を確定して消す
function finishLive() {
  if (!liveLine) return;
  if (process.stdout.isTTY) clearLive();
  process.stdout.write("\n");
  liveLine = "";
}
// 完了行やメッセージを印字 (ライブ行があれば退避してから再描画)
function printLine(text) {
  const hadLive = !!liveLine;
  if (hadLive && process.stdout.isTTY) clearLive();
  process.stdout.write(text + "\n");
  if (hadLive && process.stdout.isTTY) process.stdout.write(liveLine);
}
function phaseHeader(n, title) {
  finishLive();
  printLine("\n" + cyan(bold(`[${n}/3] ${title}`)));
}
const shortUrl = (u) => {
  const s = u.replace(/^https?:\/\//, "");
  return s.length > 58 ? s.slice(0, 55) + "..." : s;
};

// ---------- 共通ヘルパー ----------
// フォルダ内の「画像を直接含むフォルダ」を収集 (元WebP でも変換後の PNG/JPEG でも可)
const VIEWABLE_RE = /\.(webp|png|jpe?g)$/i;
function findGalleryDirs(dir) {
  const abs = path.resolve(dir);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }
  const direct = entries.filter((e) => e.isFile() && VIEWABLE_RE.test(e.name));
  if (direct.length > 0) return [abs];
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    out.push(...findGalleryDirs(path.join(abs, e.name)));
  }
  return out;
}

function galleryDirsFromRoots(roots) {
  const set = new Set();
  for (const r of roots) {
    const abs = path.resolve(r);
    if (fs.statSync(abs).isFile()) { // 一覧ファイル: 行ごとにフォルダパス
      for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        for (const d of findGalleryDirs(t)) set.add(d);
      }
    } else {
      for (const d of findGalleryDirs(abs)) set.add(d);
    }
  }
  return [...set];
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      if (Date.now() > deadline) return resolve(null);
      const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); resolve(port); });
      s.on("error", () => setTimeout(attempt, 250));
    };
    attempt();
  });
}

async function openViewer(dirs) {
  if (dirs.length === 0) {
    console.error("表示できる画像フォルダがありません");
    process.exit(1);
  }
  const first = dirs[0];

  // 複数フォルダ (URL連続ダウンロード時) は共通の親フォルダを開く。
  // ビューワーの PageDown / 「次フォルダ」で兄弟ギャラリーを巡回できる。
  // 場所がバラバラの複数フォルダを同時に渡された場合は親が共有できないため最初の1つだけ開く。
  let viewDir;
  if (dirs.length === 1) {
    viewDir = first;
  } else {
    const parent = path.dirname(first);
    viewDir = dirs.every((d) => path.dirname(d) === parent) ? parent : first;
    if (viewDir === first && dirs.length > 1) {
      printLine(dim(`  ※ フォルダが別々の場所にあるため、最初のフォルダのみ表示します: ${first}`));
    }
  }
  const args = [viewDir];
  if (opts.port) args.push("--port", String(opts.port));
  if (opts.recursive) args.push("--recursive");
  if (!opts.open) args.push("--no-open");

  if (libViewer) {
    // 埋め込みモード (単一exe): ビューワーを別プロセスとして起動する必要がある。
    // SEA では自身の実行ファイル (process.execPath) に view サブコマンドを渡す。
    const child2 = spawn(process.execPath, ["__view", ...args], { stdio: "ignore", detached: true });
    child2.on("error", (e) => { console.error("ビューワーの起動に失敗:", e.message); process.exit(1); });
    child2.unref();
  } else {
    const child = spawn(process.execPath, [VIEWER, ...args], { stdio: "ignore", detached: true });
    child.on("error", (e) => { console.error("ビューワーの起動に失敗:", e.message); process.exit(1); });
    child.unref();
  }

  let port = opts.port;
  if (!port) {
    // ビューワーが 8420 (使用中なら +1) で待ち受けるので実ポートを探して表示する
    for (let t = 0; t < 40; t++) {
      const p = await waitForPort(8420 + t, 500);
      if (p) { port = p; break; }
    }
  }
  if (!port && libViewer) {
    // 埋め込みモードで自動ポートの場合、探す範囲を広げる
    for (let t = 0; t < 40 && !port; t++) {
      const p = await waitForPort(8420 + t, 700);
      if (p) { port = p; break; }
    }
  }
  if (port) {
    printLine("\n▶ " + cyan(`http://localhost:${port}/`) + dim(`  (${dirs.length === 1 ? first : viewDir + " の各フォルダ"})`));
  } else {
    printLine("\n▶ ビューワーを起動しました (ポートを特定できませんでしたが、ブラウザを確認してください)");
  }
  if (dirs.length > 1) {
    printLine(dim(`  対象: ${dirs.length} フォルダ (PageDown / 「次フォルダ」で切り替え)`));
  }
}

// ---------- フェーズ 1: ダウンロード (出力を凝縮して1行進捗表示) ----------
// eh_download.mjs の出力を捕らえ、ギャラリー単位の結果だけを色付き1行で表示する。
// 警告 (509等) とリトライ情報、画像単位の失敗はそのまま見せる。
async function runPhaseDownload(galleries, outRoot) {
  phaseHeader(1, "ダウンロード");
  if (libDownload) {
    // 埋め込みモード: インプロセスで実行し、出力を謎めて解析する
    const logs2 = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => logs2.push(a.join(" "));
    console.error = (...a) => logs2.push(a.join(" "));
    let code = 0;
    try {
      code = (await libDownload([...galleries, outRoot, "--delay", "1", ...opts.passThrough])) || 0;
    } catch (e) {
      logs2.push("エラー: " + (e && e.message));
      code = 1;
    }
    console.log = origLog;
    console.error = origErr;
    // 収集したログを通常モードと同じ解析器に流す
    const res = { code, results: [], failedFile: null };
    let curUrl = null;
    const N = galleries.length;
    let idx = 0;
    for (const line of logs2.flatMap((l) => l.split("\n"))) {
      let m;
      if ((m = line.match(/^▶ ギャラリー: (\S+)/))) { curUrl = m[1]; idx++; updateLive(`⬇ ${cyan(`[${idx}/${N}]`)} DL中 ${shortUrl(curUrl)}`); continue; }
      if ((m = line.match(/^■ 完了: 新規(\d+) \/ スキップ(\d+) \/ 失敗(\d+)/))) {
        const [dn, sk, fl] = [+m[1], +m[2], +m[3]];
        finishLive();
        if (fl > 0) printLine(yellow(`△ ${curUrl || "?"}`) + `  新規${dn} スキップ${sk} ` + red(`失敗${fl}`));
        else printLine(green(`✔ ${curUrl || "?"}`) + dim(`  新規${dn} スキップ${sk}`));
        curUrl = null; continue;
      }
      if (/^✖ このギャラリーは失敗: /.test(line)) { finishLive(); printLine(red(`✖ ${curUrl || "?"}`) + dim("  " + line.replace(/^✖ このギャラリーは失敗: /, ""))); curUrl = null; continue; }
      if ((m = line.match(/^  (✔|△|✖) (https?:\/\/\S+)$/))) { res.results.push({ mark: m[1], url: m[2], detail: "" }); continue; }
      if ((m = line.match(/^      → (.+)$/)) && res.results.length > 0 && res.results[res.results.length - 1].detail === "") { res.results[res.results.length - 1].detail = m[1]; continue; }
      if ((m = line.match(/⚠ 失敗ギャラリーを (.+?) に書き出しました/))) { res.failedFile = m[1]; continue; }
      if (/^⚠/.test(line)) { finishLive(); printLine(yellow(line)); continue; }
      if (/^  ! /.test(line) || /^\[\d+\] 失敗: /.test(line)) { finishLive(); printLine(dim(line)); continue; }
    }
    finishLive();
    return res;
  }
  const N = galleries.length;
  const child = spawn(process.execPath, [DOWNLOAD, ...galleries, outRoot, "--delay", "1", ...opts.passThrough], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const results = []; // バッチ結果ブロックから収集 { mark: ✔|△|✖, url, detail }
  let failedFile = null;
  let curUrl = null;
  let idx = 0;
  let buf = "";

  const onLine = (line) => {
    let m;
    if ((m = line.match(/^▶ ギャラリー: (\S+)/))) {
      curUrl = m[1];
      idx++;
      updateLive(`⬇ ${cyan(`[${idx}/${N}]`)} DL中 ${shortUrl(curUrl)}`);
      return;
    }
    if ((m = line.match(/^■ 完了: 新規(\d+) \/ スキップ(\d+) \/ 失敗(\d+)/))) {
      const [dn, sk, fl] = [+m[1], +m[2], +m[3]];
      finishLive();
      if (fl > 0) printLine(yellow(`△ ${curUrl || "?"}`) + `  新規${dn} スキップ${sk} ` + red(`失敗${fl}`));
      else printLine(green(`✔ ${curUrl || "?"}`) + dim(`  新規${dn} スキップ${sk}`));
      curUrl = null;
      return;
    }
    if (/^✖ このギャラリーは失敗: /.test(line)) {
      finishLive();
      printLine(red(`✖ ${curUrl || "?"}`) + dim("  " + line.replace(/^✖ このギャラリーは失敗: /, "")));
      curUrl = null;
      return;
    }
    // バッチ結果ブロック: 印刷せず失敗サマリのために記録するだけ
    if ((m = line.match(/^  (✔|△|✖) (https?:\/\/\S+)$/))) { results.push({ mark: m[1], url: m[2], detail: "" }); return; }
    if ((m = line.match(/^      → (.+)$/)) && results.length > 0 && results[results.length - 1].detail === "") {
      results[results.length - 1].detail = m[1];
      return;
    }
    if ((m = line.match(/⚠ 失敗ギャラリーを (.+?) に書き出しました/))) { failedFile = m[1]; return; }
    // 警告・リトライ・画像単位の失敗は隠さず見せる
    if (/^⚠/.test(line)) { finishLive(); printLine(yellow(line)); return; }
    if (/^  ! /.test(line) || /^\[\d+\] 失敗: /.test(line)) { finishLive(); printLine(dim(line)); return; }
  };

  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  child.stderr.on("data", (d) => { finishLive(); process.stderr.write(d); });
  const code = await new Promise((res) => child.on("exit", (c) => res(c === null ? 1 : c)));
  finishLive();
  return { code, results, failedFile };
}

// 失敗ギャラリーのサマリ (✖ 全体失敗 / △ 一部失敗を分けて表示)
function printFailureSummary(results, failedFile) {
  const bad = results.filter((r) => r.mark !== "✔");
  if (bad.length === 0) return;
  printLine("\n" + yellow(bold(`⚠ 失敗ギャラリー: ${bad.length}件`)));
  for (const r of bad) {
    if (r.mark === "✖") printLine(`  ${red("✖")} ${r.url}`);
    else printLine(`  ${yellow("△")} ${r.url}`);
    if (r.detail) {
      const hint = r.mark === "△" ? dim(" (再実行で失敗分のみ再取得)") : "";
      printLine(`     ${dim(r.detail)}${hint}`);
    }
  }
  if (failedFile) {
    printLine(`  ${cyan("→ 再実行:")} node eh_download.mjs --list "${failedFile}"`);
  }
}

// ---------- フェーズ 2: 変換 (フォルダごとに色付き1行で結果表示) ----------
async function runPhaseConvert(targets) {
  phaseHeader(2, `変換 (${targets.length} フォルダ → ${opts.format.toUpperCase()})`);
  let converted = 0, convFail = 0, convSkipped = 0;
  for (let i = 0; i < targets.length; i++) {
    const dir = targets[i];
    const name = path.basename(dir);
    if (!opts.verbose) updateLive(`${cyan(`[${i + 1}/${targets.length}]`)} 変換中 ${name} ${dim("→ " + opts.format.toUpperCase())}`);

    // 通常モードの子プロセス用 (埋め込みモードでは libConvert(args) に渡す際に先頭を除外)
    const args = [CONVERT, dir, "--format", opts.format, "--quality", String(opts.quality)];
    if (opts.del) args.push("--del");
    if (opts.force) args.push("--force");

    let status;
    let out = "", err = "";
    if (libConvert) {
      // 埋め込みモード: インプロセスで実行
      const logs2 = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...a) => logs2.push(a.join(" "));
      console.error = (...a) => logs2.push(a.join(" "));
      try {
        status = (await libConvert(args.slice(1))) || 0; // 先頭のスクリプトパスを除いて渡す
      } catch (e) {
        logs2.push("エラー: " + (e && e.message));
        status = 1;
      }
      console.log = origLog;
      console.error = origErr;
      out = logs2.join("\n");
      err = out;
    } else if (opts.verbose) {
      const r = spawnSync(process.execPath, args, { stdio: "inherit" });
      status = r.status;
    } else {
      finishLive(); // 子の変換には時間がかかるのでライブ行は一旦確定
      const r = spawnSync(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      status = r.status;
      out = r.stdout || "";
      err = r.stderr || "";
    }

    if (status === 0) {
      converted++;
      const m = out.match(/■ 完了: 変換(\d+) \/ スキップ(\d+) \/ 失敗(\d+)/);
      const sz = out.match(/合計サイズ: (\S+) → (\S+) \((\d+)%\)/);
      let extra = "";
      if (m) extra += `変換${m[1]} スキップ${m[2]}` + (+m[3] > 0 ? " " + red(`失敗${m[3]}`) : "");
      if (sz) extra += (extra ? " " : "") + dim(`(${sz[1]}→${sz[2]}, ${sz[3]}%)`);
      printLine(green(`✔ ${name}`) + (extra ? dim("  " + extra) : ""));
    } else if (/WebPファイルがありません/.test(err)) {
      convSkipped++;
      printLine(dim(`－ ${name}  (対象WebPなし — 変換済み/空のためスキップ)`));
    } else {
      convFail++;
      printLine(red(`✖ ${name}`) + dim(`  変換に失敗 (exit ${status})`));
      const firstErr = err.trim().split(/\r?\n/)[0];
      if (firstErr) printLine(dim("   " + firstErr));
    }
  }
  return { converted, convFail, convSkipped, total: targets.length };
}

// ---------- メイン ----------
async function main(argv = process.argv.slice(2)) {
  await initEmbedded();
  opts = parseArgs(argv);
  const outRoot = path.resolve(opts.out);
  fs.mkdirSync(outRoot, { recursive: true });
  const convertRoots = [];

  if (opts.openOnly) {
    const dirs = galleryDirsFromRoots(opts.urls.length ? opts.urls : [outRoot]);
    await openViewer(dirs);
    return;
  }

  // --- 位置引数の分類 (フォルダのドラッグ&ドロップ対応) ---
  // URL が 1 つもなく、実在するフォルダが渡された場合は「変換+閲覧」モード (--from 相当)。
  // 実在するファイル (urls.txt など) は従来どおりダウンロードの一覧として eh_download へ渡す。
  // URL がある場合はフォルダ位置引数をダウンロード保存先 (従来動作) のまま扱う。
  const urlLike = opts.urls.filter((p) => /^https?:\/\//i.test(p));
  if (urlLike.length === 0) {
    const keepArgs = [];
    for (const p of opts.urls) {
      let isDir = false;
      try { isDir = fs.statSync(p).isDirectory(); } catch { /* 存在しないパス */ }
      if (isDir) opts.fromDirs.push(path.resolve(p));
      else keepArgs.push(p);
    }
    opts.urls = keepArgs;
  }

  // --- フェーズ 1: ダウンロード ---
  const galleries = [...opts.urls];
  let dl = { code: 0, results: [], failedFile: null };
  if (galleries.length > 0) {
    dl = await runPhaseDownload(galleries, outRoot);
    if (dl.code !== 0 && dl.code !== 2) process.exit(dl.code);
    convertRoots.push(outRoot);
    printFailureSummary(dl.results, dl.failedFile);
  }

  // --- フェーズ 2: 変換 ---
  let conv = { converted: 0, convFail: 0, convSkipped: 0, total: 0 };
  if (opts.convert) {
    if (opts.from) convertRoots.push(opts.from);
    convertRoots.push(...(opts.fromDirs || []));
    const targets = galleryDirsFromRoots(convertRoots);
    if (targets.length === 0) {
      if (galleries.length === 0) {
        console.error("変換対象の WebP フォルダが見つかりません (--from で場所を指定できます)");
        process.exit(1);
      }
      printLine(dim("\n(変換対象の WebP が見つかりません。スキップします)"));
    } else {
      conv = await runPhaseConvert(targets);
      if (conv.convFail > 0) process.exit(1);
    }
  }

  // --- フェーズ 3: ビューワー ---
  if (opts.view) {
    phaseHeader(3, "ビューワー起動");
    const roots = [...convertRoots];
    if (roots.length === 0) roots.push(outRoot);
    const dirs = galleryDirsFromRoots(roots);
    await openViewer(dirs);
  }

  // --- 最終サマリ ---
  const dlTotal = dl.results.length;
  const dlBad = dl.results.filter((r) => r.mark !== "✔").length;
  const parts = [];
  if (dlTotal > 0) parts.push(`DL ${dlTotal - dlBad}/${dlTotal} ギャラリー成功`);
  if (conv.total > 0) parts.push(`変換 ${conv.converted}/${conv.total} フォルダ${conv.convSkipped > 0 ? dim(` (スキップ${conv.convSkipped})`) : ""}`);
  const allOk = dl.code === 0 && conv.convFail === 0;
  printLine("\n" + (allOk ? green("■ 全フェーズ完了") : yellow(`■ 完了 (失敗あり)`)) + (parts.length ? dim("  " + parts.join(" / ")) : ""));

  if (!opts.view && dl.code === 2) {
    printLine(yellow("⚠ 一部ダウンロードに失敗しました。failed_urls.txt を確認してください"));
  }

  // ダウンロードで一部失敗があった場合は終了コード 2 で報告する
  if (dl.code === 2) process.exitCode = 2;
}

// 直接実行時のみ自動起動 (単一exeからは run_all_sea_entry が runAll(argv) を明示呼び出しする)。
// SEA 内では process.argv[1] が実行ファイル自身になるため誤検出する → isSea では無効化する。
const isDirectRun =
  !isSea &&
  typeof process.argv[1] === "string" &&
  (() => { try { return path.resolve(process.argv[1]) === scriptPath; } catch { return false; } })();
if (isDirectRun) {
  main().catch((e) => {
    console.error("エラー:", e && e.stack || e);
    process.exit(1);
  });
}

export { main as runAll, main };
