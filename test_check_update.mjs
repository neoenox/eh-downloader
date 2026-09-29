// ユニットテスト: scripts/check_update.mjs (自動更新チェッカー)
// 実行: node test_check_update.mjs  (成功時 exit 0 / 失敗時 exit 1)
import { checkForUpdate, compareVersions, formatUpdateNotice } from "./scripts/check_update.mjs";

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
const release = (tag) => async () => ({
  ok: true, status: 200,
  json: async () => ({ tag_name: tag, html_url: "https://github.com/x/y/releases/tag/" + tag }),
});

eq("update available", await checkForUpdate("v1.3.1", { fetchImpl: release("v9.9.9"), repo: "x/y" }),
  { latest: "v9.9.9", current: "v1.3.1", repo: "x/y", url: "https://github.com/x/y/releases/tag/v9.9.9" });
eq("same version -> null", await checkForUpdate("v1.3.1", { fetchImpl: release("v1.3.1"), repo: "x/y" }), null);
eq("older latest -> null", await checkForUpdate("v2.0.0", { fetchImpl: release("v1.0.0"), repo: "x/y" }), null);
eq("dev version -> null (no API call)", await checkForUpdate("dev", { fetchImpl: release("v9.9.9"), repo: "x/y" }), null);
eq("empty version -> null", await checkForUpdate("", { fetchImpl: release("v9.9.9"), repo: "x/y" }), null);

// HTTP エラーは静かに諦める
const httpError = async () => ({ ok: false, status: 403, json: async () => ({}) });
eq("403 rate limit -> null", await checkForUpdate("v1.3.1", { fetchImpl: httpError, repo: "x/y" }), null);

// ネットワークエラー / タイムアウトも null (例外を投げない)
const netErr = async () => { throw new Error("offline"); };
eq("network error -> null", await checkForUpdate("v1.3.1", { fetchImpl: netErr, repo: "x/y" }), null);
// タイムアウト: signal を尊重するモック fetch で、5 秒以内に打ち切られることを確認
const t0 = Date.now();
eq("timeout -> null (no throw)", await checkForUpdate("v1.3.1", {
  repo: "x/y",
  fetchImpl: (url, opts = {}) => new Promise((resolve, reject) => {
    opts.signal?.addEventListener("abort", () => reject(new Error("TimeoutError")));
    setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ tag_name: "v9.9.9" }) }), 8000);
  }),
}), null);
check("timeout aborts within ~6s", Date.now() - t0 < 7000, { elapsed: Date.now() - t0 });

// v プレフィックスなしの現在バージョンも受け付ける
const info = await checkForUpdate("1.3.1", { fetchImpl: release("v1.4.0"), repo: "x/y" });
eq("current without v prefix", info && info.current, "v1.3.1");

// --- formatUpdateNotice ---
eq("notice format", formatUpdateNotice({ current: "v1.3.1", latest: "v1.4.0", url: "https://x" }),
  "⬆ 新しいバージョンがあります: v1.3.1 → v1.4.0  https://x");
eq("notice null", formatUpdateNotice(null), null);

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
