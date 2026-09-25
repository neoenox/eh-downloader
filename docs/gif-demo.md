# README に GIF アニメーション (デモ) を追加する構成案

README に GIF を入れると「何が起こるのか」が一目で伝わり、初見ユーザーの導入ハードルが
大きく下がります。このドキュメントでは **どのデモを撮るか → どう録画するか → どう軽量化
するか → README のどこに置くか** を提案します。

---

## 1. 撮るべきデモ (優先順)

| # | デモ | 内容 | 想定尺 | 置き場所 (README) |
|---|---|---|---|---|
| 1 | **バッチダウンロード** | `download.bat` をダブルクリック → URL 貼り付け → 進捗ログ → 「■ 完了」 | 15–25秒 | 「Windows での簡単な使い方」直下 (日英両方) |
| 2 | **複数 URL 直接指定** | コマンドプロンプトで `node eh_download.mjs URL1 URL2` → 「▶ 2 ギャラリーを連続ダウンロードします」→ バッチサマリ | 10–20秒 | 「単一ギャラリー / 複数ギャラリーを直接指定」のコード例の下 |
| 3 | **レジューム** | ダウンロード途中で Ctrl+C → 再実行 → 「スキップ N 枚」表示で続きから再開 | 10–15秒 | 「主な動作 > レジューム」の箇条書きの下 |
| 4 | **WebP → JPEG 変換** | `convert.bat` → フォルダ指定 → 2 → 変換ログ → サイズ比較サマリ | 10–20秒 | 「2. 変換」見出しの直下 (日英両方) |

> 4 本もあると README が重くなるので、**まず #1 と #4 の 2 本**から始めるのがお勧めです。
> 残りは必要になってから追加します。

## 2. 録画方法 (Windows)

### 手軽さ重視: Xbox Game Bar (標準搭載)

1. `Win + G` → 録画ボタン (または `Win + Alt + R`)
2. コマンドプロンプト / Windows Terminal で対象コマンドを実行
3. 録画停止 → `動画 > キャプチャ` フォルダに mp4 保存

### クオリティ重視: OBS Studio (無料)

- 出力解像度を **1280×720** に固定 (README 埋め込みに最適)
- コマンドプロンプトのフォントを **14–16pt の等幅** にして撮ると可読性が高い
- 「ソース > ウィンドウキャプチャ」でターミナルだけを撮る (デスクトップ全体は不要)

### ターミナル側の準備 (見栄えアップ)

```bat
rem 背景を黒に / ウィンドウをリサイズして余白を減らす
color 0a
mode con: cols=110 lines=35
```

- 事前に `urls.txt` を用意しておき、タイピング時間を短縮
- 509 対策の `--delay 1.2` で進捗が遅く見えないよう、**少数枚のギャラリー**で撮る

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
| サイズ目安 | **3 MB 以下/本** | GitHub の描画が重くならない |

さらに軽くしたい場合:
- [gifsicle](https://eternallybored.org/misc/gifsicle/) で `gifsicle -O3 --lossy=80 -o out.gif in.gif`
- または **mp4 のまま** GitHub に貼る (GitHub は `<video>` タグを自動再生してくれる)。GIF より 5–10 倍軽い

## 4. リポジトリ配置

```
docs/
  demo-download.gif   ← #1 バッチダウンロード
  demo-resume.gif     ← #3 レジューム
  demo-convert.gif    ← #4 変換
  social-preview.md   (既存)
assets/               ← 素材の mp4 (任意・リリースノート用)
```

GIF は `docs/` に相対パスで参照します (外部ホスティング不要・リポジトリ完結):

```markdown
![バッチダウンロードのデモ](docs/demo-download.gif)
```

## 5. README への埋め込み位置 (差し込みイメージ)

### 日本語セクション

```markdown
## Windows での簡単な使い方（bat ファイル）

![download.bat でギャラリーを一括ダウンロードするデモ](docs/demo-download.gif)
*download.bat の対話モード。URL を貼るだけで一括ダウンロード*

...(既存の箇条書き)
```

```markdown
## 2. 変換: `convert_images.mjs`

![WebP を JPEG に一括変換するデモ](docs/demo-convert.gif)
*convert_images.mjs で WebP → JPEG (品質 90) 変換*

ダウンロードした WebP を PNG/JPEG に一括変換します。
```

### 英語セクション

```markdown
## 1. Download: `eh_download.mjs`

![Batch download demo](docs/demo-download.gif)
*Interactive download.bat — paste a URL and watch the batch progress*

...
```

> 同じ GIF を日英両方で参照するとリポジトリ容量を節約できます
> (画像は 1 つで、キャプションだけ訳し分け)。

## 6. チェックリスト

- [ ] 録画前にターミナルをリサイズ・フォント拡大 (`mode con: cols=110 lines=35`)
- [ ] 進捗が見える少数枚のギャラリーで撮る (遅延演出は不要)
- [ ] 個人情報 (cookie・ユーザー名) が画面に映っていないか確認
- [ ] fps=12 / 幅 800px で GIF 化し 3 MB 以下
- [ ] README 日英両方にキャプション付きで埋め込み
- [ ] モバイル表示 (幅 375px 相当) でも読めるか確認

---

# README GIF demo proposal (English)

GIFs in the README show *what actually happens* and lower the barrier for
first-time users. This document proposes **which demos to record → how to
record → how to optimize → where to embed**.

## Recommended demos (in priority order)

| # | Demo | Content | Length | Placement |
|---|---|---|---|---|
| 1 | **Batch download** | double-click `download.bat` → paste URL → progress log → done | 15–25s | Under "Windows launcher" (both languages) |
| 2 | **Multiple URLs** | `node eh_download.mjs URL1 URL2` → batch summary | 10–20s | Below the multi-URL code example |
| 3 | **Resume** | Ctrl+C mid-download → re-run → "skipped N" | 10–15s | Under "Resume" bullet |
| 4 | **WebP → JPEG** | `convert.bat` → folder → 2 → conversion log + size summary | 10–20s | Under "2. Convert" (both languages) |

Start with **#1 and #4**; add the rest only if needed.

## Recording on Windows

- **Quick**: Xbox Game Bar (`Win + Alt + R`), mp4 saved to `Videos > Captures`
- **Polished**: OBS Studio at 1280×720, capture only the terminal window,
  use a 14–16pt monospace font
- Prepare `urls.txt` in advance and record a small gallery so progress is visible

## Optimize

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif
```

- fps **12**, width **800px**, target **< 3 MB** per GIF
- Or embed **mp4 directly** — GitHub autoplays `<video>` tags and they are 5–10×
  smaller than GIF

## Placement in the repo

```
docs/demo-download.gif, docs/demo-resume.gif, docs/demo-convert.gif
```

Reference with relative paths (no external hosting):

```markdown
![Batch download demo](docs/demo-download.gif)
```

Reuse the same GIF in both language sections, translating only the captions.
