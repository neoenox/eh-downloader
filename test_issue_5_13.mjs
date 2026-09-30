import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatLimitWait,
  isExhentaiNlPage,
  runDownload,
  withNlBypass,
} from "./eh_download.mjs";

const checks = [];
const check = (name, condition) => checks.push({ name, condition });

check(
  "509 wait includes remaining images and ETA",
  formatLimitWait(60, { remaining: 7, etaMinutes: 3 }) ===
    "509: 60秒待機中 (残り 7 枚 / 推定 3分)",
);
check(
  "NL warning is detected only before image links are available",
  isExhentaiNlPage('<html><h1>Content Warning</h1><a href="?nl=1">continue</a></html>') &&
    !isExhentaiNlPage('<a href="/s/0123456789/1001-1/">image</a>'),
);
const bypass = new URL(withNlBypass("https://exhentai.org/g/1001/abcdef/?p=2"));
check(
  "NL bypass preserves existing query parameters",
  bypass.searchParams.get("p") === "2" && bypass.searchParams.get("nl") === "1",
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ehdl-nl-test-"));
const oldCwd = process.cwd();
const oldCookie = process.env.EH_COOKIE;
process.env.EH_COOKIE = "";
process.chdir(tmp);

const gallery = "https://exhentai.org/g/1001/abcdef1234/";
const galleryMissingCookie = "https://exhentai.org/g/1002/abcdef1234/";
const warningHtml =
  '<html><head><title>Content Warning</title></head><body>' +
  '<a href="?nl=1">Never Warn Me Again</a></body></html>';
const galleryHtml =
  '<html><head><title>NL Test - E-Hentai</title></head><body>' +
  '<h1 id="gn">NL Test</h1>' +
  '<a href="https://exhentai.org/s/0123456789/1001-1/"><img src="t.jpg"></a>' +
  "</body></html>";
const imagePageHtml =
  '<html><body><img id="img" src="https://img.example.invalid/1.jpg"></body></html>';

const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  const headers = {
    get(name) {
      return String(name).toLowerCase() === "content-type" ? "text/html" : null;
    },
  };

  if (u.startsWith(galleryMissingCookie)) {
    return {
      ok: true,
      status: 200,
      headers,
      text: async () => warningHtml,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }
  if (u.startsWith(gallery)) {
    const isBypass = new URL(u).searchParams.get("nl") === "1";
    return {
      ok: true,
      status: 200,
      headers,
      text: async () => (isBypass ? galleryHtml : warningHtml),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }
  if (/exhentai\.org\/s\/0123456789\/1001-1/.test(u)) {
    return {
      ok: true,
      status: 200,
      headers,
      text: async () => imagePageHtml,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }
  if (u === "https://img.example.invalid/1.jpg") {
    const data = Uint8Array.from([1, 2, 3, 4]);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      text: async () => "",
      arrayBuffer: async () => data.buffer,
    };
  }
  return {
    ok: false,
    status: 404,
    headers,
    text: async () => "not found",
    arrayBuffer: async () => new ArrayBuffer(0),
  };
};

const logs = [];
const originalLog = console.log;
console.log = (...args) => logs.push(args.join(" "));

let okCode;
let missingCode;
try {
  okCode = await runDownload([
    gallery,
    ".",
    "--cookie",
    "ipb_member_id=1; ipb_pass_hash=x; igneous=y",
    "--delay",
    "0",
    "--retries",
    "1",
  ]);
  missingCode = await runDownload([
    galleryMissingCookie,
    ".",
    "--delay",
    "0",
    "--retries",
    "1",
  ]);
} finally {
  console.log = originalLog;
  process.chdir(oldCwd);
  if (oldCookie === undefined) delete process.env.EH_COOKIE;
  else process.env.EH_COOKIE = oldCookie;
}

const output = logs.join("\n");
check("NL gallery completes after nl=1 retry", okCode === 0);
check(
  "NL bypass request was made",
  calls.some((url) => {
    try {
      return new URL(url).hostname === "exhentai.org" &&
        new URL(url).pathname.startsWith("/g/1001/") &&
        new URL(url).searchParams.get("nl") === "1";
    } catch {
      return false;
    }
  }),
);
check(
  "downloaded image is persisted",
  fs.existsSync(path.join(tmp, "1001_NL Test", "1.jpg")),
);
check(
  "missing ExHentai cookie has a specific error",
  missingCode === 2 && /ExHentai 用の cookie が不足しています/.test(output),
);

let failed = 0;
for (const item of checks) {
  originalLog(`${item.condition ? "PASS" : "FAIL"}: ${item.name}`);
  if (!item.condition) failed++;
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) {
  console.error(`${failed} checks failed`);
  process.exit(1);
}
