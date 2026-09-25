// 結合テスト: fetch をモックし、複数URL + 失敗URLのバッチ動作を検証する
// 実行: node test_eh_download.mjs  (成功時 exit 0 / 失敗時 exit 1)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const origCwd = process.cwd();
const G1 = "https://e-hentai.org/g/111/aaaa1111/";
const G2 = "https://e-hentai.org/g/222/bbbb2222/";
const G_BAD = "https://e-hentai.org/g/333/cccc3333/";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ehdl-test-"));
process.chdir(tmp); // 保存先 "." が tmp になる

const galleryHtml = (g) =>
  `<!doctype html><html><head><title>Test Gallery ${g} - E-Hentai</title></head>
<body><h1 id="gn">Test Gallery ${g}</h1>
<a href="${g}s/0123456789/1-1/"><img src="x.jpg"></a>
<a href="${g}s/0123456789/1-2/"><img src="x.jpg"></a>
</body></html>`;

const imgPageHtml = (n) =>
  `<html><body><img id="img" src="https://ae.example.invalid/${n}.webp"></body></html>`;

// --- fetch モック (ギャラリー / 画像ページ / 画像 / それ以外は404) ---
const fakeHeaders = (ct) => ({ get: (k) => (k.toLowerCase() === "content-type" ? ct : null) });
globalThis.fetch = async (url) => {
  const u = String(url);
  await new Promise((r) => setTimeout(r, 5));

  // /s/ (画像ページ) を /g/ (ギャラリー) より先に判定 (画像ページURLは /g/ を含むため)
  if (/\/s\/[0-9a-f]{10}\/\d+-\d+/.test(u)) {
    const n = parseInt(u.match(/(\d+)-\d+/)[1], 10);
    return { ok: true, status: 200, text: async () => imgPageHtml(n), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/111\//.test(u)) {
    return { ok: true, status: 200, text: async () => galleryHtml(G1), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/222\//.test(u)) {
    return { ok: true, status: 200, text: async () => galleryHtml(G2), headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\/g\/333\//.test(u)) {
    return { ok: true, status: 404, text: async () => "not found", headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (/\.webp$/.test(u)) {
    const body = Buffer.from(`fake-image-${u}`);
    return { ok: true, status: 200, text: async () => "", headers: fakeHeaders("image/webp"), arrayBuffer: async () => body };
  }
  return { ok: false, status: 404, text: async () => "", headers: fakeHeaders("text/html"), arrayBuffer: async () => new ArrayBuffer(0) };
};

// --- eh_download.mjs を import 実行 (import 時に即実行されるため argv を差し替え) ---
process.argv = [process.argv[0], "eh_download.mjs", G1, G2, G_BAD, "--delay", "0"];

const doneMarker = path.join(tmp, "__test_done__");
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(" ")); };
try {
  await import("./eh_download.mjs");
} catch (e) {
  logs.push(`[import エラー] ${e.stack || e.message}`);
}
// スクリプトの async IIFE 完了を待つ: サマリ or エラー出力 (または失敗) を検知したら done マーカーを書く
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
const g1Dir = fs.readdirSync(tmp).find((d) => d.startsWith("111_"));
const g2Dir = fs.readdirSync(tmp).find((d) => d.startsWith("222_"));
check("import がエラーなく完了", !/\[import エラー\]|\[タイムアウト\]/.test(output));
check("G1 フォルダが作成され2枚ダウンロード", !!g1Dir && fs.readdirSync(path.join(tmp, g1Dir)).filter((f) => f.endsWith(".webp")).length === 2);
check("G2 フォルダが作成され2枚ダウンロード", !!g2Dir && fs.readdirSync(path.join(tmp, g2Dir)).filter((f) => f.endsWith(".webp")).length === 2);
check("バッチ結果が3ギャラリーと表示", /バッチ結果 \(3 ギャラリー\)/.test(output));
check("G3(404) が失敗扱い", /✖ https:\/\/e-hentai\.org\/g\/333\//.test(output));
check("failed_urls.txt に失敗URLが書き出された", fs.existsSync(path.join(tmp, "failed_urls.txt")) && fs.readFileSync(path.join(tmp, "failed_urls.txt"), "utf8").includes(G_BAD));
check("exitCode が 2 (一部失敗)", process.exitCode === 2);

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
