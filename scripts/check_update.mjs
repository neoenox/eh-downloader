#!/usr/bin/env node
// 自動更新チェッカー: 現在のバージョンを GitHub Releases と突き合わせ、
// 新しいリリースがあれば通知する (自動ダウンロードはしない)。
//
// 使い方 (ライブラリ):
//   import { checkForUpdate } from "./scripts/check_update.mjs";
//   const info = await checkForUpdate("v1.3.1");  // 新しければ { latest, url } / 無ければ null
//
// 使い方 (CLI):
//   node scripts/check_update.mjs [現在のバージョン]
//
// 仕様:
//   - リポジトリは git remote origin から自動検出 (失敗時は neoenox/eh-downloader)
//   - GitHub API へは 1 リクエストのみ (latest release エンドポイント、タイムアウト 5 秒)
//   - ネットワークエラー・オフライン・レート制限時は静かに諦める (本線を阻害しない)
//   - SEA (単一exe) からは run_all.mjs 経由でライブラリとして呼ばれる

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "neoenox/eh-downloader";
const API_TIMEOUT_MS = 5000;

// セマンティックバージョン比較: v1.2.10 > v1.2.9 を数値比較で判定する
// 不正な形式は null を返す (更新判定を諦める)
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(v).trim());
    return m ? [1, 2, 3].map((i) => parseInt(m[i], 10)) : null;
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// git remote origin から owner/repo を抜く (失敗時はデフォルト)
function detectRepo() {
  try {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const out = fs.readFileSync(path.join(root, ".git", "config"), "utf8");
    const m = out.match(/url\s*=\s*.*github\.com[/:]([^/"]+\/[^/"]+?)(?:\.git)?\s*$/m);
    if (m) return m[1];
  } catch { /* git 情報なし (単一exe など) */ }
  return DEFAULT_REPO;
}

// GitHub の latest release を取得して現在バージョンと比較する。
// 新しいリリースがあれば { latest, url, repo } を返し、最新 / 不明なら null。
export async function checkForUpdate(currentVersion, { repo = null, fetchImpl = globalThis.fetch } = {}) {
  const cur = String(currentVersion || "").trim();
  if (!/^v?\d+\.\d+\.\d+$/i.test(cur)) return null; // dev ビルドなどは判定しない
  const repoSlug = repo || detectRepo();

  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
      headers: { "User-Agent": "eh-downloader-update-check", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null; // 404 (リリースなし) / 403 (レート制限) など → 静かに諦める
    const data = await res.json();
    const latest = String(data.tag_name || "").trim();
    const cmp = compareVersions(cur, latest);
    if (cmp === null || cmp >= 0) return null;
    return {
      latest,
      current: cur.startsWith("v") ? cur : "v" + cur,
      repo: repoSlug,
      url: String(data.html_url || `https://github.com/${repoSlug}/releases/latest`),
    };
  } catch {
    return null; // オフライン・タイムアウト → 静かに諦める
  }
}

// 通知用の 1 行メッセージを生成する
export function formatUpdateNotice(info) {
  if (!info) return null;
  return `⬆ 新しいバージョンがあります: ${info.current} → ${info.latest}  ${info.url}`;
}

// CLI 直接実行: node scripts/check_update.mjs [現在のバージョン]
const isDirectRun = (() => {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isDirectRun) {
  const argVer = process.argv[2];
  const current = argVer || JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const info = await checkForUpdate(current);
  if (info) console.log(formatUpdateNotice(info));
  else console.log(`最新です (${current})`);
}
