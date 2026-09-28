// 結合テスト: image_viewer.mjs を子プロセスで起動し、実際のHTTPサーバー経由で
// 一覧取得・自然順ソート・ファイル取得・パストラバーサル防止・終了処理を検証する
// 実行: node test_image_viewer.mjs  (成功時 exit 0 / 失敗時 exit 1)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// sharp は任意依存 (サムネイル生成の検証に使用)。無ければその系統のテストをスキップする。
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* optional */ }

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(rootDir, "image_viewer.mjs");

// --- グローバルタイムアウト（ハング防止） ---
setTimeout(() => { console.error("[TIMEOUT] test did not finish in 60s"); process.exit(1); }, 60000).unref();

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("ok - " + name); }
  else { fails++; console.error("FAIL - " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : { actual, expected });
}

// --- テスト用フォルダ構成 ---
//   2.webp / 3.png / 10.jpg ... 自然順ソートの検証 (文字列ソートだと 10 が先頭に来る)
//   notes.txt ... 非画像は一覧に出ないこと
//   .hidden.png ... ドットファイルは無視されること
//   01_alpha/ 10_beta/ empty/ ... サブフォルダも自然順に並ぶこと
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-test-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-esc-"));
fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");

const W2 = "WEBPDATA-2";
const files = {
  "2.webp": W2,
  "3.png": "PNGDATA-3",
  "10.jpg": "JPEGDATA-10",
  "notes.txt": "not an image",
  ".hidden.png": "hidden",
};
for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n), c);
fs.mkdirSync(path.join(tmp, "01_alpha"));
fs.writeFileSync(path.join(tmp, "01_alpha", "a.png"), "A");
fs.writeFileSync(path.join(tmp, "01_alpha", "b.webp"), "B");
fs.mkdirSync(path.join(tmp, "10_beta"));
fs.writeFileSync(path.join(tmp, "10_beta", "c.jpg"), "C");
fs.mkdirSync(path.join(tmp, "empty"));

// --- サーバー起動ヘルパー ---
function startServer(extraArgs = []) {
  const child = spawn(process.execPath, [VIEWER, tmp, "--no-open", "--port", "0", ...extraArgs], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout\n" + stdout + stderr)), 15000);
    const onData = () => {
      const m = stdout.match(/localhost:(\d+)/);
      if (m) { cleanup(); resolve(parseInt(m[1], 10)); }
    };
    const onExit = (code) => { cleanup(); reject(new Error("server exited early code=" + code + "\n" + stdout + stderr)); };
    const cleanup = () => { clearTimeout(timer); child.stdout.off("data", onData); child.removeListener("exit", onExit); };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
  return { child, ready, getStderr: () => stderr };
}

const names = (j) => j.images.map((o) => o.f.split("/").pop());

function waitExit(child) {
  return new Promise((res) => {
    const t = setTimeout(() => res("timeout"), 10000);
    child.once("exit", (c) => { clearTimeout(t); res(c); });
  });
}

// ================== 通常モードの検証 ==================
{
  const { child, ready } = startServer();
  const port = await ready;
  const base = "http://localhost:" + port;

  // トップページ HTML
  const home = await fetch(base + "/");
  check("GET / returns 200 HTML", home.status === 200 && (await home.text()).includes("Image Viewer"));

  // ルート一覧: 自然順ソート + 非画像/ドットファイルの除外
  const j0 = await (await fetch(base + "/api/list")).json();
  eq("root list: natural-sorted images", names(j0), ["2.webp", "3.png", "10.jpg"]);
  eq("root list: natural-sorted dirs", j0.dirs, ["01_alpha", "10_beta", "empty"]);
  check("root list: notes.txt excluded", !j0.images.some((o) => o.f.includes("notes")));
  check("root list: dotfile excluded", !j0.images.some((o) => o.f.includes("hidden")));
  check("root list: sizes included", j0.images.find((o) => o.f.endsWith("2.webp")).s === Buffer.byteLength(W2));
  eq("root list: cur/parent/siblings", [j0.cur, j0.parent, j0.siblings], ["", "", []]);
  check("root list: base name", j0.base.length > 0);
  check("root list: not recursive", j0.recursive === false);
  eq("root list: thumbs flag matches sharp availability", j0.thumbs, !!sharp);

  // サブフォルダ一覧 + 兄弟フォルダ情報
  const j1 = await (await fetch(base + "/api/list?d=01_alpha")).json();
  eq("subdir list: images", names(j1), ["a.png", "b.webp"]);
  eq("subdir list: parent/siblings", [j1.parent, j1.siblings], ["", ["01_alpha", "10_beta", "empty"]]);
  eq("subdir list: curName", j1.curName, "01_alpha");

  // ファイル取得
  const f = await fetch(base + "/api/file?f=" + encodeURIComponent("2.webp"));
  check("file: 200 + content-type + body",
    f.status === 200 && f.headers.get("content-type") === "image/webp" && (await f.text()) === W2);

  const nf = await fetch(base + "/api/file?f=" + encodeURIComponent("notes.txt"));
  check("file: non-image rejected (403)", nf.status === 403);

  // パストラバーサル防止
  const esc = await fetch(base + "/api/file?f=" + encodeURIComponent("../viewer-esc-does-not-matter/secret.txt"));
  check("file: traversal rejected", esc.status === 403);
  const esc2 = await fetch(base + "/api/file?f=" + encodeURIComponent(path.join("..", "..", "..", "..", "windows", "win.ini")));
  check("file: deep traversal rejected", esc2.status === 403);
  const esc3 = await fetch(base + "/api/list?d=" + encodeURIComponent("../" + path.basename(outside)));
  check("list: traversal rejected", esc3.status === 403);

  // エクスプローラー API (壊れず JSON を返すこと)
  const op = await fetch(base + "/api/open?d=" + encodeURIComponent("01_alpha") + "&f=" + encodeURIComponent("a.png"));
  eq("open: ok json", await op.json(), { ok: true });

  // 未知パスは 404
  const nf2 = await fetch(base + "/api/nothing");
  check("unknown path: 404", nf2.status === 404);

  // 終了 API → プロセスが code 0 で終わる
  const q = await fetch(base + "/api/quit");
  eq("quit: ok json", await q.json(), { ok: true });
  const code = await new Promise((res) => {
    const t = setTimeout(() => res("timeout"), 10000);
    child.once("exit", (c) => { clearTimeout(t); res(c); });
  });
  check("quit: server exits with code 0", code === 0, { code, stderr: child.stderrCode });
  if (code !== 0) console.error("[server stderr]\n" + child.stderr.read() );
}

// ================== --recursive モードの検証 ==================
{
  const { child, ready } = startServer(["--recursive"]);
  const port = await ready;
  const jr = await (await fetch("http://localhost:" + port + "/api/list")).json();
  eq("recursive list: all images flat & sorted",
    jr.images.map((o) => o.f),
    ["2.webp", "3.png", "10.jpg", "01_alpha/a.png", "01_alpha/b.webp", "10_beta/c.jpg"]);
  check("recursive flag reported", jr.recursive === true);
  await fetch("http://localhost:" + port + "/api/quit");
  await new Promise((res) => { const t = setTimeout(() => res(1), 10000); child.once("exit", (c) => { clearTimeout(t); res(c); }); });
}

// ================== サムネイル API の検証 (sharp がある場合) ==================
// 有効な画像を 1 枚追加する (このブロックは一覧検証の後なので list の期待値に影響しない)
if (sharp) {
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 90, g: 120, b: 200 } } })
    .png()
    .toFile(path.join(tmp, "big.png"));

  const { child, ready } = startServer(["--thumb-size", "96"]);
  const port = await ready;
  const base = "http://localhost:" + port;

  const t1 = await fetch(base + "/api/thumb?f=" + encodeURIComponent("big.png") + "&s=96");
  check("thumb: 200", t1.status === 200, t1.status);
  check("thumb: content-type webp", t1.headers.get("content-type") === "image/webp");
  const body = Buffer.from(await t1.arrayBuffer());
  check("thumb: RIFF/WEBP header",
    body.length > 12 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP");
  const meta = await sharp(body).metadata();
  check("thumb: resized to <=96", meta.width <= 96 && meta.height <= 96, { w: meta.width, h: meta.height });

  // キャッシュファイルが作られている
  const cacheDir = path.join(tmp, ".thumbcache");
  const cacheFiles = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((n) => n.endsWith(".webp")) : [];
  check("thumb: cache file created", cacheFiles.length === 1, cacheFiles);

  // 2 回目はキャッシュヒット (キャッシュファイルの mtime が変わらない = 再生成されていない)
  const cPath = path.join(cacheDir, cacheFiles[0]);
  const m1 = fs.statSync(cPath).mtimeMs;
  const t2 = await fetch(base + "/api/thumb?f=" + encodeURIComponent("big.png") + "&s=96");
  check("thumb: second request 200", t2.status === 200);
  check("thumb: cache hit (mtime unchanged)", fs.statSync(cPath).mtimeMs === m1);

  // 破損データは 404 (フォールバック)
  const bad = await fetch(base + "/api/thumb?f=" + encodeURIComponent("2.webp"));
  check("thumb: corrupt data -> 404", bad.status === 404, bad.status);

  // 非画像 / 範囲外
  check("thumb: non-image rejected", (await fetch(base + "/api/thumb?f=" + encodeURIComponent("notes.txt"))).status === 403);
  check("thumb: traversal rejected", (await fetch(base + "/api/thumb?f=" + encodeURIComponent("../x/secret.txt"))).status === 403);

  const jl = await (await fetch(base + "/api/list")).json();
  eq("list: thumbs true with sharp", jl.thumbs, true);

  await fetch(base + "/api/quit");
  check("thumb: server exits cleanly", (await waitExit(child)) === 0);
} else {
  console.log("(skip: thumbnail generation tests - sharp not installed)");
}

// ================== sharp がない環境へのフォールバック ==================
{
  // node_modules が解決できない場所にスクリプトをコピーして起動する
  const noDeps = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-nodeps-"));
  fs.copyFileSync(VIEWER, path.join(noDeps, "image_viewer.mjs"));
  fs.copyFileSync(path.join(rootDir, "sharp_loader.mjs"), path.join(noDeps, "sharp_loader.mjs"));
  const child = spawn(process.execPath, [path.join(noDeps, "image_viewer.mjs"), tmp, "--no-open", "--port", "0"], {
    cwd: noDeps,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stdout += d));
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("fallback server timeout\n" + stdout)), 15000);
    child.stdout.on("data", (d) => {
      const m = String(d).match(/localhost:(\d+)/);
      if (m) { clearTimeout(t); resolve(parseInt(m[1], 10)); }
    });
  });
  const base = "http://localhost:" + port;

  const t = await fetch(base + "/api/thumb?f=" + encodeURIComponent("3.png"));
  eq("fallback: thumb without sharp -> 503", t.status, 503);

  const jl = await (await fetch(base + "/api/list")).json();
  eq("fallback: list thumbs flag false", jl.thumbs, false);

  // 本体機能は生きている (UI は元画像にフォールバックする)
  const f = await fetch(base + "/api/file?f=" + encodeURIComponent("3.png"));
  check("fallback: /api/file still works", f.status === 200);

  await fetch(base + "/api/quit");
  check("fallback: server exits cleanly", (await waitExit(child)) === 0);
}

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
