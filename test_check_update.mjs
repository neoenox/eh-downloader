// ユニットテスト: scripts/check_update.mjs (自動更新チェッカー)
// 実行: node test_check_update.mjs  (成功時 exit 0 / 失敗時 exit 1)
import { checkForUpdate, compareVersions, formatUpdateNotice, clearUpdateCache, CHECK_INTERVAL_MS } from "./scripts/check_update.mjs";

let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log("ok - " + name);
  else { fails++; console.error("FAIL - " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : { actual, expected });
}

// --- compareVersions ---
eq("cmp: patch diff asc", compareVersions("v1.2.9", "v1.2.10"), -1);
eq("cmp: equal with/without v", compareVersions("1.3.0", "v1.3.0"), 0);
eq("cmp: major diff", compareVersions("v2.0.0", "v1.9.9"), 1);
eq("cmp: minor diff", compareVersions("v1.3.0", "v1.10.0"), -1);
eq("cmp: invalid returns null", compareVersions("dev", "v1.3.0"), null);
eq("cmp: garbage returns null", compareVersions("", "v1.3.0"), null);

// --- checkForUpdate: モック fetch ---
// 注意: キャッシュは OS の temp にある実ファイルを使うため、
// 最初にクリアし、各モックテストはキャッシュを介さない cacheMs: 0 で実行する。
import { clearUpdateCache as _clear } from "./scripts/check_update.mjs";
_clear();
const NO_CACHE = { cacheMs: 0 };
const release = (tag) => async () => ({
  ok: true, status: 200,
  json: async () => ({ tag_name: tag, html_url: "https://github.com/x/y/releases/tag/" + tag }),
});

eq("update available", await checkForUpdate("v1.3.1", { fetchImpl: release("v9.9.9"), repo: "x/y", ...NO_CACHE }),
  { latest: "v9.9.9", current: "v1.3.1", repo: "x/y", url: "https://github.com/x/y/releases/tag/v9.9.9" });
eq("same version -> null", await checkForUpdate("v1.3.1", { fetchImpl: release("v1.3.1"), repo: "x/y", ...NO_CACHE }), null);
eq("older latest -> null", await checkForUpdate("v2.0.0", { fetchImpl: release("v1.0.0"), repo: "x/y", ...NO_CACHE }), null);
eq("dev version -> null (no API call)", await checkForUpdate("dev", { fetchImpl: release("v9.9.9"), repo: "x/y" }), null);
eq("empty version -> null", await checkForUpdate("", { fetchImpl: release("v9.9.9"), repo: "x/y" }), null);

// HTTP エラーは静かに諦める
const httpError = async () => ({ ok: false, status: 403, json: async () => ({}) });
eq("403 rate limit -> null", await checkForUpdate("v1.3.1", { fetchImpl: httpError, repo: "x/y", ...NO_CACHE }), null);

// ネットワークエラー / タイムアウトも null (例外を投げない)
const netErr = async () => { throw new Error("offline"); };
eq("network error -> null", await checkForUpdate("v1.3.1", { fetchImpl: netErr, repo: "x/y", ...NO_CACHE }), null);
// タイムアウト: signal を尊重するモック fetch で、5 秒以内に打ち切られることを確認
const t0 = Date.now();
eq("timeout -> null (no throw)", await checkForUpdate("v1.3.1", {
  repo: "x/y",
  ...NO_CACHE,
  fetchImpl: (url, opts = {}) => new Promise((resolve, reject) => {
    opts.signal?.addEventListener("abort", () => reject(new Error("TimeoutError")));
    setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ tag_name: "v9.9.9" }) }), 8000);
  }),
}), null);
check("timeout aborts within ~6s", Date.now() - t0 < 7000, { elapsed: Date.now() - t0 });

// v プレフィックスなしの現在バージョンも受け付ける
const info = await checkForUpdate("1.3.1", { fetchImpl: release("v1.4.0"), repo: "x/y", ...NO_CACHE });
eq("current without v prefix", info && info.current, "v1.3.1");

// --- formatUpdateNotice ---
eq("notice format", formatUpdateNotice({ current: "v1.3.1", latest: "v1.4.0", url: "https://x" }),
  "⬆ 新しいバージョンがあります: v1.3.1 → v1.4.0  https://x");
eq("notice null", formatUpdateNotice(null), null);

// --- 24h キャッシュ ---
// 既定間隔のサニティ: 24 時間
check("CHECK_INTERVAL_MS is 24h", CHECK_INTERVAL_MS === 24 * 60 * 60 * 1000);

// キャッシュあり: 2 回目の呼び出しで fetch が発生しない
clearUpdateCache();
{
  let calls = 0;
  const counting = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ tag_name: "v9.9.9", html_url: "https://x/rel" }) };
  };
  const a = await checkForUpdate("v1.3.1", { fetchImpl: counting, repo: "x/y" });
  const b = await checkForUpdate("v1.3.1", { fetchImpl: counting, repo: "x/y" });
  check("cache: 2nd call served from cache", a && b && b.latest === "v9.9.9" && calls === 1, { calls });

  // 更新済みバージョンならキャッシュがあっても null (通知しない)
  const c = await checkForUpdate("v9.9.9", { fetchImpl: counting, repo: "x/y" });
  check("cache: upgraded version -> null without API call", c === null && calls === 1, { calls });

  // force: true でキャッシュを無視して再問い合わせ
  await checkForUpdate("v1.3.1", { fetchImpl: counting, repo: "x/y", force: true });
  check("cache: force bypasses cache", calls === 2, { calls });

  // cacheMs: 0 でキャッシュ無効 (即再問い合わせ)
  await checkForUpdate("v1.3.1", { fetchImpl: counting, repo: "x/y", cacheMs: 0 });
  check("cache: cacheMs=0 disables cache", calls === 3, { calls });

  // 期限切れキャッシュは再問い合わせ (checkedAt を 25h 前に書き換え)
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const cachePath = join(tmpdir(), "eh-update-check.json");
  const raw = JSON.parse(readFileSync(cachePath, "utf8"));
  raw.checkedAt = Date.now() - 25 * 60 * 60 * 1000;
  writeFileSync(cachePath, JSON.stringify(raw));
  await checkForUpdate("v1.3.1", { fetchImpl: counting, repo: "x/y" });
  check("cache: expired cache triggers refetch", calls === 4, { calls });
}
clearUpdateCache();

// 失敗はキャッシュしない: オフライン直後の呼び出しでも再試行される
clearUpdateCache();
{
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return { ok: true, status: 200, json: async () => ({ tag_name: "v2.0.0", html_url: "https://x/rel" }) };
  };
  const a = await checkForUpdate("v1.3.1", { fetchImpl: flaky, repo: "x/y" });
  const b = await checkForUpdate("v1.3.1", { fetchImpl: flaky, repo: "x/y" });
  check("cache: failure not cached, retried next time", a === null && b && b.latest === "v2.0.0" && calls === 2, { calls });
}
clearUpdateCache();

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
