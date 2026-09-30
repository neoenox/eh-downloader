#!/usr/bin/env node
/**
 * update_changelog.mjs — タグから CHANGELOG.md を自動更新するスクリプト
 *
 * 使い方:
 *   node scripts/update_changelog.mjs <tag>
 *     例: node scripts/update_changelog.mjs v1.4.1
 *
 * 動作:
 *   - `git log <前タグ>..<tag>` のコミット件名を取得し、Change/Feature タイプで分類
 *   - 対応する前タグは git tag --sort=-creatordate から自動解決 (タグが1つだけの場合は initial release)
 *   - CHANGELOG.md の [Unreleased] セクション (日本語 + English) を新リリースセクションで置換
 *     - Unreleased が空 (プレースホルダのみ) の場合は、コミット件名からカテゴリ別に自動生成
 *     - Unreleased に手動記載がある場合はその内容を尊重し、日付・見出しだけ付与
 *   - 底部の compare リンクを更新
 *
 * このスクリプトは release.yml から呼ばれる (タグ push 時に main へ自動コミット & push)。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = "neoenox/eh-downloader";

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
}

// ── 引数 ──────────────────────────────────────────────
const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(tag)) {
  fail("使い方: node scripts/update_changelog.mjs <tag>  (例: v1.4.1)");
}
const version = tag.replace(/^v/, "");

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const changelogPath = path.join(root, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) fail("CHANGELOG.md が見つかりません");

// ── 前タグの解決 ──────────────────────────────────────
function resolvePrevTag() {
  // このタグ自身より古い (作成日時順) タグを列挙
  const tags = git(["tag", "--sort=creatordate", "--merged", tag]).split("\n").map(t => t.trim()).filter(Boolean);
  const idx = tags.indexOf(tag);
  if (idx === -1) fail(`タグ ${tag} がローカルに見つかりません`);
  return idx > 0 ? tags[idx - 1] : null; // 初回リリースなら null
}

// ── コミット取得 ──────────────────────────────────────
function getCommits(prevTag) {
  const range = prevTag ? `${prevTag}..${tag}` : tag;
  const raw = git(["log", range, "--pretty=format:%s"]);
  return raw.split("\n").map(s => s.trim()).filter(Boolean);
}

// コミット件名を (type, subject) に分解。"type: subject" / "type(scope): subject" 形式
const TYPE_MAP = {
  add: "added", feat: "added", feature: "added", new: "added",
  fix: "fixed", bugfix: "fixed", correct: "fixed",
  change: "changed", update: "changed", improve: "changed", refactor: "changed", docs: "changed", chore: "changed", ci: "changed", test: "changed",
  remove: "removed", drop: "removed", delete: "removed", deprecate: "removed",
};

function classify(subject) {
  const m = subject.match(/^([a-zA-Z]+)(\([^)]*\))?!?\s*:\s*(.+)$/);
  if (m) {
    const type = TYPE_MAP[m[1].toLowerCase()];
    if (type) return { type, subject: m[3].trim() };
    return { type: "changed", subject: subject.trim() };
  }
  return { type: "changed", subject: subject.trim() };
}

// ── CHANGELOG のパース ─────────────────────────────────
const HEADINGS = {
  added: { ja: "### 追加", en: "### Added" },
  changed: { ja: "### 変更", en: "### Changed" },
  fixed: { ja: "### 修正", en: "### Fixed" },
  removed: { ja: "### 廃止", en: "### Removed" },
};
const ORDER = ["added", "changed", "fixed", "removed"];

const PLACEHOLDER_RE = /^\s*[-*]\s*\((?:次回リリース予定の変更はここに追記|upcoming changes go here)\)\s*$/;

function splitUnreleased(text, isJa) {
  // Unreleased セクション (### 見出し含む) の中身を取り出す。Unreleased 自体が無い場合は null
  const unreleasedHeader = "## [Unreleased]";
  const nextHeader = isJa ? "\n## [v" : "\n## [v";
  const start = text.indexOf(unreleasedHeader);
  if (start === -1) return null;
  let body = "";
  const nextIdx = text.indexOf(nextHeader, start);
  if (nextIdx === -1) {
    body = text.slice(start + unreleasedHeader.length);
  } else {
    body = text.slice(start + unreleasedHeader.length, nextIdx);
  }
  return body;
}

// Unreleased 本体 (## [Unreleased] の直後〜次の ## まで) を
// { added: [...], changed: [...], fixed: [...], removed: [...] } にパース
// トップレベル項目 (「- 」開始) を取り込み、既定カテゴリは added (手動記載は Unreleased 冒頭に置かれるため)
function parseUnreleased(body) {
  const result = { added: [], changed: [], fixed: [], removed: [] };
  let current = "added"; // ### 見出しの前のトップレベル項目は added として扱う
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const heading = line.trim();
      current = ORDER.find(k => HEADINGS[k].ja === heading || HEADINGS[k].en === heading) || "changed";
      continue;
    }
    const t = line.trim();
    if (t === "") continue;
    if (PLACEHOLDER_RE.test(line)) continue;
    // サブ項目 (「  - 」等) は直前の項目の続きとしてそのまま残す
    if (!t.startsWith("-") && !t.startsWith("*")) {
      if (result[current].length === 0) continue;
      result[current].push(line);
      continue;
    }
    result[current].push(line);
  }
  return result;
}

function hasEntries(parsed) {
  return ORDER.some(k => parsed[k].length > 0);
}

function buildSection(parsed, isJa) {
  const lines = [];
  for (const key of ORDER) {
    const items = parsed[key];
    if (items.length === 0) continue;
    lines.push("", isJa ? HEADINGS[key].ja : HEADINGS[key].en, "");
    for (const item of items) lines.push(item);
  }
  return lines.join("\n");
}

// ── 日付取得 ──────────────────────────────────────────
function getTagDate() {
  try {
    return git(["log", "-1", "--format=%as", tag]); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── main ──────────────────────────────────────────────
const prevTag = resolvePrevTag();
const commits = getCommits(prevTag);
const tagDate = getTagDate();
const comparePrev = prevTag || "v1.0.0";

// --- Unreleased の内容を取得 ---
let changelog = fs.readFileSync(changelogPath, "utf8");
// CRLF / LF の違いを吸収 (Git の autocrlf で LF に正規化してから処理する)
const hadCRLF = changelog.includes("\r\n");
if (hadCRLF) changelog = changelog.replace(/\r\n/g, "\n");

// 日本語部と英語部それぞれの Unreleased を「空のプレースホルダ」に戻し、
// 元の本文を取り出す (取り出した本文に手動記載があればそれを新セクションに流用する)
function extractUnreleased(text, fromMarker) {
  const head = "## [Unreleased]";
  let start;
  if (fromMarker) {
    const markerIdx = text.indexOf("# Changelog (English)");
    if (markerIdx === -1) return { text, body: null };
    start = text.indexOf(head, markerIdx);
  } else {
    start = text.indexOf(head);
  }
  if (start === -1) return { text, body: null };
  const nextIdx = text.indexOf("\n## [v", start);
  if (nextIdx === -1) return { text, body: null };
  const body = text.slice(start + head.length, nextIdx);
  const placeholder = fromMarker
    ? `${head}\n\n- (upcoming changes go here)\n`
    : `${head}\n\n- (次回リリース予定の変更はここに追記)\n`;
  // 「head まで」+「プレースホルダ」+「nextIdx 以降」で再構成
  const replaced = text.slice(0, start) + placeholder + text.slice(nextIdx);
  return { text: replaced, body };
}

// 日本語部を先に処理
const jaResult = extractUnreleased(changelog, false);
changelog = jaResult.text;
const jaBody = jaResult.body;

// 英語部を処理
const enResult = extractUnreleased(changelog, true);
changelog = enResult.text;
const enBody = enResult.body;

if (jaBody === null || enBody === null) {
  fail("[Unreleased] セクションが見つかりません。CHANGELOG.md の形式を確認してください");
}

const jaParsed = parseUnreleased(jaBody);
const enParsed = parseUnreleased(enBody);
const jaHasEntries = hasEntries(jaParsed);
const enHasEntries = hasEntries(enParsed);

// リリース関連のメタコミットは changelog の項目から除外
let sectionJa;
let sectionEn;

function isMetaCommit(subject) {
  return /^(release v\d|bump version|merge pull request|update changelog)/i.test(subject);
}

function collectSections(isJa) {
  const parsed = {};
  for (const c of commits) {
    if (isMetaCommit(c)) continue;
    const { type, subject } = classify(c);
    (parsed[type] ??= []).push(`- ${subject}`);
  }
  return parsed;
}

if (jaHasEntries) {
  sectionJa = buildSection(jaParsed, true);
  console.log("• Unreleased (日本語) の手動記載を使用");
} else {
  const parsed = collectSections(true);
  const built = buildSection(
    { added: parsed.added ?? [], changed: parsed.changed ?? [], fixed: parsed.fixed ?? [], removed: parsed.removed ?? [] },
    true
  );
  sectionJa = built || "\n### 変更\n\n- (リリースノートなし)";
  console.log(`• Unreleased (日本語) はコミット ${commits.length} 件から自動生成`);
}

if (enHasEntries) {
  sectionEn = buildSection(enParsed, false);
  console.log("• Unreleased (English) の手動記載を使用");
} else {
  const parsed = collectSections(false);
  const built = buildSection(
    { added: parsed.added ?? [], changed: parsed.changed ?? [], fixed: parsed.fixed ?? [], removed: parsed.removed ?? [] },
    false
  );
  sectionEn = built || "\n### Changed\n\n- (no release notes)";
  console.log(`• Unreleased (English) はコミット ${commits.length} 件から自動生成`);
}

// ── セクション挿入 ─────────────────────────────────────
const releaseHeading = `## [${tag}] — ${tagDate}`;

function insertJaSection(text, heading, section) {
  // Unreleased プレースホルダの直後に挿入 (heading は「## [tag] — 日付: タイトル」、section は「\n### ...」で始まる)
  const anchor = "- (次回リリース予定の変更はここに追記)";
  const idx = text.indexOf(anchor);
  if (idx === -1) fail("日本語 Unreleased のプレースホルダが見つかりません");
  const insertPos = idx + anchor.length;
  return text.slice(0, insertPos) + `\n\n${heading}\n${section}` + text.slice(insertPos);
}

function insertEnSection(text, heading, section) {
  const anchor = "- (upcoming changes go here)";
  const idx = text.indexOf(anchor);
  if (idx === -1) fail("英語 Unreleased のプレースホルダが見つかりません");
  const insertPos = idx + anchor.length;
  return text.slice(0, insertPos) + `\n\n${heading}\n${section}` + text.slice(insertPos);
}

// リリース見出しのタイトル部分。手動記載があればその最初の項目から、無ければコミットから推定
function deriveTitle(parsed, isJa) {
  const first = (parsed.added[0] ?? parsed.changed[0] ?? parsed.fixed[0] ?? parsed.removed[0] ?? "")
    .replace(/^\s*-\s*/, "")
    .replace(/^\*\*(.+)\*\*.*$/, "$1"); // 「**タイトル** — 説明」なら太字部分だけ
  return first || (isJa ? "メンテナンスリリース" : "Maintenance release");
}
const titleJa = deriveTitle(jaParsed, true);
const titleEn = deriveTitle(enParsed, false);

changelog = insertJaSection(changelog, `${releaseHeading}: ${titleJa}`, sectionJa);
changelog = insertEnSection(changelog, `${releaseHeading}: ${titleEn}`, sectionEn);

// ── compare リンク更新 ─────────────────────────────────
const linkAnchor = `[Unreleased]: https://github.com/${REPO}/compare/`;
const linkIdx = changelog.indexOf(linkAnchor);
if (linkIdx !== -1) {
  const newLinks = [
    `[Unreleased]: https://github.com/${REPO}/compare/${tag}...HEAD`,
    `[${tag}]: https://github.com/${REPO}/compare/${comparePrev}...${tag}`,
  ].join("\n");
  // 既存の [Unreleased] 行だけ差し替え、新タグ行を先頭に追加
  const rest = changelog.slice(linkIdx);
  const lineEnd = rest.indexOf("\n");
  changelog = changelog.slice(0, linkIdx) + newLinks + rest.slice(lineEnd);
}

if (hadCRLF) changelog = changelog.replace(/\n/g, "\r\n");
fs.writeFileSync(changelogPath, changelog);
console.log(`✔ CHANGELOG.md を更新しました (${tag}, ${tagDate}, 前タグ: ${prevTag ?? "なし"})`);
