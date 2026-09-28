# README に GIF アニメーション (デモ) を追加する構成案

README に GIF を入れると「何が起こるのか」が一目で伝わり、初見ユーザーの導入ハードルが
大きく下がります。このドキュメントでは **どのデモを撮るか → どう録画するか → どう軽量化
するか → README のどこに置くか** を提案します。

**前提 — README は現在「クイックスタート 方法 A: 単一 exe」が主役です**:
`eh-runall.exe` 1 つでダウンロード → 変換 → 閲覧まで完結し、改ざん検証 (SHA-256) が
ステップ 2 として必須化されています。デモもこの流れに合わせて撮ります。

---

## 1. 撮るべきデモ (優先順)

| # | デモ | 内容 | 想定尺 | 置き場所 (README) |
|---|---|---|---|---|
| 1 | **単一 exe クイックスタート** | `eh-runall.exe` をダブルクリック → 改ざん検証 (`verify_checksums.bat` で「OK」と表示) → URL 貼り付け → DL → 変換 → ブラウザで閲覧 | 25–40秒 | 「クイックスタート 方法 A」直下 (日英両方) |
| 2 | **1 コマンド run_all** | `eh-runall.exe <URL>` で一気に完了する様子 → 「■ 完了」→ ブラウザでサムネイル一覧 | 15–25秒 | 「1 コマンドで全部」の行の下 |
| 3 | **D&D / 送るメニュー** | エクスプローラーで `urls.txt` を exe にドラッグ＆ドロップ → 対話モード起動 | 10–15秒 | [「送る」メニュー登録ガイド](send-to.md) の冒頭 |
| 4 | **WebP → JPEG 変換** | `eh-viewer.exe` または方法 B の `convert.bat` → フォルダ指定 → 2 → 変換ログ → サイズ比較サマリ | 10–20秒 | 「2. 変換」見出しの直下 (日英両方) |

> 4 本もあると README が重くなるので、**まず #1 と #2 の 2 本**から始めるのがお勧めです。
> #1 は「検証 → 実行」まで一連の流れを見せる事実上のメインデモになります。
> 残りは必要になってから追加します。

### #1 単一 exe クイックスタートの台本 (撮影シナリオ)

README のクイックスタート (方法 A) と同じ順序で撮ると、GIF を見た人がそのまま
同じ操作を再現できます:

1. **Releases からダウンロード** — ブラウザで `eh-runall-windows-x64.exe` +
   `SHA256SUMS-windows-x64.txt` をダウンロードした画面を一瞬見せる (タイムラプス可)
2. **改ざん検証** — `verify_checksums.bat` をダブルクリック → PowerShell ウィンドウに
   `OK` (全ファイル一致) と表示されるところを止めて見せる
3. **実行** — `eh-runall.exe` をダブルクリック → アイコン (青い DL バッジ付き) が見える
   ように撮る。URL を貼り付け → Enter
4. **自動実行** — 「▶ ダウンロード」→「▶ 変換」→「▶ 閲覧」のログが流れ、最後に
   ブラウザでサムネイル一覧が開くところまで

> ポイント: ステップ 2 の「OK」表示は 1.5–2 秒ほど長めに見せること。
> 「検証してから使う」習慣をそのまま真似できるのがこのデモの価値です。

## 2. 録画方法 (Windows)

### 手軽さ重視: Xbox Game Bar (標準搭載)

1. `Win + G` → 録画ボタン (または `Win + Alt + R`)
2. コマンドプロンプト / Windows Terminal / エクスプローラーで対象操作を実行
3. 録画停止 → `動画 > キャプチャ` フォルダに mp4 保存

### クオリティ重視: OBS Studio (無料)

- 出力解像度を **1280×720** に固定 (README 埋め込みに最適)
- コマンドプロンプトのフォントを **14–16pt の等幅** にして撮ると可読性が高い
- 「ソース > ウィンドウキャプチャ」でターミナルだけを撮る (デスクトップ全体は不要)
- #1 のブラウザ部分だけは「ウィンドウキャプチャ」でブラウザに切り替えるか、
  ディスプレイキャプチャで通し撮りする

### ターミナル側の準備 (見栄えアップ)

```bat
rem 背景を黒に / ウィンドウをリサイズして余白を減らす
color 0a
mode con: cols=110 lines=35
```

- 事前に URL をクリップボードに貼っておき、タイピング時間を短縮
- 509 対策の `--delay 1.2` で進捗が遅く見えないよう、**少数枚のギャラリー**で撮る
- `eh-runall.exe` にはアイコンとバージョンリソース (FileVersion 1.2.1 / 説明
  「E-Hentai All-in-One (DL / Convert / View)」) が埋め込まれています。
  タスクバーやエクスプローラーに映るアイコンもそのままデモになります

## 3. mp4 → GIF 変換と軽量化

GIF は重い (数 MB になりがち) ので、必ず最適化します。

```bash
# ffmpeg で mp4 → GIF (パレット 2 段階で画質維持)
ffmpeg -i demo.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif
```

| 設定 | 推奨値 | 理由 |
|---|---|---|
| fps | **12** | ターミナルテキストなら十分滑らか |
| 幅 | **800px** | GitHub の本文幅に収まる |
| サイズ目安 | **3 MB 以下/本** | GitHub の描画が重くならない (#1 は長いので 4 MB まで許容) |

さらに軽くしたい場合:
- [gifsicle](https://eternallybored.org/misc/gifsicle/) で `gifsicle -O3 --lossy=80 -o out.gif in.gif`
- または **mp4 のまま** GitHub に貼る (GitHub は `<video>` タグを自動再生してくれる)。GIF より 5–10 倍軽い
- リポジトリには [sharp](https://www.npmjs.com/package/sharp) が入っているので、
  `node -e "import('sharp').then(s=>s.default('demo.mp4',{fps:12}).gif().toFile('demo.gif'))"`
  のような形でも変換できます (品質調整は ffmpeg の方が細かくできます)

## 4. リポジトリ配置

```
docs/
  demo-quickstart.gif   ← #1 単一 exe クイックスタート (メイン)
  demo-runall.gif       ← #2 1 コマンド run_all
  demo-sendto.gif       ← #3 D&D / 送るメニュー
  demo-convert.gif      ← #4 変換
  social-preview.md     (既存)
assets/                 ← 素材の mp4 (任意・リリースノート用)
```

GIF は `docs/` に相対パスで参照します (外部ホスティング不要・リポジトリ完結):

```markdown
![クイックスタートのデモ](docs/demo-quickstart.gif)
```

## 5. README への埋め込み位置 (差し込みイメージ)

### 日本語セクション

```markdown
**方法 A: 単一 exe を使う (おすすめ・インストール不要)**

![クイックスタートのデモ](docs/demo-quickstart.gif)
*`eh-runall.exe` をダウンロード → 改ざん検証 → ダブルクリックで DL→変換→閲覧*

...(クイックスタートの箇条書き)
```

```markdown
**1 コマンドで全部:** `run_all.bat <URL>` でダウンロード → 変換 → 閲覧まで自動実行されます。

![1 コマンド run_all のデモ](docs/demo-runall.gif)
*`eh-runall.exe <URL>` 1 コマンドで DL→変換→閲覧 (Node.js 不要)*
```

```markdown
## 2. 変換: `convert_images.mjs`

![WebP を JPEG に一括変換するデモ](docs/demo-convert.gif)
*convert_images.mjs で WebP → JPEG (品質 90) 変換*

ダウンロードした WebP を PNG/JPEG に一括変換します。
```

### 英語セクション

```markdown
**Option A: use the single exe (recommended — nothing to install)**

![Quick start demo](docs/demo-quickstart.gif)
*Download → verify checksum → double-click: DL, convert & view in one go*

...
```

> 同じ GIF を日英両方で参照するとリポジトリ容量を節約できます
> (画像は 1 つで、キャプションだけ訳し分け)。

## 6. チェックリスト

- [ ] 録画前にターミナルをリサイズ・フォント拡大 (`mode con: cols=110 lines=35`)
- [ ] #1 は「検証 OK → 実行 → ブラウザで閲覧」の順序を守る (README と同じ流れ)
- [ ] exe のアイコン (青い DL バッジ) と FileVersion が画面に映っているとベター
- [ ] 進捗が見える少数枚のギャラリーで撮る (遅延演出は不要)
- [ ] 個人情報 (cookie・ユーザー名・ダウンロード先のフルパス) が画面に映っていないか確認
- [ ] fps=12 / 幅 800px で GIF 化し 3 MB 以下 (#1 は 4 MB 以下)
- [ ] README 日英両方にキャプション付きで埋め込み
- [ ] モバイル表示 (幅 375px 相当) でも読めるか確認

---

# README GIF demo proposal (English)

GIFs in the README show *what actually happens* and lower the barrier for
first-time users. This document proposes **which demos to record → how to
record → how to optimize → where to embed**.

The README's quick start now leads with **Option A: the single exe**
(`eh-runall.exe` — download, convert & view in one binary, with the mandatory
SHA-256 tamper check as step 2). Record the demos to match that flow.

## Recommended demos (in priority order)

| # | Demo | Content | Length | Placement |
|---|---|---|---|---|
| 1 | **Single-exe quick start** | double-click `eh-runall.exe` → checksum verify (`verify_checksums.bat` showing "OK") → paste URL → DL → convert → viewer | 25–40s | Under "Quick start, Option A" (both languages) |
| 2 | **One-command run_all** | `eh-runall.exe <URL>` finishing in one go → browser thumbnail grid | 15–25s | Below the "One command for everything" line |
| 3 | **D&D / Send-to** | drag & drop `urls.txt` onto the exe in Explorer → interactive mode | 10–15s | Top of the [Send-to menu guide](send-to.md) |
| 4 | **WebP → JPEG** | `eh-viewer.exe` or Option B `convert.bat` → folder → 2 → conversion log + size summary | 10–20s | Under "2. Convert" (both languages) |

Start with **#1 and #2**; add the rest only if needed. Demo #1 is the flagship:
it shows the exact verify-then-run sequence from the quick start.

## Demo #1 script (quick start scenario)

1. **Download from Releases** — briefly show the browser downloading
   `eh-runall-windows-x64.exe` + `SHA256SUMS-windows-x64.txt`
2. **Tamper check** — double-click `verify_checksums.bat` → show the PowerShell
   `OK` result for a second or two
3. **Run** — double-click `eh-runall.exe` (make the blue download-badge icon
   visible), paste the URL, press Enter
4. **Automatic flow** — "download → convert → view" logs scroll by, ending with
   the thumbnail grid opening in the browser

## Recording on Windows

- **Quick**: Xbox Game Bar (`Win + Alt + R`), mp4 saved to `Videos > Captures`
- **Polished**: OBS Studio at 1280×720, capture only the terminal window,
  use a 14–16pt monospace font
- Prepare the URL in the clipboard in advance and record a small gallery so
  progress is visible
- The exe ships with an embedded icon and version resource (FileVersion 1.2.1,
  "E-Hentai All-in-One (DL / Convert / View)") — let it show in the taskbar

## Optimize

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif
```

- fps **12**, width **800px**, target **< 3 MB** per GIF (up to 4 MB for #1)
- Or embed **mp4 directly** — GitHub autoplays `<video>` tags and they are 5–10×
  smaller than GIF

## Placement in the repo

```
docs/demo-quickstart.gif, docs/demo-runall.gif, docs/demo-sendto.gif, docs/demo-convert.gif
```

Reference with relative paths (no external hosting):

```markdown
![Quick start demo](docs/demo-quickstart.gif)
```

Reuse the same GIF in both language sections, translating only the captions.
