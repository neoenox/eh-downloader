# E-Hentai ダウンロード & 画像変換ツール

[![CI](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml/badge.svg?style=flat-square&label=CI)](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/neoenox/eh-downloader?style=flat-square&logo=github&label=release)](https://github.com/neoenox/eh-downloader/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Issues](https://img.shields.io/github/issues/neoenox/eh-downloader?style=flat-square&label=issues)](https://github.com/neoenox/eh-downloader/issues)

**日本語** | [English](#english) | [Social preview 設定ガイド](docs/social-preview.md)

E-Hentai のギャラリー画像を一括ダウンロードし、WebP → PNG/JPEG に一括変換する Node.js スクリプト集です。

## 必要環境

- [Node.js](https://nodejs.org/) v18 以上（`fetch` を内蔵しているため）
- 画像変換 (`convert_images.mjs`) のみ **sharp** が必要:
  ```bash
  npm install sharp
  ```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `eh_download.mjs` | ギャラリー画像の一括ダウンロード |
| `convert_images.mjs` | WebP → PNG/JPEG 一括変換 |
| `download.bat` / `convert.bat` | Windows 用ランチャー（ダブルクリックで対話モード） |
| `urls.txt` | 一括ダウンロード用の URL リスト（自分で作成） |
| `test_eh_download.mjs` | 結合テスト（`fetch` をモック、`node test_eh_download.mjs` で実行） |

## Windows での簡単な使い方（bat ファイル）

- **`download.bat`** … ダブルクリックすると URL 入力を求められます。`urls.txt` のような一覧ファイルのパスを入れても OK。コマンドプロンプトから `download.bat <URL> --parallel 3` のように引数を渡すことも可能
- **`convert.bat`** … ダブルクリックするとフォルダと形式（PNG/JPEG）を聞きます。初回のみ `sharp` を自動インストール。`convert.bat <フォルダ> --format jpeg` のような引数指定も可能

> 注: bat ファイルは cmd.exe が ANSI コードページでパースするため **ASCII 文字のみ**で記述しています（日本語メッセージは node 側で表示されます）。

---

## 1. ダウンロード: `eh_download.mjs`

### 単一ギャラリー / 複数ギャラリーを直接指定

```bash
node eh_download.mjs <ギャラリーURL...> [保存先ディレクトリ] [オプション]

# 例
node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/
node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/ ./pics --original

# 複数ギャラリーをスペース区切りで連続指定できる (バッチモードになる)
download.bat https://e-hentai.org/g/3796163/8237f15916/ https://e-hentai.org/g/3796162/639e17ecbf/
```

### 複数ギャラリーを一括処理

URL を 1 行 1 つ並べたテキストファイルを用意します（`#` コメント・空行 OK、重複は自動除去）:

```text
# urls.txt の例
https://e-hentai.org/g/3553112/f4c015ef04/
https://e-hentai.org/g/1234567/abcdef1234/  # 行末コメントも可
```

```bash
node eh_download.mjs --list urls.txt                # --list は省略可
node eh_download.mjs urls.txt ./pics --parallel 3   # 保存先とオプションも指定可
```

> 注: URL・一覧ファイル・保存先は自動判別されます。`https://` で始まる引数はすべてギャラリーURL、実在するファイルは一覧ファイル、それ以外は保存先ディレクトリとして扱われます。

1 件失敗（URL 切れ・削除済みなど）しても残りは継続し、最後にサマリを表示します。失敗した URL は `failed_urls.txt` に書き出されるので、`node eh_download.mjs --list failed_urls.txt` でリトライできます。

### オプション

| オプション | 説明 |
|---|---|
| `--parallel N` (`-j N`) | 同時接続数（デフォルト: 2、推奨 2〜3） |
| `--original` | オリジナル画質を試みる（**要ログイン Cookie**。失敗時は通常画質にフォールバック） |
| `--cookie "..."` | Cookie 文字列（`exhentai.org` や `--original` に必要）。環境変数 `EH_COOKIE` でも可 |
| `--list <file>` | URL 一覧ファイルを一括処理（URL 直指定との併用は不可＝エラーになる） |
| `--delay 秒` | リクエスト間隔（デフォルト: 1.2） |
| `--help` | ヘルプ表示 |

### 主な動作

- **レジューム**: 再実行するとダウンロード済みファイルはスキップ。進捗は各フォルダの `index.json` に記録
- **509 対策**: リクエスト開始間隔を全接続で共有するため、並列時もリクエストレートは逐次版と同じ。509/帯域制限を検出すると全接続が一時停止し、自動で再試行
- **出力**: `<ギャラリーID>_<タイトル>/01.webp, 02.webp, ...`（連番ファイル名）

### 注意

- **オリジナル画質はログイン必須**。未ログインでは表示用の再サンプル画像（最大 1280px・WebP）を取得
- 一時的に 509 制限がかかった場合は、しばらく待ってから再実行すれば続きから再開できます

---

## 2. 変換: `convert_images.mjs`

ダウンロードした WebP を PNG/JPEG に一括変換します。

```bash
node convert_images.mjs <画像ディレクトリ> [オプション]

# 例
node convert_images.mjs "3553112_badpeach - Asta (Honkai Star Rail) AI Generated"   # PNG へ
node convert_images.mjs ./pics --format jpeg --quality 90    # JPEG (品質90)
node convert_images.mjs ./pics --out ./png_out               # 出力先を指定
node convert_images.mjs ./pics --force                       # 出力済みも再変換
node convert_images.mjs ./pics --del                         # 変換成功後に元WebPを削除
```

### オプション

| オプション | 説明 |
|---|---|
| `--format F` | 出力形式: `png` / `jpeg`（`jpg` 可）。デフォルト: `png` |
| `--quality N` | JPEG 品質 1-100（デフォルト: 90。PNG では無視） |
| `--out DIR` | 出力先（デフォルト: `<入力DIR>/png` または `<入力DIR>/jpeg`） |
| `--parallel N` | 同時変換数（デフォルト: CPU コア数、最大 4） |
| `--force` | 出力済みファイルも再変換 |
| `--del` | 変換成功後に元の WebP を削除（⚠ 復元不可） |
| `--help` | ヘルプ表示 |

### 注意

- **PNG はロスレスなのでファイルが大幅に大きくなります**（実測: WebP の約 13 倍）。サイズ重視なら `--format jpeg --quality 90` を推奨（実測: 約 1.9 倍）
- 出力先に同名の正常なファイルがあればスキップするため、再実行 OK

---

## よくある使い方（ワークフロー例）

```bash
# 1. URL リストを用意して一括ダウンロード（同時3接続）
node eh_download.mjs urls.txt --parallel 3

# 2. ダウンロードしたフォルダを JPEG に変換
node convert_images.mjs "3553112_badpeach - Asta (Honkai Star Rail) AI Generated" --format jpeg --quality 90

# 3. 容量が許せば元の WebP を削除
node convert_images.mjs "3553112_badpeach - ..." --format jpeg --del
```

## 終了コード

| コード | 意味 |
|---|---|
| `0` | 成功 |
| `2` | 一部失敗（`failed_urls.txt` / 再実行でリトライ可能） |
| `1` | 致命的エラー（URL 不正・引数不足など） |

## 免責

利用は各サイトの利用規約と各国の法律を遵守のうえ、自己責任でお願いします。過度なアクセスは IP 制限の対象になるため `--parallel` は 2〜3、`--delay` は 1 秒以上を推奨します。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 neoenox

---

<a id="english"></a>
# E-Hentai Downloader & Image Converter (English)

[![CI](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml/badge.svg?style=flat-square&label=CI)](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/neoenox/eh-downloader?style=flat-square&logo=github&label=release)](https://github.com/neoenox/eh-downloader/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square)](LICENSE)

**English** | [日本語](#e-hentai-ダウンロード-画像変換ツール) | [Social preview guide](docs/social-preview.md)

A set of Node.js scripts to batch-download E-Hentai galleries and convert the downloaded WebP images to PNG/JPEG.

## Requirements

- [Node.js](https://nodejs.org/) v18+ (has built-in `fetch`)
- **sharp** is only required for image conversion (`convert_images.mjs`):
  ```bash
  npm install sharp
  ```

## Files

| File | Purpose |
|---|---|
| `eh_download.mjs` | Batch gallery downloader |
| `convert_images.mjs` | WebP → PNG/JPEG batch converter |
| `download.bat` / `convert.bat` | Windows launchers (double-click for interactive mode) |
| `urls.txt` | URL list for batch downloads (create your own) |
| `test_eh_download.mjs` | Integration test (fetch-mocked, run with `node test_eh_download.mjs`) |

## 1. Download: `eh_download.mjs`

### Single gallery / multiple galleries

```bash
node eh_download.mjs <gallery URL...> [output dir] [options]

# Examples
node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/
node eh_download.mjs https://e-hentai.org/g/3553112/f4c015ef04/ ./pics --original

# Multiple galleries can be passed space-separated (runs as a batch)
node eh_download.mjs https://e-hentai.org/g/AAA/xxx/ https://e-hentai.org/g/BBB/yyy/
```

### Batch via a URL list file

Create a text file with one URL per line (`#` comments and blank lines are OK, duplicates are removed automatically):

```text
# urls.txt example
https://e-hentai.org/g/3553112/f4c015ef04/
https://e-hentai.org/g/1234567/abcdef1234/  # end-of-line comments work too
```

```bash
node eh_download.mjs --list urls.txt                # --list is optional
node eh_download.mjs urls.txt ./pics --parallel 3   # output dir and options also work
```

> Note: URLs, list files and output dirs are auto-detected. Arguments starting with `https://` are gallery URLs, an existing file is treated as a list file, and anything else is the output directory. Combining `--list` with direct URLs is an error.

If one gallery fails (dead link, deleted, etc.), the rest continue and a summary is printed at the end. Failed URLs are written to `failed_urls.txt` so you can retry with `node eh_download.mjs --list failed_urls.txt`.

### Options

| Option | Description |
|---|---|
| `--parallel N` (`-j N`) | Concurrent connections (default: 2, recommended 2–3) |
| `--original` | Try original quality (**requires login cookies**; falls back to normal quality on failure) |
| `--cookie "..."` | Cookie string (required for `exhentai.org` and `--original`). Also via the `EH_COOKIE` env var |
| `--list <file>` | Batch process a URL list file (cannot be combined with direct URLs — exits with an error) |
| `--delay SEC` | Delay between requests (default: 1.2) |
| `--help` | Show help |

### Key behaviors

- **Resume**: re-running skips already-downloaded files; progress is tracked in each folder's `index.json`
- **509 handling**: the request interval is shared across all connections, so the request rate stays the same as sequential. When a 509/bandwidth limit is detected, all connections pause and retry automatically
- **Output**: `<gallery ID>_<title>/01.webp, 02.webp, ...` (sequential file names)

### Notes

- **Original quality requires login.** Without cookies you get the resampled display image (max 1280px, WebP)
- If a temporary 509 limit hits, wait a while and re-run to resume where you left off

---

## 2. Convert: `convert_images.mjs`

Batch-converts downloaded WebP images to PNG/JPEG.

```bash
node convert_images.mjs <image dir> [options]

# Examples
node convert_images.mjs "3553112_gallery title"               # to PNG
node convert_images.mjs ./pics --format jpeg --quality 90     # JPEG (quality 90)
node convert_images.mjs ./pics --out ./png_out                # custom output dir
node convert_images.mjs ./pics --force                        # re-convert existing outputs
node convert_images.mjs ./pics --del                          # delete source WebP after success
```

### Options

| Option | Description |
|---|---|
| `--format F` | Output format: `png` / `jpeg` (`jpg` accepted). Default: `png` |
| `--quality N` | JPEG quality 1–100 (default: 90; ignored for PNG) |
| `--out DIR` | Output directory (default: `<input DIR>/png` or `<input DIR>/jpeg`) |
| `--parallel N` | Concurrent conversions (default: CPU cores, max 4) |
| `--force` | Re-convert files that already have output |
| `--del` | Delete the source WebP after successful conversion (⚠ unrecoverable) |
| `--help` | Show help |

### Notes

- **PNG is lossless, so files get much larger** (measured: ~13× WebP). For size, prefer `--format jpeg --quality 90` (measured: ~1.9×)
- Existing valid outputs are skipped, so re-running is safe

---

## Typical workflow

```bash
# 1. Prepare a URL list and batch-download (3 concurrent connections)
node eh_download.mjs urls.txt --parallel 3

# 2. Convert the downloaded folder to JPEG
node convert_images.mjs "3553112_gallery title" --format jpeg --quality 90

# 3. Optionally delete the original WebP
node convert_images.mjs "3553112_gallery title" --format jpeg --del
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `2` | Partial failure (`failed_urls.txt` / retry with a re-run) |
| `1` | Fatal error (invalid URL, missing args, etc.) |

## Disclaimer

Use at your own risk and in compliance with each site's terms of service and local laws. Excessive access can lead to IP bans, so keep `--parallel` at 2–3 and `--delay` at 1 second or more.

## License

[MIT License](LICENSE) — Copyright (c) 2026 neoenox
