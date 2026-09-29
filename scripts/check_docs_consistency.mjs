#!/usr/bin/env node
// ドキュメント整合性チェック:
// README / docs / リリースノートのコマンド例・アセット名・アンカーを、
// 実際の GitHub Release (gh CLI 経由) と各スクリプトのオプション定義に照合する。
//
//   node scripts/check_docs_consistency.mjs [--tag v1.2.2] [--notes <path>] [--repo owner/name]
//
//   --tag <vX.Y.Z>  照合対象のリリースタグ (デフォルト: package.json のバージョンに v 接頭辞)
//   --notes <path>  追加で検査するリリースノート原稿 (省略可、複数回指定可)
//   --repo <o/n>    対象リポジトリ (デフォルト: git remote origin から自動検出)
//
// チェック内容:
//   1. ドキュメントに登場する eh-viewer-* / eh-runall-* / SHA256SUMS-* ファイル名が
//      実際の Release アセットと一致するか
//   2. sha256sum -c / shasum -a 256 -c のコマンド例が実アセット名と一致するか
//   3. コマンド例の --flag が各スクリプトのパーサ (ソース走査) に存在するか
//   4. run_all passThrough (-- 以降) のオプションも downloader 側で検証
//   5. FileVersion 表記が package.json と一致するか
//   6. 見出しアンカーの重複がないか (github-slugger ルール)
//   7. リポジトリ内の README アンカー参照 (#xxx) がすべて有効か
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// 引数解析
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const getOpt = (names) => {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
  }
  return null;
};
const getMulti = (name) => {
  const vals = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) vals.push(argv[i + 1]);
  return vals;
};
const hasFlag = (n) => argv.includes(n);

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const TAG = getOpt(["--tag"]) || "v" + pkg.version;

let repo = getOpt(["--repo", "-R"]);
if (!repo) {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", cwd: rootDir }).trim();
    const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) repo = m[1];
  } catch { /* git 無し環境 */ }
}

const notesPaths = getMulti("--notes").map((p) => path.resolve(rootDir, p));
// デフォルト: .freebuff/release-notes-<tag>.md があれば使う
if (notesPaths.length === 0) {
  const def = path.join(rootDir, ".freebuff", `release-notes-${TAG}.md`);
  if (fs.existsSync(def)) notesPaths.push(def);
}

let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; console.log("FAIL: " + msg); };
const ok = (msg) => { checks++; console.log("ok  : " + msg); };

// ---------------------------------------------------------------------------
// 実データの取得 (gh CLI)
// ---------------------------------------------------------------------------
let assets = [];
if (repo) {
  try {
    assets = JSON.parse(
      execFileSync("gh", ["release", "view", TAG, "--repo", repo,
        "--json", "assets", "--jq", "[.assets[].name]"], { encoding: "utf8" })
    );
    console.log(`リリース ${TAG} (${repo}) のアセット (${assets.length} 件) を取得しました\n`);
  } catch (e) {
    console.log(`WARN: リリース ${TAG} のアセット取得に失敗 (${e.message.split("\n")[0]})。アセット照合をスキップします\n`);
  }
} else {
  console.log("WARN: リポジトリを特定できず (git remote なし)。アセット照合をスキップします\n");
}

const read = (rel) => fs.readFileSync(path.join(rootDir, rel), "utf8");
const readme = read("README.md");
const docs = {};
for (const f of fs.readdirSync(path.join(rootDir, "docs"))) {
  if (f.endsWith(".md")) docs["docs/" + f] = read("docs/" + f);
}
const allDocs = { "README.md": readme, ...docs };
for (const np of notesPaths) {
  const key = path.relative(rootDir, np).split(path.sep).join("/");
  allDocs[key] = fs.readFileSync(np, "utf8");
}
const notesKeys = notesPaths.map((np) => path.relative(rootDir, np).split(path.sep).join("/"));

// ---------------------------------------------------------------------------
// スクリプトが実際に受理する --flag を抽出する (ソース走査)
// ---------------------------------------------------------------------------
const scriptFlags = {};
for (const name of ["eh_download.mjs", "convert_images.mjs", "image_viewer.mjs", "run_all.mjs", "build_exe.mjs"]) {
  const src = read(name);
  const flags = new Set();
  for (const line of src.split("\n")) {
    for (const m of line.matchAll(/["'`](--[a-z][a-z0-9-]*)["'`]/g)) flags.add(m[1]);
  }
  scriptFlags[name] = flags;
}
// build_exe.mjs は getOpt(["--out", "-o"]) 形式も拾う
const buildSrc = read("build_exe.mjs");
for (const m of buildSrc.matchAll(/getOpt\(\[([^\]]+)\]/g)) {
  for (const f of m[1].matchAll(/"(-?[a-z-]+)"/g)) scriptFlags["build_exe.mjs"].add(f[1]);
}

function codeBlocks(text) {
  const blocks = [];
  const re = /```(?:bash|sh|bat|cmd|powershell|text)?\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) blocks.push(m[1]);
  return blocks;
}
function analyzeCommand(cmd) {
  const used = [];
  for (const m of cmd.matchAll(/(^|\s)(--[a-z][a-z0-9-]*)\b/g)) used.push(m[2]);
  return used;
}
function scriptOf(cmd) {
  if (/build_exe\.mjs|build\.bat/.test(cmd)) return "build_exe.mjs";
  if (/run_all\.mjs|run_all\.bat|eh-runall/.test(cmd)) return "run_all.mjs";
  if (/eh_download\.mjs|download\.bat/.test(cmd)) return "eh_download.mjs";
  if (/convert_images\.mjs|convert\.bat/.test(cmd)) return "convert_images.mjs";
  if (/image_viewer\.mjs|viewer\.bat|eh-viewer/.test(cmd)) return "image_viewer.mjs";
  return null;
}
const NON_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

const downloaderFlags = scriptFlags["eh_download.mjs"];
const runAllFlags = scriptFlags["run_all.mjs"];
const buildExeFlags = scriptFlags["build_exe.mjs"];

// ---------------------------------------------------------------------------
// 1. アセット名照合 (gh が取得できた場合のみ)
// ---------------------------------------------------------------------------
const ASSET_RE = /\b(eh-(?:viewer|runall)-(?:windows-x64\.exe|linux-x64|macos-arm64)(?:\.tar\.gz)?|SHA256SUMS-[a-z0-9-]+\.txt)\b/g;
if (assets.length > 0) {
  for (const [name, text] of Object.entries(allDocs)) {
    const mentioned = new Set();
    for (const m of text.matchAll(ASSET_RE)) mentioned.add(m[1]);
    for (const a of mentioned) {
      // 拡張子を省略した総称 (eh-runall-windows-x64 + ".tar.gz" 別記) も前方一致で許容
      const exact = assets.includes(a);
      const generic = assets.some((x) => x.startsWith(a));
      if (exact || generic) ok(`${name}: アセット名 "${a}" は実在します`);
      else fail(`${name}: アセット名 "${a}" は ${TAG} のリリースに存在しません`);
    }
  }

  // 2. sha256sum コマンド例
  for (const [name, text] of Object.entries(allDocs)) {
    for (const m of text.matchAll(/sha256sum -c (SHA256SUMS-[a-z0-9-]+\.txt)|shasum -a 256 -c (SHA256SUMS-[a-z0-9-]+\.txt)/g)) {
      const f = m[1] || m[2];
      if (assets.includes(f)) ok(`${name}: sha256sum -c ${f} — 実在します`);
      else fail(`${name}: sha256sum -c ${f} — 実在しないチェックサムファイル`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. コマンド例の --flag 検証
// ---------------------------------------------------------------------------
for (const [name, text] of Object.entries(allDocs)) {
  for (const block of codeBlocks(text)) {
    for (const raw of block.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line || !/(node|eh-runall|eh-viewer|\.bat|\.mjs)/.test(line)) continue;
      if (/^(git|npm|ffmpeg|gifsicle|xattr|certutil|Get-FileHash|sha256sum|shasum)/.test(line)) continue;
      const flags = analyzeCommand(line);
      const script = scriptOf(line);
      if (!script || flags.length === 0) continue;
      for (const f of flags) {
        if (NON_FLAGS.has(f)) continue;
        if (scriptFlags[script].has(f)) {
          ok(`${name}: ${f} は ${script} が受理します`);
        } else if (script === "run_all.mjs" && (buildExeFlags.has(f) || downloaderFlags.has(f))) {
          ok(`${name}: ${f} は ${script} のコンテキストで有効 (downloader / build_exe 由来)`);
        } else if (script === "run_all.mjs" && f === "--del") {
          ok(`${name}: ${f} は ${script} (run_all → convert 経由) で受理`);
        } else {
          fail(`${name}: ${f} は ${script} のパーサに存在しません`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. run_all passThrough (-- 以降) の検証
// ---------------------------------------------------------------------------
for (const [name, text] of Object.entries(allDocs)) {
  for (const block of codeBlocks(text)) {
    for (const raw of block.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!/run_all\.mjs|run_all\.bat|eh-runall/.test(line)) continue;
      const flags = analyzeCommand(line);
      for (const f of flags) {
        if (NON_FLAGS.has(f)) continue;
        if (runAllFlags.has(f) || downloaderFlags.has(f) || buildExeFlags.has(f)) continue;
        fail(`${name}: ${f} は run_all / downloader / build_exe のどのパーサにもありません`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. バージョン表記の一致 (package.json vs ドキュメント)
// ---------------------------------------------------------------------------
for (const [name, text] of Object.entries(allDocs)) {
  for (const m of text.matchAll(/FileVersion ([0-9]+\.[0-9]+\.[0-9]+)/g)) {
    if (m[1] === pkg.version) ok(`${name}: FileVersion ${m[1]} は package.json と一致`);
    else fail(`${name}: FileVersion ${m[1]} が package.json (${pkg.version}) と不一致`);
  }
}

// ---------------------------------------------------------------------------
// github-slugger ルール (lowercase → 記号除去 → 空白をハイフン化)
// ---------------------------------------------------------------------------
function ghSlug(text) {
  let s = text.toLowerCase();
  s = s.replace(/[^\p{L}\p{N}\p{M}\- ]/gu, "");
  s = s.replace(/ /g, "-");
  return s;
}

// Markdown ファイルから有効アンカー一覧を作る (見出し + 明示 <a id>)
// 本文 (コードブロック外) のみを取り出す。
// ```markdown ブロックは「README に貼る例」の例示であり実リンクではないため、
// リンク検証の対象から除外する。
function proseText(text) {
  const out = [];
  let inCode = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    out.push(line);
  }
  return out.join("\n");
}

function collectAnchors(text) {
  const anchors = new Set();
  let inCode = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) anchors.add(ghSlug(m[2]));
  }
  for (const m of text.matchAll(/<a id="([^"]+)">/g)) anchors.add(m[1]);
  // GitHub は見出し連番 (-1, -2) も生成するが、参照側は通常ベース名を使う。
  // 重複時の連番参照はここでは検証しない (重複自体はセクション 6 が検出する)。
  return anchors;
}

// Markdown 画像参照 ![..](..) を [](..) と同じ扱いで拾うためのリンク抽出
function extractLinks(text) {
  const links = [];
  for (const m of text.matchAll(/!??\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push(m[1]);
  return links;
}

// ---------------------------------------------------------------------------
// 6. README 見出しの重複検出 (コードブロック内の # を除外)
// ---------------------------------------------------------------------------
{
  const lines = readme.split(/\r?\n/);
  const headings = [];
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) headings.push(m[2]);
  }
  const counts = {};
  let dup = 0;
  for (const t of headings) {
    const base = ghSlug(t);
    if (counts[base] === undefined) counts[base] = 0;
    else { counts[base]++; dup++; console.log("重複アンカー:", "#" + base + (counts[base] > 1 ? "-" + counts[base] : ""), "<-", t); }
  }
  if (dup === 0) ok(`README の見出し ${headings.length} 個に重複アンカーなし`);
  else fail(`README に重複アンカーが ${dup} 個あります`);
}

// ---------------------------------------------------------------------------
// 7. リンク & アンカー参照検証 (README / docs の相対リンク・ページ内アンカー)
// ---------------------------------------------------------------------------
{
  // 各 Markdown の有効アンカー集合 (見出し + 明示 <a id>)
  const anchorCache = new Map(); // relPath -> Set<anchor>
  for (const [name, text] of Object.entries(allDocs)) {
    if (notesKeys.includes(name)) continue;
    anchorCache.set(name, collectAnchors(text));
  }

  let refOk = 0, refFail = 0, linkOk = 0, linkFail = 0;
  const checkAnchor = (file, targetFile, anchor) => {
    const a = decodeURIComponent(anchor);
    const set = anchorCache.get(targetFile);
    if (set && set.has(a)) { refOk++; ok(`${file}: ${targetFile}#${a} は有効なアンカーです`); }
    else { refFail++; fail(`${file}: ${targetFile}#${a} は無効なアンカーです`); }
  };

  for (const [name, text] of Object.entries(allDocs)) {
    if (notesKeys.includes(name)) continue; // リリースノートの相対リンクは GitHub 上で別解釈になるため除外
    for (const raw of extractLinks(proseText(text))) {
      const link = raw.trim();
      if (!link) continue;
      if (link.startsWith("#")) { checkAnchor(name, name, link.slice(1)); continue; } // ページ内アンカー
      if (/^(https?:|mailto:|data:)/i.test(link)) continue; // 外部リンクは対象外

      const hashIdx = link.indexOf("#");
      const targetPart = hashIdx >= 0 ? link.slice(0, hashIdx) : link;
      const anchorPart = hashIdx >= 0 ? link.slice(hashIdx + 1) : null;
      if (!targetPart) continue;

      // ファイル存在チェック (画像・md・その他すべて)
      const resolved = path.resolve(path.dirname(path.join(rootDir, name)), targetPart);
      if (fs.existsSync(resolved)) {
        linkOk++;
      } else {
        linkFail++;
        fail(`${name}: リンク先 ${path.relative(rootDir, resolved).split(path.sep).join("/")} が存在しません`);
      }
      // .md へのアンカー付き参照はアンカーも検証
      if (anchorPart && /.(md|markdown)$/i.test(targetPart)) {
        const rel = path.relative(rootDir, resolved).split(path.sep).join("/");
        if (anchorCache.has(rel)) checkAnchor(name, rel, anchorPart);
      }
    }
  }
  if (linkOk > 0 && linkFail === 0) ok(`相対リンク ${linkOk} 件すべて存在します`);
  if (refOk === 0 && refFail === 0 && linkOk === 0 && linkFail === 0) console.log("(リンク・アンカー参照なし)");
}


// 結果
// ---------------------------------------------------------------------------
console.log(`\n=== 結果: ${checks} ok / ${failures} fail ===`);
process.exit(failures > 0 ? 1 : 0);
