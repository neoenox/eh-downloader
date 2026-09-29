// 結合テスト: fetch をモックし、複数URL + 失敗URLのバッチ動作を検証する
// 実行: node test_eh_download.mjs  (成功時 exit 0 / 失敗時 exit 1)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const origCwd = process.cwd();
const G1 = "https://e-hentai.org/g/111/aaaa1111/";
const G2 = "https://e-hentai.org/g/222/bbbb2222/";
const G_BAD = "https://e-hentai.org/g/333/cccc3333/";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ehdl-test-"));
process.chdir(tmp); // 保存先 "." が tmp になる

const galleryHtml = (g, title = `Test Gallery ${g}`) =>
  `<!doctype html><html><head><title>${title} - E-Hentai</title></head>
<body><h1 id="gn">${title}</h1>
<div id="gdc"><div>Doujinshi</div></div>
<table id="gdd">
<tr><td class="gdt1">Posted:</td><td class="gdt2">2026-09-26 12:34</td></tr>
<tr><td class="gdt1">Rating:</td><td class="gdt2"><span id="rating_label">Average: 4.50</span></td></tr>
</table>
<table id="taglist">
<tr><td class="tc">artist:</td><td><a>alice</a></td></tr>
<tr><td class="tc">character:</td><td><a>asta</a></td></tr>
<tr><td class="tc">parody:</td><td><a>honkai star rail</a></td></tr>
<tr><td class="tc">language:</td><td><a>japanese</a></td></tr>
</table>
<a href="${g}s/0123456789/1-1/"><img src="x.jpg"></a>
<a href="${g}s/0123456789/1-2/"><img src="x.jpg"></a>
</body></html>`;

const imgPageHtml = (n) =>
  `<html><body><img id="img" src="https://ae.example.invalid/${n}.webp"></body></html>`;

// --- fetch モック (ギャラリー / 画像ページ / 画像 / それ以外は404) ---
const fakeHeaders = (ct) => ({ get: (k) => (k.toLowerCase() === "content-type" ? ct : null) });
const fakeWebp = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 32, g: 64, b: 96 } },
}).webp().toBuffer();
globalThis.fetch = async (url) => {
  const u = String(url);
  await new Promise((r) => setTimeout(r, 5));

  // /s/ (画像ページ) を /g/ (ギャラリー) より先に判定 (画像ページURLは /g/ を含むため)
  if (/\/s\/[0-9a-f]{10}\/\d+-\d+/.test(u)) {
    const n = parseInt(u.match(/(\d+)-\d+/)[1], 10);
    return { ok: true, status: 200, text: async () => imgPageHtml(n), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/111\//.test(u)) {
    return { ok: true, status: 200, text: async () => galleryHtml(G1, "CON"), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/222\//.test(u)) {
    return { ok: true, status: 200, text: async () => galleryHtml(G2, "....   "), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/333\//.test(u)) {
    return { ok: true, status: 404, text: async () => "not found", headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\.webp$/.test(u)) {
    const body = fakeWebp;
    return { ok: true, status: 200, text: async () => "", headers: fakeHeaders("image/webp"), arrayBuffer: async () => body };
  }
  return { ok: false, status: 404, text: async () => "", headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
};

// --- eh_download.mjs を import 実行 (import 時に即実行されるため argv を差し替え) ---
process.argv = [process.argv[0], "eh_download.mjs", G1, G2, G_BAD, "--delay", "0", "--convert", "png", "--quality", "80"];

const doneMarker = path.join(tmp, "__test_done__");
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(" ")); };
let runDlResult = null;
try {
  // ライブラリ化済み: runDownload(argv) を明示呼び出しする (直接 import は副作用なし)
  // --convert で DL 後変換も検証する (process.argv は上で --convert png を含む形に差し替え済み)
  const { runDownload } = await import("./eh_download.mjs");
  runDlResult = await runDownload([G1, G2, G_BAD, "--delay", "0", "--convert", "png", "--quality", "80"]);
} catch (e) {
  logs.push(`[import エラー] ${e.stack || e.message}`);
}
// runDownload の完了を待つ: サマリ or エラー出力 (または失敗) を検知したら done マーカーを書く
const waitDone = (async () => {
  for (let i = 0; i < 600; i++) {
    const s = logs.join("\n");
    if (/合計: /.test(s) || /エラー: /.test(s)) break;
    await new Promise((r) => setTimeout(r, 50));
    if (i === 599) logs.push("[タイムアウト] スクリプトが完了しませんでした");
  }
  fs.writeFileSync(doneMarker, "done");
})();
await waitDone;
console.log = origLog;

const output = logs.join("\n");
origLog("--- スクリプト出力 ---\n" + output + "\n--- 出力ここまで ---");

// --- 検証 ---
const checks = [];
const check = (name, cond) => checks.push({ name, cond });

process.chdir(origCwd); // Windows ではカレントディレクトリを削除できないため先に戻る
check("exitCode が 2 (一部失敗)", runDlResult === 2);
const g1Dir = fs.readdirSync(tmp).find((d) => d === "111__CON");
const g2Dir = fs.readdirSync(tmp).find((d) => d === "gallery_222");
check("import がエラーなく完了", !/\[import エラー\]|\[タイムアウト\]/.test(output));
check("Windows予約語タイトルを安全な名前へ変換", g1Dir === "111__CON");
check("空になるタイトルは gallery_<gid> へフォールバック", g2Dir === "gallery_222");
check("G1 フォルダが作成され2枚ダウンロード", !!g1Dir && fs.readdirSync(path.join(tmp, g1Dir)).filter((f) => f.endsWith(".webp")).length === 2);
check("G2 フォルダが作成され2枚ダウンロード", !!g2Dir && fs.readdirSync(path.join(tmp, g2Dir)).filter((f) => f.endsWith(".webp")).length === 2);
check("G1 が1コマンドでPNG変換される", !!g1Dir && fs.readdirSync(path.join(tmp, g1Dir, "png")).filter((f) => f.endsWith(".png")).length === 2);
check("G2 が1コマンドでPNG変換される", !!g2Dir && fs.readdirSync(path.join(tmp, g2Dir, "png")).filter((f) => f.endsWith(".png")).length === 2);
const metadata = JSON.parse(fs.readFileSync(path.join(tmp, g1Dir, "metadata.json"), "utf8"));
check("metadata.json にカテゴリを保存", metadata.category === "Doujinshi" && metadata.tags.category.includes("Doujinshi"));
check("metadata.json に投稿日と評価を保存", metadata.uploadedAt === "2026-09-26 12:34" && metadata.rating === "4.50");
check("metadata.json に主要タグを保存", metadata.tags.artist.includes("alice") && metadata.tags.character.includes("asta") && metadata.tags.series.includes("honkai star rail") && metadata.tags.language.includes("japanese"));
check("バッチ結果が3ギャラリーと表示", /バッチ結果 \(3 ギャラリー\)/.test(output));
check("G3(404) が失敗扱い", /✖ https:\/\/e-hentai\.org\/g\/333\//.test(output));
check("failed_urls.txt に失敗URLが書き出された", fs.existsSync(path.join(tmp, "failed_urls.txt")) && fs.readFileSync(path.join(tmp, "failed_urls.txt"), "utf8").includes(G_BAD));

let failedCount = 0;
for (const c of checks) {
  origLog(`${c.cond ? "PASS" : "FAIL"}: ${c.name}`);
  if (!c.cond) failedCount++;
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failedCount > 0) {
  console.error(`\n${failedCount} 件のチェックが失敗しました`);
  process.exit(1);
}
process.exitCode = 0; // import したスクリプトが設定した exitCode (2) をリセット

// --- CLI レベルの検証 (子プロセス・オフライン: process.exit() の挙動も含めて確認) ---
const scriptPath = fileURLToPath(new URL("./eh_download.mjs", import.meta.url));
const cliTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ehdl-cli-"));
const runCli = (argv) =>
  spawnSync(process.execPath, [scriptPath, ...argv], { cwd: cliTmp, timeout: 30000, encoding: "utf8" });

// 404 (恒久的エラー) を子プロセスで即失敗させるため、fetch をモックしたラッパー経由で実行する
const mockWrapper = path.join(cliTmp, "mock_404_runner.mjs");
fs.writeFileSync(
  mockWrapper,
  `// 404 を返す fetch モック → eh_download.mjs の runDownload を実行
import fs from "node:fs";
import path from "node:path";
const realFetch = globalThis.fetch;
let notFoundHits = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/\\/g\\/333\\//.test(u)) {
    notFoundHits++;
    // 呼び出し回数をファイルに記録 (親プロセスから検証する)
    fs.writeFileSync(path.join(${JSON.stringify(cliTmp)}, "notfound_hits.txt"), String(notFoundHits));
    return { ok: false, status: 404, text: async () => "not found", headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/html" : null) }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return realFetch(url, opts);
};
const { runDownload } = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});
process.exitCode = await runDownload([${JSON.stringify(G_BAD)}]);
`,
);

fs.writeFileSync(path.join(cliTmp, "urls.txt"), `${G1}\n`);
fs.writeFileSync(path.join(cliTmp, "empty.txt"), "# コメントのみの中身空の一覧\n");

const cliChecks = [];
const cliCheck = (name, cond) => cliChecks.push({ name, cond });

// (1) --list と URL 直指定の併用はエラーで即終了する (黙って URL を無視しない)
const r1 = runCli(["--list", "urls.txt", G1]);
cliCheck("--list+URL 併用が exit 1", r1.status === 1);
cliCheck("併用エラーのメッセージが表示される", /同時指定はできません/.test(r1.stderr) && r1.stderr.includes(G1));

// (2) 一覧ファイルの自動判定は位置不問: 第2引数の実在ファイルが一覧として拾われる
//     (旧実装は先頭非URL引数のみ判定したため「ギャラリーURLを指定してください」になっていた)
const r2 = runCli(["./not_exist_dir", "empty.txt"]);
cliCheck("後方の一覧ファイルが自動判定される", r2.status === 1 && /一覧ファイルにURLがありません/.test(r2.stderr));

// (3) 引数なしは従来どおりヘルプ+exit 1
const r3 = runCli([]);
cliCheck("引数なしはヘルプ表示で exit 1", r3.status === 1 && /使い方|オプション/.test(r3.stdout));

// (4) Issue #6: 404 はリトライせず即失敗する (旧実装は 3+6+9+12 秒待機していた)
const t0 = Date.now();
const r4 = spawnSync(process.execPath, [mockWrapper, G_BAD], { cwd: cliTmp, timeout: 60000, encoding: "utf8" });
const elapsed = Date.now() - t0;
cliCheck("404 ギャラリーが即失敗 (exit 2 / 10秒未満)", r4.status === 2 && elapsed < 10000);
cliCheck("404 の fetch 呼び出しは1回だけ (リトライなし)", fs.existsSync(path.join(cliTmp, "notfound_hits.txt")) && fs.readFileSync(path.join(cliTmp, "notfound_hits.txt"), "utf8").trim() === "1");
cliCheck("404 即失敗のメッセージが出る", /再試行不可のエラーのため即失敗/.test(r4.stdout));
cliCheck("404 が failed_urls.txt に書かれる", fs.existsSync(path.join(cliTmp, "failed_urls.txt")) && fs.readFileSync(path.join(cliTmp, "failed_urls.txt"), "utf8").includes(G_BAD));

// (5) --retries 1: 再試行可能なエラー (タイムアウト等) でも再試行せず即失敗する
const mockRetryWrapper = path.join(cliTmp, "mock_retry_runner.mjs");
fs.writeFileSync(
  mockRetryWrapper,
  `// 常にタイムアウト風エラーを投げる fetch モック → --retries の効果を検証
import fs from "node:fs";
import path from "node:path";
const realFetch = globalThis.fetch;
let hits = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/\\/g\\/444\\//.test(u)) {
    hits++;
    fs.writeFileSync(path.join(${JSON.stringify(cliTmp)}, "retry_hits.txt"), String(hits));
    throw new Error("fetch failed (mock timeout)");
  }
  return realFetch(url, opts);
};
const { runDownload } = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});
process.exitCode = await runDownload(process.argv.slice(2));
`,
);
const G_TIMEOUT = "https://e-hentai.org/g/444/dddd4444/";

// デフォルト (5回) だと時間がかかるため --retries 1 で即失敗することを確認
const t5 = Date.now();
const r5 = spawnSync(process.execPath, [mockRetryWrapper, G_TIMEOUT, "--retries", "1"], { cwd: cliTmp, timeout: 60000, encoding: "utf8" });
const elapsed5 = Date.now() - t5;
cliCheck("--retries 1 で即失敗 (10秒未満)", elapsed5 < 10000, { elapsed: elapsed5 });
cliCheck("--retries 1 の fetch 呼び出しは1回だけ", fs.existsSync(path.join(cliTmp, "retry_hits.txt")) && fs.readFileSync(path.join(cliTmp, "retry_hits.txt"), "utf8").trim() === "1");

// (6) 無効な --timeout / --retries はエラーで即終了
const r6 = runCli([G1, "--retries", "abc"]);
cliCheck("--retries abc は exit 1", r6.status === 1 && /--retries には 1-20/.test(r6.stderr));
const r6b = runCli([G1, "--retries", "0"]);
cliCheck("--retries 0 は exit 1", r6b.status === 1 && /--retries には 1-20/.test(r6b.stderr));
const r7 = runCli([G1, "--timeout", "0"]);
cliCheck("--timeout 0 は exit 1", r7.status === 1 && /--timeout には正の数値/.test(r7.stderr));

// (7) --timeout は fetch の AbortSignal.timeout に反映される (小さい値でAbortSignalが呼ばれる)
const mockTimeoutProbe = path.join(cliTmp, "mock_timeout_probe.mjs");
fs.writeFileSync(
  mockTimeoutProbe,
  `// AbortSignal.timeout に渡された値を記録してから本物のモック応答を返す
import fs from "node:fs";
import path from "node:path";
const timeouts = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/\\/g\\/555\\//.test(u)) {
    const sig = opts.signal;
    // AbortSignal.timeout で作られた signal は [Symbol(override)] 相当の内部保持値を持つが
    // 公開 API がないため、monkeypatch 済み AbortSignal.timeout を記録する方式にする
    return { ok: true, status: 200, text: async () => "no gallery", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return { ok: false, status: 404, text: async () => "", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
};
const { runDownload } = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});
process.exitCode = await runDownload(["https://e-hentai.org/g/555/eeee5555/", "--timeout", "7"]);
`,
);
// AbortSignal.timeout 自体を置き換えて記録する (子プロセス内)
fs.writeFileSync(
  path.join(cliTmp, "abort_probe_preload.mjs"),
  `const orig = AbortSignal.timeout;
AbortSignal.timeout = (ms) => {
  const fs = await import("node:fs");
  const p = ${JSON.stringify(path.join(cliTmp, "abort_ms.txt"))};
  fs.appendFileSync(p, ms + "\\n");
  return orig(ms);
};
`,
);
// preload は top-level await が使えないので sync 版で書き直す
fs.writeFileSync(
  path.join(cliTmp, "abort_probe_preload.mjs"),
  `import fs from "node:fs";
const orig = AbortSignal.timeout;
AbortSignal.timeout = (ms) => {
  fs.appendFileSyncSync ?? null;
  return orig(ms);
};
`,
);
// シンプルに: fetch モック内で opts.signal の AbortSignal インスタンスからは取れないため、
// AbortSignal.timeout をラップして記録するラッパーにまとめる
fs.writeFileSync(
  mockTimeoutProbe,
  `import fs from "node:fs";
const origTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => {
  fs.appendFileSync(${JSON.stringify(path.join(cliTmp, "abort_ms.txt"))}, ms + "\\n");
  return origTimeout(ms);
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/\\/g\\/555\\//.test(u)) {
    return { ok: true, status: 200, text: async () => "no gallery marker", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return realFetch(url, opts);
};
const { runDownload } = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});
process.exitCode = await runDownload(["https://e-hentai.org/g/555/eeee5555/", "--timeout", "7"]);
`,
);
fs.rmSync(path.join(cliTmp, "abort_ms.txt"), { force: true });
spawnSync(process.execPath, [mockTimeoutProbe], { cwd: cliTmp, timeout: 60000, encoding: "utf8" });
const abortMs = fs.existsSync(path.join(cliTmp, "abort_ms.txt")) ? fs.readFileSync(path.join(cliTmp, "abort_ms.txt"), "utf8").trim().split("\n").map(Number) : [];
cliCheck("--timeout 7 が AbortSignal.timeout(7000) として使われる", abortMs.length > 0 && abortMs.every((ms) => ms === 7000), { abortMs });

// (8) e2e 境界ケース: 509 / ネットワーク断
// 共通: ギャラリー 1 件 (2 枚) の HTML を返すモック。fetch 呼び出し回数と
// 返却シーケンスを記録ファイルに書き出し、親プロセスから検証する。
// 509 待機は実時間で 60 秒かかるため、テストでは「509 が返る呼び出し回数」と
// 「停止メッセージ / 最終的な成否」を検証対象とし、所要時間の上限だけ見る。
const G_509 = "https://e-hentai.org/g/666/ffff6666/";
const G_509_RETRY = "https://e-hentai.org/g/777/gggg7777/";
const G_NETDOWN = "https://e-hentai.org/g/888/hhhh8888/";
const mockBoundary = path.join(cliTmp, "mock_boundary.mjs");
fs.writeFileSync(
  mockBoundary,
  `// 境界ケース用 fetch モック:
//   G_509       → 常に 509 (回数超過で失敗すること)
//   G_509_RETRY → 1 回目だけ 509、以降は正常 (自動再試行で回復すること)
//   G_NETDOWN   → 1 回目だけ fetch 例外、以降は正常 (ネットワーク断からの回復)
import fs from "node:fs";
import path from "node:path";
const hits = {};
const bump = (key) => {
  hits[key] = (hits[key] || 0) + 1;
  fs.writeFileSync(path.join(${JSON.stringify(cliTmp)}, "boundary_hits.json"), JSON.stringify(hits));
  return hits[key];
};
const galleryHtml = (g) =>
  '<html><head><title>T - E-Hentai</title></head><body><h1 id="gn">T</h1>' +
  '<a href="' + g + 's/0123456789/1-1/"><img src="x.jpg"></a></body></html>';
const imgPageHtml = (n) => '<html><body><img id="img" src="https://ae.example.invalid/' + n + '.webp"></body></html>';
const ok = (body, ct) => ({ ok: true, status: 200, text: async () => body, headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? ct : null) }, arrayBuffer: async () => new ArrayBuffer(0) });
// 各ギャラリー URL への呼び出し回数を記録 (bump は 509/例外の判定内でのみ呼ぶ。
// 先に呼ぶと 1 回目が必ず正常応答になり境界が再現しない)
const is509 = (u) => /\\/g\\/666\\//.test(u) || (/\\/g\\/777\\//.test(u) && bump("777_all") === 1);
const isNetDown = (u) => /\\/g\\/888\\//.test(u) && bump("888_all") === 1;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/\\/g\\/666\\//.test(u)) bump("666_all");
  if (isNetDown(u)) throw new Error("fetch failed (ECONNRESET)");
  if (/\\/s\\/[0-9a-f]{10}\\/\\d+-\\d+/.test(u)) {
    bump("imgpage");
    return ok(imgPageHtml(parseInt(u.match(/(\\d+)-\\d+/)[1], 10)), "text/html");
  }
  if (is509(u)) return { ok: false, status: 509, text: async () => "bandwidth limit", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
  if (/\\/g\\/(666|777)\\//.test(u)) return ok(galleryHtml(u), "text/html");
  if (/\\/g\\/888\\//.test(u)) return ok(galleryHtml(u), "text/html");
  if (/\\.webp$/.test(u)) {
    bump("img");
    return { ok: true, status: 200, text: async () => "", headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "image/webp" : null) }, arrayBuffer: async () => Buffer.from("WEBPDATA") };
  }
  return { ok: false, status: 404, text: async () => "", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
};
const { runDownload } = await import(${JSON.stringify(pathToFileURL(scriptPath).href)});
// --retries を 2 に絞って 509 の 60 秒待機を 1 回だけに抑える (2 回目は成功)
process.exitCode = await runDownload(process.argv.slice(2));
`,
);

// --- 8a. 509 が 1 回だけ → 自動再試行で回復 ---
fs.rmSync(path.join(cliTmp, "failed_urls.txt"), { force: true });
fs.rmSync(path.join(cliTmp, "boundary_hits.json"), { force: true });
const r8a = spawnSync(process.execPath, [mockBoundary, G_509_RETRY, "--retries", "2", "--delay", "0"], { cwd: cliTmp, timeout: 120000, encoding: "utf8" });
cliCheck("509→回復: exit 0 (自動再試行で成功)", r8a.status === 0, { code: r8a.status, out: r8a.stdout.slice(-400) });
cliCheck("509→回復: 509検出の警告が出る", /509検出/.test(r8a.stdout));
cliCheck("509→回復: 全接続停止のメッセージ", /全\d+接続を\d+秒停止/.test(r8a.stdout));
const hits8a = JSON.parse(fs.readFileSync(path.join(cliTmp, "boundary_hits.json"), "utf8"));
cliCheck("509→回復: ギャラリー取得は2回以上 (1回目509/その後成功)", (hits8a["777_all"] || 0) >= 2, hits8a);
cliCheck("509→回復: 画像がダウンロードされている", fs.existsSync(path.join(cliTmp, "boundary_hits.json")) && JSON.parse(fs.readFileSync(path.join(cliTmp, "boundary_hits.json"), "utf8")).img >= 1, JSON.parse(fs.readFileSync(path.join(cliTmp, "boundary_hits.json"), "utf8")));

// --- 8b. 常に 509 → 試行回数を使い切って失敗扱い ---
fs.rmSync(path.join(cliTmp, "boundary_hits.json"), { force: true });
fs.rmSync(path.join(cliTmp, "failed_urls.txt"), { force: true });
const r8b = spawnSync(process.execPath, [mockBoundary, G_509, "--retries", "2", "--delay", "0"], { cwd: cliTmp, timeout: 120000, encoding: "utf8" });
cliCheck("509超過: exit 2 (一部失敗として記録)", r8b.status === 2, { code: r8b.status });
const hits8b = JSON.parse(fs.readFileSync(path.join(cliTmp, "boundary_hits.json"), "utf8"));
cliCheck("509超過: ギャラリー取得は指定試行回数だけ", (hits8b["666_all"] || 0) === 2, hits8b);
cliCheck("509超過: failed_urls.txt に書かれる", fs.existsSync(path.join(cliTmp, "failed_urls.txt")) && fs.readFileSync(path.join(cliTmp, "failed_urls.txt"), "utf8").includes(G_509));

// --- 8c. ネットワーク断が 1 回 → 自動再試行で回復 ---
fs.rmSync(path.join(cliTmp, "boundary_hits.json"), { force: true });
fs.rmSync(path.join(cliTmp, "failed_urls.txt"), { force: true });
const r8c = spawnSync(process.execPath, [mockBoundary, G_NETDOWN, "--retries", "2", "--delay", "0"], { cwd: cliTmp, timeout: 120000, encoding: "utf8" });
cliCheck("ネット断→回復: exit 0", r8c.status === 0, { code: r8c.status, out: r8c.stdout.slice(-400) });
cliCheck("ネット断→回復: 再試行メッセージが出る", /秒後に再試行/.test(r8c.stdout));
const hits8c = JSON.parse(fs.readFileSync(path.join(cliTmp, "boundary_hits.json"), "utf8"));
cliCheck("ネット断→回復: ギャラリー取得は2回以上 (1回目例外/その後成功)", (hits8c["888_all"] || 0) >= 2, hits8c);

fs.rmSync(cliTmp, { recursive: true, force: true });
let cliFailed = 0;
for (const c of cliChecks) {
  origLog(`${c.cond ? "PASS" : "FAIL"}: ${c.name}`);
  if (!c.cond) cliFailed++;
}
if (cliFailed > 0 || failedCount > 0) {
  console.error(`\nチェック失敗: in-process ${failedCount} 件 / CLI ${cliFailed} 件`);
  process.exit(1);
}
console.log("\nすべてのチェックに合格しました (in-process + CLI)");
