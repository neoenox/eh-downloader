// 結合テスト: image_viewer.mjs を子プロセスで起動し、実際のHTTPサーバー経由で
// 一覧取得・自然順ソート・ファイル取得・パストラバーサル防止・終了処理を検証する
// 実行: node test_image_viewer.mjs  (成功時 exit 0 / 失敗時 exit 1)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import net from "node:net";
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
// タグ検索用の metadata.json (01_alpha と 10_beta に付与)
fs.writeFileSync(path.join(tmp, "01_alpha", "metadata.json"), JSON.stringify({
  title: "Alpha Collection",
  category: "Doujinshi",
  uploadedAt: "2026-01-15 12:34",
  rating: "4.80",
  tags: { artist: ["alice"], character: ["asta"], series: ["honkai star rail"], language: ["japanese"], category: ["Doujinshi"] },
}));
fs.writeFileSync(path.join(tmp, "10_beta", "metadata.json"), JSON.stringify({
  title: "Beta Works",
  category: "Manga",
  uploadedAt: "2025-06-01 09:00",
  rating: "3.20",
  tags: { artist: ["beta"], language: ["english"], category: ["Manga"] },
}));
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

  // エクスプローラー連携は廃止: /api/open は存在しない (404)
  const op = await fetch(base + "/api/open?d=" + encodeURIComponent("01_alpha"));
  check("open api removed: 404", op.status === 404, op.status);

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

// ================== タグ検索 API の検証 ==================
{
  const { child, ready } = startServer();
  const port = await ready;
  const base = "http://localhost:" + port;

  // タグクラウド (namespace ごとの集計)
  const jt = await (await fetch(base + "/api/tags")).json();
  eq("tags: artist counted", jt.tags.artist, { alice: 1, beta: 1 });
  eq("tags: series counted", jt.tags.series, { "honkai star rail": 1 });
  check("tags: metadata-less folders excluded", !jt.tags.artist || (!jt.tags.artist.empty && !jt.tags.artist["10_beta"]), jt.tags);

  // 自由語検索 (タイトル部分一致・大文字小文字を無視)
  const j1 = await (await fetch(base + "/api/search?q=alpha")).json();
  eq("search: q=title match", j1.results.map((r) => r.dir), ["01_alpha"]);
  check("search: result carries tags", j1.results[0].tags.artist.includes("alice"));

  // タグ検索 (namespace:値 の部分一致)
  const j2 = await (await fetch(base + "/api/search?tag=" + encodeURIComponent("artist:beta"))).json();
  eq("search: tag match", j2.results.map((r) => r.dir), ["10_beta"]);

  // 複合: 自由語 + タグの AND
  const j3 = await (await fetch(base + "/api/search?q=works&tag=" + encodeURIComponent("language:english"))).json();
  eq("search: q+tag AND", j3.results.map((r) => r.dir), ["10_beta"]);

  // 該当なし
  const j4 = await (await fetch(base + "/api/search?q=nonexistent")).json();
  eq("search: no match", j4.count, 0);

  // メタデータなしフォルダは検索対象外 (empty/ には metadata.json がない)
  const j5 = await (await fetch(base + "/api/search?q=" + encodeURIComponent("empty"))).json();
  eq("search: folders without metadata excluded", j5.count, 0);

  // 日付範囲フィルタ
  const j6 = await (await fetch(base + "/api/search?from=2026-01-01")).json();
  eq("search: from filter (2026 only)", j6.results.map((r) => r.dir), ["01_alpha"]);
  const j7 = await (await fetch(base + "/api/search?to=2025-12-31")).json();
  eq("search: to filter (2025 only)", j7.results.map((r) => r.dir), ["10_beta"]);
  const j8 = await (await fetch(base + "/api/search?from=2025-01-01&to=2026-12-31")).json();
  eq("search: from+to range covers both", j8.count, 2);
  // slash 区切りも受け付ける
  const j8b = await (await fetch(base + "/api/search?from=2026/01/01")).json();
  eq("search: slash date accepted", j8b.results.map((r) => r.dir), ["01_alpha"]);

  // 評価下限
  const j9 = await (await fetch(base + "/api/search?minRating=4")).json();
  eq("search: minRating 4.0", j9.results.map((r) => r.dir), ["01_alpha"]);
  const j10 = await (await fetch(base + "/api/search?minRating=3")).json();
  eq("search: minRating 3.0 covers both", j10.count, 2);
  const j11 = await (await fetch(base + "/api/search?minRating=4.9")).json();
  eq("search: minRating above all -> none", j11.count, 0);

  // 組み合わせ: タグ + 日付 + 評価
  const j12 = await (await fetch(base + "/api/search?tag=" + encodeURIComponent("language:japanese") + "&from=2026-01-01&minRating=4.5")).json();
  eq("search: tag+date+rating AND", j12.results.map((r) => r.dir), ["01_alpha"]);
  const j13 = await (await fetch(base + "/api/search?tag=" + encodeURIComponent("language:english") + "&minRating=4"));
  eq("search: tag+rating no match", (await j13.json()).count, 0);

  await fetch(base + "/api/quit");
  check("search: server exits cleanly", (await waitExit(child)) === 0);
}

// ================== ✕終了ボタンの動作検証 ==================
// UI (quitApp) が実際に行う「fetch /api/quit → サーバー終了」フローを、
// 実際の起動形態ごとに検証する:
//   1. 通常起動: fetch 完了後にプロセスが code 0 で終わる (既に上で検証済みだがここでは
//      「keep-alive 接続が残っていても終了する」ことを開いている接続ありで再確認)
//   2. detached spawn (run_all と同じ起動方法) でも子プロセスが確実に落ちる
//      (ゾンビサーバーが残らない)
{
  // --- 1. 接続を開いたまま /api/quit → code 0 で終了 (closeAllConnections の検証) ---
  {
    const { child, ready } = startServer();
    const port = await ready;
    const base = "http://localhost:" + port;

    // keep-alive エージェントで接続を開いたまま維持する (✕終了時のブラウザ相当)
    const keepalive = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const openConn = () => new Promise((resolve, reject) => {
      const req = http.request(base + "/api/list", { agent: keepalive }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    await openConn();

    const q = await fetch(base + "/api/quit");
    eq("quit w/ open connection: ok json", await q.json(), { ok: true });
    const code = await waitExit(child);
    check("quit w/ open connection: server exits code 0", code === 0, { code });
    keepalive.destroy();
  }

  // --- 2. detached spawn (run_all と同じ起動方法) でも /api/quit で落ちる ---
  {
    const child = spawn(process.execPath, [VIEWER, tmp, "--no-open", "--port", "0"], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // run_all.mjs の openViewer と同じ起動方法
    });
    child.unref();
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("detached server timeout\n" + stdout)), 15000);
      child.stdout.on("data", (d) => {
        const m = String(d).match(/localhost:(\d+)/);
        if (m) { clearTimeout(t); resolve(parseInt(m[1], 10)); }
      });
    });
    const base = "http://localhost:" + port;

    // ビューワー UI と同じ: fetch /api/quit を叩く (UI は confirm 後にこれだけを行う)
    const q = await fetch(base + "/api/quit");
    eq("detached quit: ok json", await q.json(), { ok: true });
    const code = await waitExit(child);
    check("detached quit: server exits code 0 (no zombie)", code === 0, { code });

    // ポートが閉じていること (ゾンビサーバーが残っていない)
    await new Promise((r) => setTimeout(r, 300));
    // 接続試行が失敗する (= ポートが閉じている) ことを確認
    const portFree = await new Promise((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port });
      const done = (v) => { try { s.destroy(); } catch { /* ignore */ } resolve(v); };
      s.on("connect", () => done(false));
      s.on("error", () => done(true));
      setTimeout(() => done(true), 2000).unref();
    });
    check("detached quit: port closed after exit", portFree, { port });
  }
}

console.log(fails === 0 ? "\nAll tests passed." : `\n${fails} test(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
