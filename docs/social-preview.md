# リポジトリに Social Preview 画像 (OGP) を設定する方法

リポジトリの URL を X (Twitter) / Discord / Slack / LINE などに貼ったときに表示される
サムネイル画像 (OGP: Open Graph Protocol 画像) は、GitHub の **Social preview** 設定で
変更できます。デフォルトの自動生成画像 (リポジトリ名だけの素朴なもの) から、
オリジナルの画像に差し替えられます。

## 設定手順 (ブラウザ操作のみ・コード不要)

1. リポジトリのトップページを開く: <https://github.com/neoenox/eh-downloader>
2. 右上の **⚙ Settings** タブをクリック
   (リポジトリの Settings です。アカウント Settings ではないので注意)
3. 左サイドバーの **General** を開く (通常はデフォルトで選択済み)
4. ページ上部の **General** セクション内、リポジトリ名の右あたりにある
   **Social preview** の枠を探す
5. **Edit** ボタン (鉛筆アイコン) → **upload an image** から画像ファイルを選択
6. プレビューを確認して **Save** をクリック

以上で、URL 共有時のサムネイルが差し替わります。

## 画像の仕様

| 項目 | 推奨値 |
|---|---|
| サイズ | **1280 × 640 px** (2:1 比比率) |
| 形式 | PNG / JPG / GIF (1枚目のみ) |
| 容量 | 1 MB 未満推奨 |
| 文字入れ | 中央に大きく。左端と下端 10% はクロップされ得るので避ける |

## 画像の作り方 (3パターン)

### パターン A: GitHub 自動生成のまま使う (変更不要)

何もしなくても `リポジトリ名 + 言語構成比` の画像が自動生成されます。
まずはこれでも十分です。

### パターン B: テンプレートサービスで作る (5分・無料)

- [Socialify](https://socialify.git.fi/neoenox/eh-downloader/image?description=1&language=1&logo=1&name=1&owner=1&pattern=Diagonal%20Stripes&theme=Light)
  — GitHub リポジトリを自動でOGP化。設定後、画像をダウンロードしてアップロード
- [ shields.io バッジを組み合わせたバナー](https://shields.io/badges/static-badge) を
  画像エディタ (Figma / Canva / PowerPoint でも可) に並べて書き出す

### パターン C: オリジナル画像を用意する

`1280×640` のキャンバスに以下を配置するのがお勧めです:

- 中央: タイトル `E-Hentai Downloader` (大きめの太字)
- 下段: `WebP → PNG/JPEG 一括変換 / Node.js 18+`
- アクセント: CI バッジや MIT バッジを模した長方形を左下に置くと「CI で管理されている」
  印象が出る

## 設定の確認方法

1. <https://www.opengraph.xyz/url/https%3A%2F%2Fgithub.com%2Fneoenox%2Feh-downloader>
   などのOGPチェッカーで URL を入力する
2. または X / Discord に一旦リンクを貼ってプレビューを確認 (Discord は再読込で反映)

> 注意: GitHub は social preview を強くキャッシュします。差し替え後、
> SNS 側のキャッシュが残る場合は OGPチェッカーで再取得を促すか、
> 数時間待つと反映されます。

## リポジトリに画像をコミットする場合 (任意)

Social preview のアップロードはリポジトリ外の設定なので必須ではありませんが、
`docs/` などに素材を置いておくと再利用しやすくなります:

```
docs/
  social-preview.png   ← 1280x640 の OGP 素材
  social-preview.md    ← このファイル
```

---

# How to set a repository Social Preview image (OGP)

The thumbnail shown when your repository URL is shared on X (Twitter),
Discord, Slack, LINE, etc. can be changed in GitHub's **Social preview**
setting — no code required.

## Steps

1. Open <https://github.com/neoenox/eh-downloader>
2. Click the **⚙ Settings** tab (the repository's Settings, not your account's)
3. In the left sidebar, open **General** (selected by default)
4. In the **General** section, find the **Social preview** box next to the
   repository name
5. Click **Edit** (pencil icon) → **upload an image** and pick your file
6. Check the preview and click **Save**

## Recommended image spec

| Item | Recommended |
|---|---|
| Size | **1280 × 640 px** (2:1) |
| Format | PNG / JPG / GIF |
| File size | under 1 MB |
| Text | Large and centered; keep 10% margins from edges (may be cropped) |

## Verifying

Paste the URL into an OGP checker such as
<https://www.opengraph.xyz/url/https%3A%2F%2Fgithub.com%2Fneoenox%2Feh-downloader>,
or share it once on Discord / X. GitHub caches the preview aggressively —
allow a few hours for refreshes.
