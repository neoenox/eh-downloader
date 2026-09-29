# E-Hentai ダウンロード・画像変換ツール

[![CI](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml/badge.svg?style=flat-square&label=CI)](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/neoenox/eh-downloader?style=flat-square&logo=github&label=release)](https://github.com/neoenox/eh-downloader/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Issues](https://img.shields.io/github/issues/neoenox/eh-downloader?style=flat-square&label=issues)](https://github.com/neoenox/eh-downloader/issues)

**日本語** | [English](#english) | [「送る」メニュー登録ガイド](docs/send-to.md) | [Social preview 設定ガイド](docs/social-preview.md) | [GIF デモ構成案](docs/gif-demo.md) | [📖 ドキュメント一覧](docs/index.md)

E-Hentai のギャラリー画像を一括ダウンロードし、WebP → PNG/JPEG に一括変換し、ブラウザで閲覧できる Node.js スクリプト集です。

**1 コマンドで全部:** `run_all.bat <URL>` でダウンロード → 変換 → 閲覧まで自動実行されます。ビューワーは単一 exe としても配布・ビルドできます（下記）。

`sharp` をインストールするとビューワーの一覧がサムネイル表示になり、大きなフォルダでも快適に閲覧できます（未インストールでもビューワー自体は動作します）。

## クイックスタート (初めての方はこちら)

**方法 A: 単一 exe を使う (おすすめ・インストール不要)**

1. [Releases](https://github.com/neoenox/eh-downloader/releases/latest) から `eh-runall-windows-x64.exe` をダウンロード
2. **必ず改ざん検証する** → 手順は [改ざん検証 (SHA-256)](#改ざん検証-sha-256) (exe と同じフォルダに `verify_checksums.bat` を置いてダブルクリックが簡単)
3. exe をダブルクリックして URL を入力 → ダウンロード → 変換 → ブラウザで閲覧まで自動
4. D&D や「送る」メニューにも対応 → [「送る」メニュー登録ガイド](docs/send-to.md)

> Node.js のインストールは不要です。Windows 以外は `eh-runall-linux-x64` / `eh-runall-macos-arm64` (+ `.tar.gz`) を使用。

**方法 B: Node.js スクリプトで使う (開発・カスタマイズ向け)**

```bash
# 1. Node.js v18+ をインストールし、このリポジトリを clone
git clone https://github.com/neoenox/eh-downloader.git && cd eh-downloader
npm install            # 変換・サムネイル用の sharp をインストール

# 2. 1 コマンドでダウンロード → 変換 → 閲覧
node run_all.mjs https://e-hentai.org/g/3553112/f4c015ef04/
# Windows なら run_all.bat をダブルクリックでも OK
```

目的別ガイド: [📖 ドキュメント一覧](docs/index.md) — [送るメニュー](docs/send-to.md) / [Social preview](docs/social-preview.md) / [GIF デモ](docs/gif-demo.md) / [自前ビルド](#自分でビルド)

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
| `run_all.mjs` / `run_all.bat` | 統合ランチャー: ダウンロード → 変換 → 閲覧を 1 コマンドで |
| `docs/send-to.md` | 「送る」メニュー / D&D 登録手順 |
| `urls.txt` | 一括ダウンロード用の URL リスト（自分で作成） |
| `test_eh_download.mjs` | 結合テスト（`fetch` をモック、`node test_eh_download.mjs` で実行） |
| `image_viewer.mjs` | 画像フォルダをブラウザで閲覧するビューワー |
| `viewer.bat` | ビューワー用 Windows ランチャー（ダブルクリックで対話モード） |
| `build_exe.mjs` / `build.bat` | 単一 exe ビルド（Node.js SEA 方式） |
| `verify_checksums.bat` | ダウンロードした exe の SHA-256 改ざん検証（ダブルクリックで実行） |
| `test_image_viewer.mjs` | ビューワーの結合テスト（`node test_image_viewer.mjs` で実行） |

## Windows での簡単な使い方（bat ファイル）

- **`run_all.bat`** … **おすすめ**。URL を入れるだけでダウンロード → 変換 → 閲覧まで一気に実行。**フォルダをドラッグ&ドロップや「送る」メニューから投げると変換 → 閲覧のみ実行**（詳細: [「送る」メニュー登録ガイド](docs/send-to.md)）
- **`download.bat`** … ダブルクリックすると URL 入力を求められます。`urls.txt` のような一覧ファイルのパスを入れても OK。コマンドプロンプトから `download.bat <URL> --parallel 3` のように引数を渡すことも可能
- **`convert.bat`** … ダブルクリックするとフォルダと形式（PNG/JPEG）を聞きます。初回のみ `sharp` を自動インストール。`convert.bat <フォルダ> --format jpeg` のような引数指定も可能
- **`viewer.bat`** … ダブルクリックするとフォルダ入力を求められます（空 Enter でカレントディレクトリ）。`viewer.bat <フォルダ> --recursive` のような引数指定も可能

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
node eh_download.mjs https://e-hentai.org/g/AAA/xxx/ https://e-hentai.org/g/BBB/yyy/
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

1 件失敗（URL 切れ・削除済みなど）しても残りは継続し、最後にサマリを表示します。失敗した URL は `failed_urls.txt` に書き出されるので、`node eh_download.mjs --list failed_urls.txt` でリトライできます。画像の一部だけ失敗したギャラリーもリトライ対象になるため、再実行すると失敗分だけ再取得されます（レジューム）。

> 注: 404 / 410 などの恒久的エラー（死 URL・削除済み）はリトライせず即座に失敗扱いになります。5xx やネットワークエラーのみが自動再試行の対象です。

### オプション

| オプション | 説明 |
|---|---|
| `--parallel N` (`-j N`) | 同時接続数（デフォルト: 2、推奨 2〜3） |
| `--timeout 秒` | リクエストのタイムアウト秒数（デフォルト: ページ 45 秒 / 画像 120 秒） |
| `--retries N` | 失敗時の最大試行回数（デフォルト: ページ 5 / 画像 4。`1` で再試行なし。404 などの恒久的エラーは常に即失敗） |
| `--original` | オリジナル画質を試みる（**要ログイン Cookie**。失敗時は通常画質にフォールバック） |
| `--cookie "..."` | Cookie 文字列（`exhentai.org` や `--original` に必要）。環境変数 `EH_COOKIE` でも可 |
| `--list <file>` | URL 一覧ファイルを一括処理（URL 直指定との併用は不可＝エラーになる） |
| `--delay 秒` | リクエスト間隔（デフォルト: 1.2） |
| `--convert F` | ダウンロード完了後に `png` / `jpeg` へ自動変換 |
| `--quality N` | `--convert jpeg` の品質 1–100（デフォルト: 90） |
| `--del` | `--convert` 成功後に元の WebP を削除 |
| `--no-metadata` | ギャラリーの `metadata.json` 保存を無効化 |
| `--help` | ヘルプ表示 |

### 主な動作

- **レジューム**: 再実行するとダウンロード済みファイルはスキップ。進捗は各フォルダの `index.json` に記録
- **509 対策**: リクエスト開始間隔を全接続で共有するため、並列時もリクエストレートは逐次版と同じ。509/帯域制限を検出すると全接続が一時停止し、自動で再試行
- **出力**: `<ギャラリーID>_<タイトル>/01.webp, 02.webp, ...`（連番ファイル名）
- **メタデータ**: 既定で各フォルダに `metadata.json` を保存（カテゴリ、投稿日、評価、artist/character/series/language/category タグ）。不要なら `--no-metadata`

### ダウンロードの注意

- **オリジナル画質はログイン必須**。未ログインでは表示用の再サンプル画像（最大 1280px・WebP）を取得
- 一時的に 509 制限がかかった場合は、しばらく待ってから再実行すれば続きから再開できます

---

## 2. 変換: `convert_images.mjs`

ダウンロードした WebP を PNG/JPEG に一括変換します。

```bash
node convert_images.mjs <画像ディレクトリ> [オプション]

# 例
node convert_images.mjs "3553112_gallery title"   # PNG へ
node convert_images.mjs ./pics --format jpeg --quality 90    # JPEG (品質90)
node convert_images.mjs ./pics --out ./png_out               # 出力先を指定
node convert_images.mjs ./pics --force                       # 出力済みも再変換
node convert_images.mjs ./pics --del                         # 変換成功後に元WebPを削除
```

### 変換のオプション

| オプション | 説明 |
|---|---|
| `--format F` | 出力形式: `png` / `jpeg`（`jpg` 可）。デフォルト: `png` |
| `--quality N` | JPEG 品質 1-100（デフォルト: 90。PNG では無視） |
| `--out DIR` | 出力先（デフォルト: `<入力DIR>/png` または `<入力DIR>/jpeg`） |
| `--parallel N` | 同時変換数（デフォルト: CPU コア数、最大 4） |
| `--force` | 出力済みファイルも再変換 |
| `--del` | 変換成功後に元の WebP を削除（⚠ 復元不可） |
| `--help` | ヘルプ表示 |

### 変換の注意

- **PNG はロスレスなのでファイルが大幅に大きくなります**（実測: WebP の約 13 倍）。サイズ重視なら `--format jpeg --quality 90` を推奨（実測: 約 1.9 倍）
- 出力先に同名の正常なファイルがあればスキップするため、再実行 OK

---

## 3. ビューワー: `image_viewer.mjs`

ダウンロードした画像フォルダをブラウザで閲覧するビューワーです（**追加インストール不要**・Node.js 標準モジュールのみで動作）。

```bash
node image_viewer.mjs <フォルダ> [オプション]

# 例
node image_viewer.mjs "3553112_gallery title"
node image_viewer.mjs ./pics --recursive          # サブフォルダもまとめて表示
node image_viewer.mjs ./pics --port 9000          # ポート指定
```

### ビューワーのオプション

| オプション | 説明 |
|---|---|
| `--port N` (`-p N`) | ポート指定（デフォルト: 8420、使用中なら自動で次のポートを探す） |
| `--recursive` (`-r`) | サブフォルダの画像もまとめて表示 |
| `--no-open` | ブラウザを自動で開かない |
| `--no-thumbs` | サムネイル生成を無効化（元画像を直接表示） |
| `--thumb-size N` | サムネイルの長辺サイズ（デフォルト: 400、16-2048） |
| `--window-size WxH` | Windows 専用: Edge アプリモードの初期ウィンドウサイズ（例: `1280x860`。デフォルト: 1280×860） |
| `--help` (`-h`) | ヘルプ表示 |

### 主な機能

- 対応形式: WebP / PNG / JPEG / GIF / BMP / AVIF / SVG（表示はブラウザ標準機能）
- **サムネイル高速表示**（任意）: `sharp` があれば一覧用サムネイルを自動生成し、`.thumbcache/` にキャッシュ。大きなフォルダでも一覧が快適に
  - `sharp` 未インストールでも本体は動作（サムネイルは元画像を直接表示）
  - キャッシュキーはソースパス+mtime+サイズから自動計算するため、画像を差し替えると自動で再生成（手動クリア不要）
  - 72時間以上古いキャッシュは起動時に自動削除
- サムネイル一覧 + 自然順ソート（`01, 02, …, 10` の順。エクスプローラーと同じ並び）
- **タグ検索**（`🔍 検索` ボタン / `/` キー）— ダウンロード時に保存した `metadata.json` のタグ (artist / character / series / language) でダウンロード済みコレクションを横断検索
  - タグクラウドからクリックで絞り込み、自由語（タイトル部分一致）との AND 検索に対応
  - 検索結果からギャラリーへ直接ジャンプ
- ズーム（`Ctrl`+ホイール / `-` `+` `0`）/ 回転（`r`）/ ドラッグでパン / フィット ⇄ 100%（ダブルクリック）
- スライドショー（`s`・4秒間隔・ループ）/ フルスクリーン（`f`）
- 前・次のフォルダへ移動（`PageUp` / `PageDown`）— ダウンロードしたギャラリーの連続閲覧に便利
- 「📂」ボタンで表示中の画像をエクスプローラーで表示
- セキュリティ: サーバーは `127.0.0.1` のみで待ち受け、指定フォルダ外のパスへのアクセスは拒否

### 注意

- 表示にはブラウザ画面を使用します。Windows では Edge のアプリモードで**アドレスバー無しの専用ウィンドウ**として開きます（Edge 未インストールの場合は既定のブラウザで開きます）
  - ウィンドウタイトル: `Image Viewer`
  - 初期ウィンドウサイズ: 1280×860（`--window-size WxH` で変更可能。通常のアプリと同様にリサイズ・最大化できます）
- 終了は画面右上の「✕ 終了」ボタン、またはサーバー側で `Ctrl+C`

---

## 4. 単一exeビルド: `build_exe.mjs`

### リリースからダウンロード (ビルド不要)

> ⬇ ダウンロード後は [改ざん検証 (SHA-256)](#改ざん検証-sha-256) を実施してください。

`v*` タグを push すると GitHub Actions が 3 OS 向けバイナリを自動ビルドし、Release に添付します:

| アセット | 対象 |
|---|---|
| `eh-viewer-windows-x64.exe` | Windows 10/11 (x64) — ダブルクリックで起動 |
| `eh-viewer-linux-x64` (+ `.tar.gz`) | Linux (x64) — `chmod +x` 後に実行 |
| `eh-viewer-macos-arm64` (+ `.tar.gz`) | macOS (Apple Silicon) — Gatekeeper 対策は下記 |
| `eh-runall-windows-x64.exe` | Windows 10/11 (x64) — 統合版（下記） |
| `eh-runall-linux-x64` (+ `.tar.gz`) | Linux (x64) — 統合版 |
| `eh-runall-macos-arm64` (+ `.tar.gz`) | macOS (Apple Silicon) — 統合版 |

**`eh-runall` は run_all 統合版**です。ビューワーに加えてダウンローダーと WebP 変換を同梱し、
`eh-runall.exe <URL>` 1 コマンドで DL→変換→閲覧まで完結します（`node run_all.mjs` と同一のオプション。Node.js 不要）。

```bash
git tag v1.0.0 && git push origin v1.0.0   # → Release が自動作成される
```

> macOS で「開発元が検証できません」と出た場合は `xattr -d com.apple.quarantine eh-viewer-macos-arm64` を実行してください（未署名バイナリのため）。

### 改ざん検証 (SHA-256)

> **初めて exe をダウンロードした方は必ずこの手順を実施してください。** (クイックスタート のステップ 2)

Release には各 OS の `SHA256SUMS-<os>.txt` が添付されます。ダウンロード後に改ざんされていないか確認できます。

**Windows (簡単):** `verify_checksums.bat` を exe と同じフォルダに置いてダブルクリック。または PowerShell で:

```powershell
# exe と SHA256SUMS-windows.txt を同じフォルダに置いて実行
Get-FileHash .\eh-runall-windows-x64.exe -Algorithm SHA256
# 期待値と見比べるか、verify_checksums.ps1 に .sha256 を渡して自動判定
```

**Windows (標準機能のみ):**

```bat
certutil -hashfile eh-runall-windows-x64.exe SHA256
```

**Linux / macOS:**

```bash
sha256sum -c SHA256SUMS-linux.txt      # OK と出れば一致
shasum -a 256 -c SHA256SUMS-macos.txt  # macOS
```

一致しない場合は改ざん・破損の可能性があるため、その実行ファイルは**破棄して再ダウンロード**してください。
また、ローカルで `node build_exe.mjs` を実行した場合も、ビルドログと `<exe名>.sha256` サイドカーに SHA-256 が出力されます。

### 自分でビルド

ビューワーを **Node.js 不要の単一 exe** にビルドできます（Node.js SEA 方式。Node.js 20+ があればビルド可能）。

```bash
npm install                 # esbuild / postject / sharp をインストール
node build_exe.mjs          # → dist/eh-viewer.exe (ビューワー単体)
node build_exe.mjs --runall # → dist/eh-runall.exe (run_all 統合版)
# または Windows なら build.bat をダブルクリック
```

### ビルドのオプション

| オプション | 説明 |
|---|---|
| `--out DIR` | 出力先（デフォルト: `dist/`） |
| `--name NAME` | 出力ファイル名（デフォルト: `eh-viewer` / `--runall` 時は `eh-runall`） |
| `--runall` | run_all 統合版をビルド（DL→変換→閲覧の 1 ファイル化。`eh-runall.exe <URL>` 形式） |
| `--version vX.Y.Z` | exe にバージョンを埋め込む（`eh-viewer --version` で表示。デフォルト: package.json の version） |
| `--no-sharp` | サムネイル無効でビルド（exe が約 15 MB 小さくなる） |
| `--keep` | ビルド中間ファイルを残す（デバッグ用） |

### 仕組み

- Node ランタイム（node.exe）をベースに、esbuild でバンドルしたビューワー本体と sharp 一式を SEA blob として注入
- 生成される exe はダブルクリックで起動でき、**ターゲット PC に Node.js は不要**
- sharp は初回起動時に `%TEMP%\eh-viewer-assets-<hash>\` へ展開され、以降は再利用される（アンインストールは Temp のフォルダ削除のみ。72時間未使用の古い展開先は自動掃除）
- 使い方・オプションは `node image_viewer.mjs` と同一（`eh-viewer.exe <フォルダ> --recursive` など）
- **Windows 向けにはアイコンとバージョンリソースを埋め込み**（rcedit。エクスプローラーでアイコンが表示され、ファイルのプロパティに製品名・バージョンが載る）。アイコンは `node assets/make_icons.mjs` で `assets/icon-*.ico` を再生成できる

> 注: 現在の Node.js の `node.exe` をベースにするため、ビルド OS と同じ OS/アーキ向けの exe になります（Windows でビルド → Windows 向け）。3 OS 分は GitHub Actions のリリースワークフロー（`.github/workflows/release.yml`）が自動ビルドします。

---

## よくある使い方（ワークフロー例）

### 1 コマンドで全部 (統合ランチャー)

```bash
# ダウンロード → PNG変換 → ブラウザで閲覧 を自動実行
node run_all.mjs https://e-hentai.org/g/3553112/f4c015ef04/

# JPEG に変換して元 WebP は削除
node run_all.mjs urls.txt --format jpeg --del

# ダウンロード済みフォルダを変換して閲覧 (ダウンロードはスキップ)
node run_all.mjs --from "3553112_gallery title" --format jpeg

# 変換済みフォルダを単に開き直す
node run_all.mjs --open-only "3553112_gallery title"

# フォルダを直接渡しても OK (D&D・「送る」メニューと同じ動作)
node run_all.mjs "3553112_gallery title"

# 単一 exe でも同じ (Node.js 不要。リリースの eh-runall-*.exe または --runall ビルド)
eh-runall.exe https://e-hentai.org/g/3553112/f4c015ef04/
eh-runall.exe --open-only "3553112_gallery title"

# Windows なら run_all.bat をダブルクリック (URL入力 → 形式選択)
```

> **ヒント:** `run_all.bat` を Windows の「送る」メニューに登録すると、ダウンロード済みフォルダを右クリック → 送る → run_all で変換 + 閲覧できます。詳細は [「送る」メニュー登録ガイド](docs/send-to.md)。

### run_all のオプション

| オプション | 説明 |
|---|---|
| `--out DIR` | 基準フォルダ (デフォルト: カレント) |
| `--from DIR\|FILE` | ダウンロード済みフォルダ / フォルダ一覧ファイルから変換のみ |
| `--format F` / `--quality N` | 変換形式・品質 (`convert_images.mjs` と同じ) |
| `--del` | 変換成功後に元 WebP を削除 |
| `--force` | 変換済み画像も再変換 |
| `--no-convert` | 変換せずダウンロードのみ |
| `--no-view` | ビューワーを起動せず終了 |
| `--open-only` | ダウンロード/変換なしでビューワーだけ起動 |
| `--port N` / `--recursive` / `--no-open` / `--window-size WxH` | ビューワーに渡すオプション |
| `--no-color` | 進捗表示を色なしにする (非TTY・`NO_COLOR` では自動で色なし) |
| `--verbose` | 子スクリプトの全出力をそのまま表示 (デフォルトは1行進捗に凝縮) |
| `--no-update-check` | 起動時の更新チェックを無効化 (GitHub API を叩かない。オフライン環境向け) |
| `-- <args>` | 以降を `eh_download.mjs` にそのまま渡す (`--parallel 3` など) |

ダウンロードで一部失敗した場合も変換・閲覧は続行し、終了コード `2` で報告します。

### 進捗表示

進捗はギャラリー/フォルダ単位の色付き1行表示に凝縮されます (`✔` 成功 / `△` 一部失敗 / `✖` 失敗):

```text
[1/3] ダウンロード
✔ https://e-hentai.org/g/3553112/...   新規20 スキップ0
△ https://e-hentai.org/g/9999999/...   新規5 スキップ0 失敗3

⚠ 失敗ギャラリー: 1件
  △ https://e-hentai.org/g/9999999/...
     新規5/スキップ0/失敗3 (再実行で失敗分のみ再取得)
  → 再実行: node eh_download.mjs --list "...failed_urls.txt"

[2/3] 変換 (2 フォルダ → PNG)
✔ 3553112_gallery title   変換20 スキップ0 (2.1MB→18MB, 857%)

■ 全フェーズ完了   DL 2/2 ギャラリー成功 / 変換 2/2 フォルダ
```

詳細なログを見たい場合は `--verbose` を付けると子スクリプトの出力がそのまま流れます。

### 各スクリプトを個別に実行

```bash
# ダウンロード → JPEG変換を1コマンドで実行
node eh_download.mjs urls.txt --parallel 3 --convert jpeg --quality 90

# 変換成功後に元WebPも削除
node eh_download.mjs urls.txt --parallel 3 --convert jpeg --quality 90 --del

# 従来どおり2段階でも実行可能
node eh_download.mjs urls.txt --parallel 3
node convert_images.mjs "3553112_gallery title" --format jpeg --quality 90
```

> `--del` は `--convert` と組み合わせた場合だけ有効です。変換に成功した WebP だけを削除します。

## 終了コード

| コード | 意味 |
|---|---|
| `0` | 成功 |
| `2` | 一部失敗（`failed_urls.txt` / 再実行でリトライ可能） |
| `1` | 致命的エラー（URL 不正・引数不足など） |

## ロードマップ

次回以降の機能追加候補です (順不同・実装保証なし)。興味のあるものがあれば Issue / PR でどうぞ。

v1.3.0 で達成: docs 整合性チェッカーの CI 組み込み、README/docs の日英同期、ロードマップ自体の公開。

### 利便性

- [x] **ギャラリー検索 / タグ閲覧** — ビューワーにタグ検索を実装済み (`🔍 検索` / `/` キー。タグクラウド + 自由語 AND 検索)
- [ ] **検索の拡張** — 日付範囲・評価での絞り込み、検索結果の並び替え
- [ ] **差分更新 (再同期)** — ギャラリーに新規ページが追加されたとき、既存フォルダに追加分だけをダウンロード
- [ ] **exhentai 対応の案内整備** — Cookie 設定フローの対話化 (`--cookie` / `EH_COOKIE` の入力支援)
- [ ] **サムネイルキャッシュの共有化** — `.thumbcache/` を中央一括管理にしてフォルダ移動時に再生成しない
- [x] **ビューワーの専用ウィンドウ化** — Windows では Edge アプリモードでアドレスバー無しの独立ウィンドウとして起動 (v1.3.0)。`--window-size` で初期サイズも指定可能

### 配布・インストール

- [ ] **署名付きバイナリ** — Sigstore (cosign) などでリリースバイナリに署名し、SHA-256 に加えて署名検証を提供
- [ ] **macOS の Gatekeeper 対策の軽減** — 署名/notarization による `xattr` コマンド不要化
- [ ] **winget / Homebrew 対応** — パッケージマネージャからのインストール
- [x] **自動更新チェッカー** — 実行時に GitHub Releases と照合し、新しいリリースがあれば通知 (自動 DL はしない。`--no-update-check` で無効化)。チェック結果は 24 時間キャッシュし、失敗時はキャッシュしないため次回再試行

### 安定性・保守

- [ ] **e2e テストの拡充** — モックサーバーを使った 509 / ネットワーク断・レジューム回りの境界テスト追加
- [x] **タイムアウト/リトライの設定化** — `--timeout` / `--retries` オプションを追加済み (ダウンローダーのリクエスト単位)
- [x] **CI への docs 検証組み込み** — `check:docs` を CI で常時実行 (アセット名 / SHA-256 コマンド / CLI フラグ / 相対リンク・アンカーを検証)。リリース後のタグ自動照合は今後の課題
- [x] **ビューワー終了フローの自動テスト** — ✕終了 (`/api/quit`) が detached 起動でもゾンビプロセスを残さず終了することを CI で検証

### その他

- [ ] **デモ GIF の追加** — [docs/gif-demo.md](docs/gif-demo.md) の構成案 #1〜#4 の録画
- [ ] **多言語対応** — ビューワー UI メッセージの英語化 (現在はコンソール表示中心の日本語)
- [x] **docs 目次の整備** — [docs/index.md](docs/index.md) を新設し全ガイドへの入口を整理 (v1.3.0)

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
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933.svg?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Issues](https://img.shields.io/github/issues/neoenox/eh-downloader?style=flat-square&label=issues)](https://github.com/neoenox/eh-downloader/issues)

**English** | [日本語](#e-hentai-ダウンロード画像変換ツール) | [Send-to menu guide](docs/send-to.md) | [Social preview guide](docs/social-preview.md) | [GIF demo proposal](docs/gif-demo.md) | [📖 Documentation index](docs/index.md)

A set of Node.js scripts to batch-download E-Hentai galleries, convert the downloaded WebP images to PNG/JPEG, and view them in your browser.

**One command for everything:** `run_all.bat <URL>` downloads, converts and opens the viewer automatically. Installing `sharp` upgrades the viewer with fast cached thumbnails — recommended for large folders (the viewer works without it too). The viewer can also be built into a single standalone exe (see below).

## Quick start (first time here?)

**Option A: use the single exe (recommended — nothing to install)**

1. Download `eh-runall-windows-x64.exe` from [Releases](https://github.com/neoenox/eh-downloader/releases/latest)
2. **Always verify the download first** → see [Tamper check (SHA-256)](#tamper-check-sha-256) (easiest: put `verify_checksums.bat` next to the exe and double-click it)
3. Double-click the exe, paste a gallery URL, and it downloads → converts → opens the viewer in your browser
4. Drag & drop and the Windows "Send to" menu are supported too → see the [Send-to menu guide](docs/send-to.md)

> No Node.js required. On other platforms use `eh-runall-linux-x64` / `eh-runall-macos-arm64` (+ `.tar.gz`).

**Option B: run as Node.js scripts (for development / customization)**

```bash
# 1. Install Node.js v18+, then clone this repository
git clone https://github.com/neoenox/eh-downloader.git && cd eh-downloader
npm install            # installs sharp for conversion & thumbnails

# 2. Download → convert → view in one command
node run_all.mjs https://e-hentai.org/g/3553112/f4c015ef04/
# or double-click run_all.bat on Windows
```

Guides: [📖 Documentation index](docs/index.md) — [Send-to menu](docs/send-to.md) / [Social preview](docs/social-preview.md) / [GIF demo](docs/gif-demo.md) / [Build it yourself](#build-it-yourself)

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
| `run_all.mjs` / `run_all.bat` | All-in-one launcher: download → convert → view in one command |
| `docs/send-to.md` | How to register run_all.bat in the Windows "Send to" menu |
| `urls.txt` | URL list for batch downloads (create your own) |
| `test_eh_download.mjs` | Integration test (fetch-mocked, run with `node test_eh_download.mjs`) |
| `image_viewer.mjs` | Browser-based image viewer |
| `viewer.bat` | Windows launcher for the viewer (double-click for interactive mode) |
| `build_exe.mjs` / `build.bat` | Single-exe build (Node.js SEA) |
| `verify_checksums.bat` | SHA-256 tamper check for downloaded exes (double-click to run) |
| `test_image_viewer.mjs` | Viewer integration test (run with `node test_image_viewer.mjs`) |

## Using the bat launchers on Windows

- **`run_all.bat`** … **recommended**. Enter a URL and it downloads → converts → views in one go. **Drag & drop or "Send to" a folder onto it to run convert → view only** (see the [Send-to menu guide](docs/send-to.md))
- **`download.bat`** … double-click and enter a URL. A list file path (like `urls.txt`) also works. From a terminal, arguments work too: `download.bat <URL> --parallel 3`
- **`convert.bat`** … double-click and answer the folder and format (PNG/JPEG). Installs `sharp` on first use. Also accepts arguments: `convert.bat <folder> --format jpeg`
- **`viewer.bat`** … double-click and enter a folder (empty Enter = current directory). Also accepts arguments: `viewer.bat <folder> --recursive`

> Note: the bat files use ASCII characters only because cmd.exe parses them with the ANSI code page (Japanese messages are printed by node).

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

If one gallery fails (dead link, deleted, etc.), the rest continue and a summary is printed at the end. Failed URLs — including galleries where only some images failed — are written to `failed_urls.txt`, so re-running with `node eh_download.mjs --list failed_urls.txt` fetches only the missing images (resume).

> Note: Permanent errors such as 404/410 (dead or deleted URLs) fail immediately without retries. Only 5xx and network errors are retried automatically.

### Options

| Option | Description |
|---|---|
| `--parallel N` (`-j N`) | Concurrent connections (default: 2, recommended 2–3) |
| `--timeout SEC` | Request timeout in seconds (defaults: 45 s for pages / 120 s for images) |
| `--retries N` | Max attempts on failure (defaults: 5 for pages / 4 for images; `1` disables retries. Permanent errors like 404 always fail immediately) |
| `--original` | Try original quality (**requires login cookies**; falls back to normal quality on failure) |
| `--cookie "..."` | Cookie string (required for `exhentai.org` and `--original`). Also via the `EH_COOKIE` env var |
| `--list <file>` | Batch process a URL list file (cannot be combined with direct URLs — exits with an error) |
| `--delay SEC` | Delay between requests (default: 1.2) |
| `--convert F` | Automatically convert each completed gallery to `png` / `jpeg` |
| `--quality N` | JPEG quality for `--convert jpeg`, 1–100 (default: 90) |
| `--del` | Delete source WebP files after successful `--convert` |
| `--no-metadata` | Disable writing gallery `metadata.json` |
| `--help` | Show help |

### Key behaviors

- **Resume**: re-running skips already-downloaded files; progress is tracked in each folder's `index.json`
- **509 handling**: the request interval is shared across all connections, so the request rate stays the same as sequential. When a 509/bandwidth limit is detected, all connections pause and retry automatically
- **Output**: `<gallery ID>_<title>/01.webp, 02.webp, ...` (sequential file names)
- **Metadata**: writes `metadata.json` by default with category, posted date, rating, and artist/character/series/language/category tags; disable with `--no-metadata`

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

### Convert options

| Option | Description |
|---|---|
| `--format F` | Output format: `png` / `jpeg` (`jpg` accepted). Default: `png` |
| `--quality N` | JPEG quality 1–100 (default: 90; ignored for PNG) |
| `--out DIR` | Output directory (default: `<input DIR>/png` or `<input DIR>/jpeg`) |
| `--parallel N` | Concurrent conversions (default: CPU cores, max 4) |
| `--force` | Re-convert files that already have output |
| `--del` | Delete the source WebP after successful conversion (⚠ unrecoverable) |
| `--help` | Show help |

### Convert notes

- **PNG is lossless, so files get much larger** (measured: ~13× WebP). For size, prefer `--format jpeg --quality 90` (measured: ~1.9×)
- Existing valid outputs are skipped, so re-running is safe

---

## 3. Viewer: `image_viewer.mjs`

A browser-based image viewer for the downloaded folders (**zero extra installs** — Node.js built-in modules only).

```bash
node image_viewer.mjs <folder> [options]

# Examples
node image_viewer.mjs "3553112_gallery title"
node image_viewer.mjs ./pics --recursive          # include subfolders
node image_viewer.mjs ./pics --port 9000          # custom port
```

### Viewer options

| Option | Description |
|---|---|
| `--port N` (`-p N`) | Port (default: 8420; picks the next free port automatically if busy) |
| `--recursive` (`-r`) | Include images in subfolders |
| `--no-open` | Do not open the browser automatically |
| `--no-thumbs` | Disable thumbnail generation (serve original images) |
| `--thumb-size N` | Thumbnail long-edge size (default: 400, 16–2048) |
| `--window-size WxH` | Windows only: initial app-mode window size (e.g. `1280x860`; default 1280×860) |
| `--help` (`-h`) | Show help |

### Features

- Formats: WebP / PNG / JPEG / GIF / BMP / AVIF / SVG (rendered by the browser)
- **Fast thumbnails** (optional): when `sharp` is installed, the grid renders pre-generated thumbnails cached in `.thumbcache/` — smooth even for huge folders
  - Without `sharp` the viewer still works (thumbnails fall back to the original images)
  - Cache keys are derived from source path + mtime + size, so replacing an image regenerates its thumbnail automatically (no manual clearing)
  - Cache entries older than 72 hours are purged on startup
- Thumbnail grid with natural sort (`01, 02, …, 10` — same order as Explorer)
- **Tag search** (`🔍 Search` button / `/` key) — search downloaded collections across `metadata.json` tags (artist / character / series / language) saved at download time
  - Click a tag in the tag cloud to filter, and combine with free-text (title substring) via AND search
  - Jump straight to a gallery from the results
- Zoom (`Ctrl`+wheel / `-` `+` `0`), rotate (`r`), drag to pan, fit ⇄ 100% (double-click)
- Slideshow (`s`, 4s interval, looping) / fullscreen (`f`)
- Jump to the previous / next sibling folder (`PageUp` / `PageDown`) — handy for browsing downloaded galleries one after another
- The 📂 button reveals the current image in Explorer
- Security: the server binds to `127.0.0.1` only and rejects paths outside the target folder

### Viewer notes

- Rendering happens in a browser view. On Windows the viewer opens as a **standalone app-mode window without an address bar** (via Microsoft Edge; falls back to your default browser if Edge is unavailable)
  - Window title: `Image Viewer`
  - Initial window size: 1280×860 (changeable via `--window-size WxH`; resizable / maximizable like any regular app)
- Quit via the "✕ Quit" button in the top-right, or `Ctrl+C` on the server

---

## 4. Single-exe build: `build_exe.mjs`

### Download from Releases (no build needed)

> ⬇ After downloading, run the [tamper check (SHA-256)](#tamper-check-sha-256).

Pushing a `v*` tag makes GitHub Actions build binaries for all three OSes and attach them to a Release:

| Asset | Target |
|---|---|
| `eh-viewer-windows-x64.exe` | Windows 10/11 (x64) — just double-click |
| `eh-viewer-linux-x64` (+ `.tar.gz`) | Linux (x64) — `chmod +x` first |
| `eh-viewer-macos-arm64` (+ `.tar.gz`) | macOS (Apple Silicon) — see quarantine note |
| `eh-runall-windows-x64.exe` | Windows 10/11 (x64) — all-in-one (below) |
| `eh-runall-linux-x64` (+ `.tar.gz`) | Linux (x64) — all-in-one |
| `eh-runall-macos-arm64` (+ `.tar.gz`) | macOS (Apple Silicon) — all-in-one |

**`eh-runall` is the run_all all-in-one build.** On top of the viewer it bundles the downloader and the WebP converter, so `eh-runall.exe <URL>` does download → convert → view in a single command (same options as `node run_all.mjs`; no Node.js required).

```bash
git tag v1.0.0 && git push origin v1.0.0   # -> Release is created automatically
```

> On macOS, if you see "cannot verify the developer", run `xattr -d com.apple.quarantine eh-viewer-macos-arm64` (the binary is unsigned).

### Tamper check (SHA-256)

> **If you just downloaded an exe, run this check first.** (step 2 of the [Quick start](#quick-start-first-time-here))

Each Release ships a `SHA256SUMS-<os>.txt` so you can verify the downloaded binaries have not been tampered with.

**Windows (easy):** put `verify_checksums.bat` in the same folder as the exes and double-click it. Or with PowerShell:

```powershell
# place the exe and SHA256SUMS-windows.txt in the same folder
Get-FileHash .\eh-runall-windows-x64.exe -Algorithm SHA256
# compare with the expected value, or feed a .sha256 sidecar to verify_checksums.ps1
```

**Windows (built-in tools only):**

```bat
certutil -hashfile eh-runall-windows-x64.exe SHA256
```

**Linux / macOS:**

```bash
sha256sum -c SHA256SUMS-linux.txt        # OK means it matches
shasum -a 256 -c SHA256SUMS-macos.txt  # macOS
```

If a checksum does not match, the file may be corrupted or tampered with — **delete it and re-download**. For local builds, `node build_exe.mjs` prints the SHA-256 and writes an `<exe name>.sha256` sidecar next to the binary.

### Build it yourself

Build the viewer into a **single exe that needs no Node.js** on the target machine (Node.js SEA; requires Node.js 20+ to build).

```bash
npm install                 # installs esbuild / postject / sharp
node build_exe.mjs          # -> dist/eh-viewer.exe (viewer only)
node build_exe.mjs --runall # -> dist/eh-runall.exe (run_all all-in-one)
# or double-click build.bat on Windows
```

### Build options

| Option | Description |
|---|---|
| `--out DIR` | Output directory (default: `dist/`) |
| `--name NAME` | Output file name (default: `eh-viewer`, or `eh-runall` with `--runall`) |
| `--runall` | Build the run_all all-in-one exe (download → convert → view in one file; usage: `eh-runall.exe <URL>`) |
| `--version vX.Y.Z` | Embed a version into the exe (shown by `eh-viewer --version`; default: package.json version) |
| `--no-sharp` | Build without thumbnails (exe gets ~15 MB smaller) |
| `--keep` | Keep intermediate build files (for debugging) |

### How it works

- The current Node runtime (node.exe) is used as the base; the esbuild-bundled viewer plus the whole sharp package are injected as a SEA blob
- The produced exe starts by double-click and **needs no Node.js on the target PC**
- sharp is extracted to `%TEMP%\eh-viewer-assets-<hash>\` on first launch and reused afterwards (to uninstall, just delete that Temp folder; stale extraction dirs unused for 72 h are cleaned automatically)
- Usage is identical to `node image_viewer.mjs` (`eh-viewer.exe <folder> --recursive`, etc.)
- **Windows builds embed an icon and version resource** (via rcedit: the icon shows in Explorer and the file Properties lists product name & version). Regenerate the icons with `node assets/make_icons.mjs`

> Note: the exe targets the same OS/arch as the build machine (build on Windows → Windows exe), because it wraps the current node.exe. The GitHub Actions release workflow (`.github/workflows/release.yml`) builds all three OSes automatically.

---

## Typical workflow

### One command for everything (all-in-one launcher)

```bash
# Download -> PNG conversion -> open in browser, all automatic
node run_all.mjs https://e-hentai.org/g/3553112/f4c015ef04/

# Convert to JPEG and delete the source WebP
node run_all.mjs urls.txt --format jpeg --del

# Convert + view an already-downloaded folder (skips downloading)
node run_all.mjs --from "3553112_gallery title" --format jpeg

# Just reopen the viewer on a converted folder
node run_all.mjs --open-only "3553112_gallery title"

# Passing a folder directly also works (same as drag & drop / "Send to")
node run_all.mjs "3553112_gallery title"

# The single exe works the same (no Node.js needed; from Releases or built with --runall)
eh-runall.exe https://e-hentai.org/g/3553112/f4c015ef04/
eh-runall.exe --open-only "3553112_gallery title"

# On Windows, double-click run_all.bat (asks URL -> format)
```

> **Tip:** register `run_all.bat` in Windows' "Send to" menu and converting + viewing a downloaded folder becomes right-click → Send to → run_all. See the [Send-to menu guide](docs/send-to.md).

### run_all options

| Option | Description |
|---|---|
| `--out DIR` | Base directory (default: current directory) |
| `--from DIR\|FILE` | Convert only, from a downloaded folder / a folder list file |
| `--format F` / `--quality N` | Conversion format and quality (same as `convert_images.mjs`) |
| `--del` | Delete source WebP after successful conversion |
| `--force` | Re-convert already-converted images |
| `--no-convert` | Download only, no conversion |
| `--no-view` | Do not start the viewer |
| `--open-only` | Start the viewer only (no download/convert) |
| `--port N` / `--recursive` / `--no-open` / `--window-size WxH` | Passed to the viewer |
| `--no-color` | Disable colored progress (automatic on non-TTY / with `NO_COLOR`) |
| `--verbose` | Stream the child scripts' full output (default condenses it into one-line progress) |
| `--no-update-check` | Disable the startup update check (no GitHub API call; useful offline) |
| `-- <args>` | Anything after `--` goes to `eh_download.mjs` verbatim (`--parallel 3`, etc.) |

If some downloads fail, conversion and viewing still proceed and the exit code is `2`.

### Progress display

Progress is condensed into colored one-line entries per gallery/folder (`✔` ok / `△` partial / `✖` failed), ending with a failure summary and a ready-to-paste retry command:

```text
[1/3] Download
✔ https://e-hentai.org/g/3553112/...   new 20, skipped 0
△ https://e-hentai.org/g/9999999/...   new 5, skipped 0, failed 3

⚠ Failed galleries: 1
  △ https://e-hentai.org/g/9999999/...
     new 5 / skipped 0 / failed 3 (re-run fetches only the failures)
  → retry: node eh_download.mjs --list "...failed_urls.txt"

[2/3] Convert (2 folders → PNG)
✔ 3553112_gallery title   converted 20, skipped 0 (2.1MB→18MB, 857%)

■ All phases complete   DL 2/2 galleries OK / convert 2/2 folders
```

Use `--verbose` to see the full child output instead.

### Running each script individually

```bash
# Download and convert to JPEG in one command
node eh_download.mjs urls.txt --parallel 3 --convert jpeg --quality 90

# Delete source WebP only after successful conversion
node eh_download.mjs urls.txt --parallel 3 --convert jpeg --quality 90 --del

# The original two-step workflow is still supported
node eh_download.mjs urls.txt --parallel 3
node convert_images.mjs "3553112_gallery title" --format jpeg --quality 90
```

> `--del` is accepted only together with `--convert`; only successfully converted WebP files are deleted.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `2` | Partial failure (`failed_urls.txt` / retry with a re-run) |
| `1` | Fatal error (invalid URL, missing args, etc.) |

## Roadmap

Candidate features for upcoming releases (unordered, no guarantees). Open an
Issue / PR if you are interested in any of them.

Shipped in v1.3.0: docs-consistency checker wired into CI, JA/EN doc alignment,
and this public roadmap itself.

### Convenience

- [x] **Gallery search / tag browsing** — tag search implemented in the viewer (`🔍 Search` / `/` key; tag cloud + free-text AND search)
- [ ] **Search extensions** — filter by date range / rating, sort search results
- [ ] **Incremental re-sync** — when new pages are added to a gallery, download only the additions into the existing folder
- [ ] **Smoother exhentai setup** — interactive cookie configuration helper for `--cookie` / `EH_COOKIE`
- [ ] **Shared thumbnail cache** — manage `.thumbcache/` centrally so moving folders does not force regeneration
- [x] **Standalone viewer window** — on Windows the viewer opens as an address-bar-free app-mode window via Edge (v1.3.0); the initial size is configurable via `--window-size`

### Distribution & installation

- [ ] **Signed binaries** — sign release binaries with Sigstore (cosign) to offer signature verification in addition to SHA-256
- [ ] **Less macOS Gatekeeper friction** — signing / notarization to remove the `xattr` workaround
- [ ] **winget / Homebrew support** — install via package managers
- [x] **Update checker** — compares the running version against GitHub Releases and notifies about newer releases (no auto-download; disable with `--no-update-check`). Results are cached for 24 hours; failures are not cached so the next run retries
- [ ] **Update-notice caching / throttling** — cache check results and rate-limit queries (currently checks on every run)

### Stability & maintenance

- [ ] **More e2e tests** — boundary tests around 509 / network loss / resume using the mock server
- [x] **Configurable timeouts/retries** — `--timeout` / `--retries` options added (per-request, downloader)
- [x] **Docs checks in CI** — `check:docs` runs on every CI build (asset names / SHA-256 commands / CLI flags / relative links & anchors). Automatic tag verification right after releases is still pending
- [x] **Automated viewer quit-flow tests** — CI verifies the ✕ Quit button (`/api/quit`) exits cleanly without leaving a zombie process even when spawned detached

### Misc

- [ ] **Demo GIFs** — record demos #1–#4 from the [GIF demo proposal](docs/gif-demo.md)
- [ ] **Localization** — English viewer UI messages (console output is currently Japanese-centric)
- [x] **Docs index** — added [docs/index.md](docs/index.md) as a single entry point to all guides (v1.3.0)

## Disclaimer

Use at your own risk and in compliance with each site's terms of service and local laws. Excessive access can lead to IP bans, so keep `--parallel` at 2–3 and `--delay` at 1 second or more.

## License

[MIT License](LICENSE) — Copyright (c) 2026 neoenox
