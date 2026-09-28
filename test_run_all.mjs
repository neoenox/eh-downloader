// 結合テスト: run_all.mjs のパイプライン (ダウンロード → 変換 → ビューワー起動) を検証する
// ローカルHTTPサーバーで E-Hentai 風の応答を返し、実ファイル生成まで確認する。
// 実行: node test_run_all.mjs  (成功時 exit 0 / 失敗時 exit 1)
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const RUN_ALL = path.join(rootDir, "run_all.mjs");
const sharp = (await import("sharp")).default;

setTimeout(() => { console.error("[TIMEOUT] test did not finish in 90s"); process.exit(1); }, 90000).unref();

let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log("ok - " + name);
  else { fails++; console.error("FAIL - " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : { actual, expected });
}

// ---------- ローカルモックサーバー (E-Hentai 風) ----------
// 契約:
//   GET /g/<gid>/<key>/            ... ギャラリーHTML (h1#gn タイトル, /s/ リンク, ?p= ページ)
//   GET /g/<gid>/<key>/?p=N        ... 2ページ目以降
//   GET /s/<hash>/<gid>-<page>/    ... 画像ページHTML (img#img)
//   GET /img/<gid>-<page>.webp     ... WebP 本体 (Content-Type: image/webp)
const GID = 777;
const PAGES = 3; // 3枚のギャラリー
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  const send = (ct, body) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(200, { "Content-Type": ct, "Content-Length": buf.length });
    res.end(buf);
  };
  if (/^\/g\/\d+\/[0-9a-f]+\/?$/.test(p)) {
    // 実サイトと同じく /s/<hash>/<gid>-<n>/ はルート直下。ホストは Host ヘッダから (ポート落ち防止)
    const host = req.headers.host;
    let links = "";
    for (let n = 1; n <= PAGES; n++) links += `<a href="http://${host}/s/0123456789/${GID}-${n}/"><img src="t.jpg"></a>`;
    send("text/html", `<!doctype html><html><head><title>Mock Gallery - E-Hentai</title></head><body><h1 id="gn">Mock Gallery ${GID}</h1>${links}</body></html>`);
    return;
  }
  if (/^\/s\/[0-9a-f]{10}\/\d+-\d+\/?$/.test(p)) {
    const n = parseInt(p.match(/-(\d+)/)[1], 10);
    send("text/html", `<html><body><img id="img" src="http://${req.headers.host}/img/${GID}-${n}.webp"></body></html>`);
    return;
  }
  if (/^\/img\/\d+-\d+\.webp$/.test(p)) {
    const n = parseInt(p.match(/-(\d+)\.webp$/)[1], 10);
    const colors = [{ r: 200, g: 60, b: 60 }, { r: 60, g: 200, b: 60 }, { r: 60, g: 60, b: 200 }];
    const png = await sharp({ create: { width: 640 + n, height: 400, channels: 3, background: colors[(n - 1) % 3] } }).webp().toBuffer();
    send("image/webp", png);
    return;
  }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const mockPort = server.address().port;
// localhost は IPv6 (::1) に解決されることがあり、127.0.0.1 で listen したサーバーに
// 届かないケースがあるため、テストでは 127.0.0.1 を直接使う
const GALLERY_URL = `http://127.0.0.1:${mockPort}/g/${GID}/abcd1234/`;
console.log(`mock server on :${mockPort}`);

// ---------- 共通ヘルパー ----------
function waitExit(child) {
  return new Promise((res) => {
    const t = setTimeout(() => res("timeout"), 60000);
    child.once("exit", (c) => { clearTimeout(t); res(c); });
  });
}
function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
// 指定ポートのビューワーが /api/list に応答するまで待つ
async function waitViewer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/list`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// ================== シナリオ1: URL 指定 → DL → 変換(png) → ビューワー ==================
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall1-"));
  const port = await freePort();
  const child = spawn(process.execPath, [
    RUN_ALL, GALLERY_URL, "--out", work, "--port", String(port), "--no-open",
  ], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  // run_all はビューワーを detached 起動して自分は終了する
  const code = await waitExit(child);
  eq("scenario1: run_all exits 0", code, 0);

  // ダウンロード結果 (<gid>_<title>/NN.webp)
  const entries = fs.readdirSync(work).filter((n) => fs.statSync(path.join(work, n)).isDirectory() && n.startsWith(GID + "_"));
  check("scenario1: gallery folder created", entries.length === 1, fs.readdirSync(work));
  const gdir = path.join(work, entries[0]);
  eq("scenario1: 3 webp downloaded", fs.readdirSync(gdir).filter((n) => n.endsWith(".webp")).length, PAGES);

  // 変換結果 (<gdir>/png/NN.png)
  const pngDir = path.join(gdir, "png");
  check("scenario1: png output dir created", fs.existsSync(pngDir));
  eq("scenario1: 3 png converted", fs.readdirSync(pngDir).filter((n) => n.endsWith(".png")).length, PAGES);

  // 元 WebP は --del を付けていないので残る
  check("scenario1: webp kept (no --del)", fs.readdirSync(gdir).filter((n) => n.endsWith(".webp")).length === PAGES);

  // ログに 3 フェーズが出ている
  check("scenario1: phase logs", /\[1\/3\] ダウンロード/.test(out) && /\[2\/3\] 変換/.test(out) && /\[3\/3\] ビューワー起動/.test(out));

  // --- 1行進捗表示の検証 ---
  // パイプ (非TTY) ではライブ行は出ず、ギャラリー単位の確定行 (✔/△/✖) のみ
  check("scenario1: per-gallery result line", /^✔ \S+/m.test(out), out.slice(0, 400));
  check("scenario1: dl stats condensed", /新規3 スキップ0/.test(out));
  check("scenario1: no raw eh_download progress lines", !/^\[\d\/\d\] OK /m.test(out) && !/^▶ 設定: /m.test(out));
  check("scenario1: per-folder convert result", /^✔ \S+/m.test(out) && /変換\d+ スキップ0/.test(out));
  check("scenario1: final summary", /■ 全フェーズ完了/.test(out) && /DL 1\/1 ギャラリー成功/.test(out) && /変換 1\/1 フォルダ/.test(out));

  // 色コード: FORCE_COLOR=1 で ANSI が出る (別プロセスで確認はしない。ここでは構造だけ確認)
  // (色は TTY のみデフォルト有効。FORCE_COLOR テストは scenario6 で実施)

  // ビューワーが指定ポートで起動している
  const list = await waitViewer(port);
  check("scenario1: viewer responding on given port", !!list);
  if (list) {
    // 単一フォルダなのでギャラリーフォルダ直下を開いている: WebP 3枚 + png/ サブフォルダ
    eq("scenario1: viewer lists 3 webp", list.images.length, PAGES);
    check("scenario1: png folder listed", list.dirs.includes("png"), list.dirs);
  }
  // 後片付け: ビューワーを終了
  if (list) { await fetch(`http://127.0.0.1:${port}/api/quit`).catch(() => {}); await new Promise((r) => setTimeout(r, 500)); }
}

// ================== シナリオ2: --from + --format jpeg + --del ==================
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall2-"));
  const gdir = path.join(work, "999_pre-existing");
  fs.mkdirSync(gdir);
  for (let n = 1; n <= 2; n++) {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 90, g: 90, b: 90 } } }).webp().toBuffer();
    fs.writeFileSync(path.join(gdir, `${String(n).padStart(2, "0")}.webp`), png);
  }
  const port = await freePort();
  const child = spawn(process.execPath, [
    RUN_ALL, "--from", gdir, "--format", "jpeg", "--quality", "85", "--del", "--port", String(port), "--no-open",
  ], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  const code = await waitExit(child);
  eq("scenario2: run_all exits 0", code, 0);

  const jpgDir = path.join(gdir, "jpeg");
  check("scenario2: jpeg output dir created", fs.existsSync(jpgDir));
  eq("scenario2: 2 jpeg converted", fs.readdirSync(jpgDir).filter((n) => /\.jpe?g$/i.test(n)).length, 2);
  eq("scenario2: webp deleted by --del", fs.readdirSync(gdir).filter((n) => n.endsWith(".webp")).length, 0);

  const list = await waitViewer(port);
  check("scenario2: viewer responding", !!list);
  if (list) {
    // --del 後は上位フォルダに表示可能ファイルが無いため、変換先 jpeg/ 自体が開かれる
    eq("scenario2: viewer shows 2 jpeg", list.images.length, 2);
    check("scenario2: viewer at jpeg dir", /jpeg$/.test(list.base) || list.curName.includes("jpeg"), { base: list.base, cur: list.cur });
    await fetch(`http://127.0.0.1:${port}/api/quit`).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ================== シナリオ3: --no-view (ビューワーなしで完了) ==================
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall3-"));
  const child = spawn(process.execPath, [
    RUN_ALL, GALLERY_URL, "--out", work, "--no-view",
  ], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  const code = await waitExit(child);
  eq("scenario3: --no-view exits 0", code, 0);
  const gdir = path.join(work, fs.readdirSync(work).find((n) => n.startsWith(GID + "_")));
  eq("scenario3: webp downloaded", fs.readdirSync(gdir).filter((n) => n.endsWith(".webp")).length, PAGES);
  check("scenario3: no convert by default? (converted)", fs.existsSync(path.join(gdir, "png")));
  // ポートで待つプロセスが残っていないことの簡易確認は省略 (--no-view なので起動しない)
}

// ================== シナリオ5: フォルダ直接指定 (ドラッグ&ドロップ相当) ==================
// URL を 1 つも含まないフォルダ位置引数は --from 相当 (変換+閲覧) になる。
// これにより run_all.bat への「送る」や D&D が folder で機能する。
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall5-"));
  const gdir = path.join(work, "555_dropped");
  fs.mkdirSync(gdir);
  for (let n = 1; n <= 2; n++) {
    const buf = await sharp({ create: { width: 280, height: 180, channels: 3, background: { r: 30, g: 140, b: 90 } } }).webp().toBuffer();
    fs.writeFileSync(path.join(gdir, `${String(n).padStart(2, "0")}.webp`), buf);
  }
  // フォルダをそのまま位置引数で渡す (--from を付けない)
  const port = await freePort();
  const child = spawn(process.execPath, [
    RUN_ALL, gdir, "--format", "jpeg", "--port", String(port), "--no-open",
  ], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  const code = await waitExit(child);
  eq("scenario5: dropped folder exits 0", code, 0);

  const jpgDir = path.join(gdir, "jpeg");
  check("scenario5: jpeg converted", fs.existsSync(jpgDir) && fs.readdirSync(jpgDir).filter((n) => /\.jpe?g$/i.test(n)).length === 2);

  const list = await waitViewer(port);
  check("scenario5: viewer responding", !!list);
  if (list) {
    eq("scenario5: viewer shows 2 jpeg", list.images.length, 2);
    await fetch(`http://127.0.0.1:${port}/api/quit`).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ================== シナリオ4: 死亡URL (エラーを検出して終了コード 2) ==================
// 注意: spawnSync は親のイベントループを塞ぐため、親が持つモックサーバーに
// 子プロセスの fetch が届かなくなる。必ず非同期の spawn を使う。
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall4-"));
  // モックは /g/<数字>/<hex>/ のみ gallery として応答する。hex以外のキーは 404 になる
  const child = spawn(process.execPath, [RUN_ALL, `http://127.0.0.1:${mockPort}/g/1/not-a-gallery/`, "--out", work, "--no-view"], {
    cwd: work, stdio: ["ignore", "pipe", "pipe"],
  });
  let out4 = "";
  child.stdout.on("data", (d) => (out4 += d));
  child.stderr.on("data", (d) => (out4 += d));
  const code = await waitExit(child);
  // 死亡ギャラリーは eh_download が exit 2 (一部失敗) で返し、run_all もそれを伝播する
  eq("scenario4: dead gallery -> exit 2", code, 2);
  check("scenario4: error surfaced", /失敗/.test(out4));
  check("scenario4: failed_urls.txt written", fs.existsSync(path.join(work, "failed_urls.txt")));
}

// ================== シナリオ6: 色付き出力 (FORCE_COLOR) と --no-color ==================
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "runall6-"));
  // ダウンロード済みフォルダを用意 (--from モードで軽量化)
  const gdir = path.join(work, "666_colored");
  fs.mkdirSync(gdir);
  const buf6 = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 10, g: 10, b: 10 } } }).webp().toBuffer();
  fs.writeFileSync(path.join(gdir, "01.webp"), buf6);

  const run = (env, extra = []) => new Promise((resolve) => {
    const c = spawn(process.execPath, [RUN_ALL, gdir, "--no-view", ...extra], {
      cwd: work, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.stderr.on("data", (d) => (o += d));
    c.on("exit", (code) => resolve({ code, out: o }));
  });

  const withColor = await run({ FORCE_COLOR: "1" });
  eq("scenario6: FORCE_COLOR exits 0", withColor.code, 0);
  check("scenario6: ANSI codes present with FORCE_COLOR", /\x1b\[3(1|2)m/.test(withColor.out), withColor.out.slice(0, 300));
  check("scenario6: green check with color", withColor.out.includes("\x1b[32m"));

  const noColor = await run({ FORCE_COLOR: "1" }, ["--no-color"]);
  eq("scenario6: --no-color exits 0", noColor.code, 0);
  check("scenario6: --no-color strips ANSI", !/\x1b\[/.test(noColor.out), noColor.out.slice(0, 300));
  check("scenario6: --no-color still shows results", /^✔ \S+/m.test(noColor.out));

  const autoPlain = await run({ FORCE_COLOR: "", NO_COLOR: "1" });
  check("scenario6: NO_COLOR respected", !/\x1b\[/.test(autoPlain.out));
}

server.close();
console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
