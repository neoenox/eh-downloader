# Changelog

このプロジェクトの主な変更をまとめたもの。詳細なリリースノートは各バージョンの
[Releases ページ](https://github.com/neoenox/eh-downloader/releases) を参照してください。

English summary follows the Japanese sections.

## [Unreleased]

- (次回リリース予定の変更はここに追記)

## [v1.4.0] — 2026-09-29: ビューワーにタグ検索を追加

### 追加

- **ビューワーにタグ検索**（`🔍 検索` ボタン / `/` キー）— `metadata.json` のタグ (artist / character / series / language) でダウンロード済みコレクションを横断検索
  - タグクラウド (件数付き) からの絞り込み / 自由語 AND 検索 / **投稿日範囲・最低評価でのフィルタ** に対応
  - 検索結果からギャラリーへ直接ジャンプ。検索インデックスは baseDir 単位でキャッシュ
- 更新チェック結果の 24 時間キャッシュ (API レート制限の節約。失敗はキャッシュせず次回再試行)
- 509 / ネットワーク断からの回復を検証する e2e 境界テストを CI に追加

## [v1.3.3] — 2026-09-29: 更新チェックのキャッシュ化と e2e 境界テストの拡充

### 改善

- 更新チェック結果を 24 時間キャッシュ (`%TEMP%\eh-update-check.json`)。キャッシュ中は GitHub API を叩かない
- e2e 境界テスト 3 ケース追加: 509 からの回復 / 509 での打ち切り＋`failed_urls.txt` 記録 / ネットワーク断からの回復

## [v1.3.2] — 2026-09-29: タイムアウト/リトライ設定化と自動更新チェッカー

### 追加

- **`--timeout 秒`** — リクエストのタイムアウト秒数 (デフォルト: ページ 45 / 画像 120)
- **`--retries N`** — 失敗時の最大試行回数 (デフォルト: ページ 5 / 画像 4。`1` で再試行なし)
- **自動更新チェッカー** — GitHub Releases と照合して新しいリリースを通知 (自動 DL なし)。`--no-update-check` で無効化

## [v1.3.1] — 2026-09-29: ウィンドウサイズ指定と終了フロー強化

### 追加

- **`--window-size WxH`** — Windows の Edge アプリモード起動時の初期ウィンドウサイズを指定 (デフォルト 1280×860)。`run_all` / exe からも指定可能

### テスト

- ✕終了 (`/api/quit`) の自動テスト追加: keep-alive 接続ありでも code 0 で終了、detached 起動でもゾンビプロセスを残さない

## [v1.3.0] — 2026-09-29: ビューワー起動の専用ウィンドウ化とドキュメント整備

### 改善

- Windows でビューワーが **Edge アプリモードの専用ウィンドウ** (アドレスバー無し) で開くように。既定ブラウザのタブを開かない (Edge 未導入時はフォールバック)

### ドキュメント / 開発

- **docs 整合性チェッカー** (`scripts/check_docs_consistency.mjs`) 新設 & CI 組み込み — アセット名 / SHA-256 コマンド / CLI フラグ / 相対リンク・アンカーを自動検証 (`npm run check:docs`)
- **docs/index.md** 新設、README ロードマップ追加、日英突き合わせ修正

## [v1.2.1] — 2026-09-28: アイコン・バージョンリソース埋め込みとクイックスタート整備

### 追加

- exe に**専用アイコン** (16–256px の 7 サイズ ICO) と**バージョンリソース** (FileDescription / FileVersion) を埋め込み
  - `node build_exe.mjs` が自動で埋め込み。アイコン再生成は `node assets/make_icons.mjs`
- README クイックスタート (方法 A: 単一 exe / 方法 B: Node.js スクリプト) を整理し、改ざん検証を必須ステップ化

## [v1.2.0] — 2026-09-28: 単一exeビルドと改ざん検証

### 追加

- **単一 exe 配布** (Node.js 不要):
  - **eh-runall** — 統合版: DL → 変換 → 閲覧を 1 コマンドで
  - **eh-viewer** — 閲覧専用
  - Windows / Linux / macOS (Apple Silicon) 向け。sharp 同梱でサムネイル生成も有効
- **改ざん検証** — `SHA256SUMS-<os>.txt` を同梱。Windows は `verify_checksums.bat` ダブルクリックで確認

## [v1.1.0] — 2026-09-25: 恒久的エラーの即失敗と部分失敗リトライの明確化

### 改善

- **404 / 403 / 410 / 401 はリトライせず即失敗** (#6) — 死 URL 1 件あたり約 30 秒の待機がなくなりました
- 部分失敗ギャラリーも `failed_urls.txt` に書き出され、`--list` 再実行で失敗分だけ再取得できる導線を明確化 (#7)

## [v1.0.1] — 2026-09-25: MIT ライセンス追加

- MIT ライセンス ([LICENSE](LICENSE)) を追加、README にバッジを追加

## [v1.0.0] — 2026-09-25: 初版リリース

### 機能

- **ダウンロード** (`eh_download.mjs`) — 単一/複数ギャラリー、`urls.txt` 一括処理、レジューム (`index.json`)、509 対策 (全接続共有レート制限＋自動再試行)、失敗 URL の `failed_urls.txt` 書き出し
- **変換** (`convert_images.mjs`) — WebP → PNG/JPEG 一括変換
- **ビューワー** (`image_viewer.mjs`) — サムネイル一覧 (sharp で高速化) / 自然順ソート / ズーム・回転・スライドショー / PageUp/PageDown でフォルダ巡回
- **統合ランチャー** (`run_all.mjs`) — DL → 変換 → 閲覧を 1 コマンドで

---

# Changelog (English)

Major changes of this project. See each release's notes on the
[Releases page](https://github.com/neoenox/eh-downloader/releases) for details.

## [Unreleased]

- (upcoming changes go here)

## [v1.4.0] — 2026-09-29: Tag search in the viewer

### Added

- **Tag search in the viewer** (`🔍 Search` button / `/` key) — search downloaded collections across `metadata.json` tags (artist / character / series / language)
  - Tag cloud with counts, free-text AND search, **upload date range & minimum rating filters**
  - Jump straight to a gallery from results; search index cached per base dir
- 24-hour cache for update-check results (saves API rate limit; failures are not cached and retried next run)
- e2e boundary tests in CI for 509 recovery and network-loss recovery

## [v1.3.3] — 2026-09-29: Update-check caching & e2e boundary tests

### Changed

- Update-check results cached for 24 hours (`%TEMP%\eh-update-check.json`); no GitHub API calls while cached
- 3 new e2e boundary tests: 509 recovery / 509 exhaustion recorded in `failed_urls.txt` / network-loss recovery

## [v1.3.2] — 2026-09-29: Configurable timeouts/retries & update checker

### Added

- **`--timeout SEC`** — request timeout (defaults: 45 s pages / 120 s images)
- **`--retries N`** — max attempts on failure (defaults: 5 pages / 4 images; `1` disables retries)
- **Update checker** — compares against GitHub Releases and notifies about newer releases (no auto-download); disable with `--no-update-check`

## [v1.3.1] — 2026-09-29: Window size option & quit-flow hardening

### Added

- **`--window-size WxH`** — initial app-mode window size on Windows (default 1280×860); available from `run_all` / exe

### Tests

- Automated tests for the ✕ Quit flow: exits with code 0 even with keep-alive connections open; no zombie process when spawned detached

## [v1.3.0] — 2026-09-29: Standalone viewer window & docs tooling

### Changed

- On Windows the viewer opens as a **standalone Edge app-mode window** (no address bar) instead of a browser tab (falls back without Edge)

### Docs / dev

- **Docs consistency checker** (`scripts/check_docs_consistency.mjs`) wired into CI — validates asset names / SHA-256 commands / CLI flags / relative links & anchors (`npm run check:docs`)
- Added **docs/index.md**, a public roadmap, and JA/EN alignment fixes

## [v1.2.1] — 2026-09-28: Icon & version resource embedding, quick start overhaul

### Added

- Embedded a **dedicated icon** (7-size ICO, 16–256px) and **version resource** (FileDescription / FileVersion) into the exes
  - `node build_exe.mjs` embeds them automatically; regenerate icons with `node assets/make_icons.mjs`
- Restructured the README quick start (Option A: single exe / Option B: Node.js scripts) and made checksum verification a required step

## [v1.2.0] — 2026-09-28: Single-exe builds & checksum verification

### Added

- **Single-exe distribution** (no Node.js required):
  - **eh-runall** — all-in-one: download → convert → view in one command
  - **eh-viewer** — viewer only
  - For Windows / Linux / macOS (Apple Silicon). sharp bundled, so thumbnails work out of the box
- **Checksum verification** — `SHA256SUMS-<os>.txt` included; on Windows double-click `verify_checksums.bat`

## [v1.1.0] — 2026-09-25: Fail fast on permanent errors, partial-failure retry clarity

### Changed

- **404 / 403 / 410 / 401 now fail immediately without retries** (#6) — removed ~30 s of waiting per dead URL
- Partially-failed galleries are also written to `failed_urls.txt`; re-running with `--list` re-fetches only the failures (#7)

## [v1.0.1] — 2026-09-25: MIT license

- Added the MIT license ([LICENSE](LICENSE)) and badges to the README

## [v1.0.0] — 2026-09-25: Initial release

### Features

- **Downloader** (`eh_download.mjs`) — single/multiple galleries, `urls.txt` batch, resume (`index.json`), 509 countermeasure (shared rate limit + auto retry), `failed_urls.txt`
- **Converter** (`convert_images.mjs`) — batch WebP → PNG/JPEG
- **Viewer** (`image_viewer.mjs`) — thumbnail grid (fast with sharp) / natural sort / zoom, rotate, slideshow / folder hopping with PageUp/PageDown
- **All-in-one launcher** (`run_all.mjs`) — download → convert → view in one command

[Unreleased]: https://github.com/neoenox/eh-downloader/compare/v1.4.0...HEAD
[v1.4.0]: https://github.com/neoenox/eh-downloader/compare/v1.3.3...v1.4.0
[v1.3.3]: https://github.com/neoenox/eh-downloader/compare/v1.3.2...v1.3.3
[v1.3.2]: https://github.com/neoenox/eh-downloader/compare/v1.3.1...v1.3.2
[v1.3.1]: https://github.com/neoenox/eh-downloader/compare/v1.3.0...v1.3.1
[v1.3.0]: https://github.com/neoenox/eh-downloader/compare/v1.2.1...v1.3.0
[v1.2.1]: https://github.com/neoenox/eh-downloader/compare/v1.2.0...v1.2.1
[v1.2.0]: https://github.com/neoenox/eh-downloader/compare/v1.1.0...v1.2.0
[v1.1.0]: https://github.com/neoenox/eh-downloader/compare/v1.0.1...v1.1.0
[v1.0.1]: https://github.com/neoenox/eh-downloader/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/neoenox/eh-downloader/releases/tag/v1.0.0
