# 📖 ドキュメント一覧

このリポジトリの `docs/` にあるガイドの目次です。まずは [README](../README.md) のクイックスタートから始めて、目的に応じて各ガイドを参照してください。

## ガイド一覧

| ドキュメント | 内容 | 読むべき人 |
|---|---|---|
| [「送る」メニュー / D&D ガイド](send-to.md) | フォルダのドラッグ&ドロップ、Windows「送る」メニューへの登録、「JPEG 変換 + 元 WebP 削除」ショートカットの作り方 | ダウンロード済みフォルダをまとめて変換・閲覧したい方 |
| [Social preview 設定ガイド](social-preview.md) | GitHub リポジトリの OGP (サムネイル) 画像の設定手順と、「単一 exe で完結・Node.js 不要」を訴求する画像レイアウト案 | リポジトリの見栄えを整えたい管理者・コントリビューター |
| [GIF デモ構成案](gif-demo.md) | README に載せるデモ GIF の撮影台本 (クイックスタート再現フロー)、録画方法、軽量化、埋め込み位置 | デモ GIF を録って README を強化したいコントリビューター |

## README の関連セクション

ガイド以外でよく参照される README のセクション:

- [クイックスタート (初めての方はこちら)](../README.md#クイックスタート-初めての方はこちら) — 単一 exe / Node.js スクリプトの 2 つの始め方
- [改ざん検証 (SHA-256)](../README.md#改ざん検証-sha-256) — exe ダウンロード後の必須チェック
- [自分でビルド](../README.md#自分でビルド-1) — `node build_exe.mjs` で単一 exe を作る方法

## よく使うリンク

- [Releases (最新版ダウンロード)](https://github.com/neoenox/eh-downloader/releases/latest)
- [Issues](https://github.com/neoenox/eh-downloader/issues)
- [CI (GitHub Actions)](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml)

## 新しいドキュメントを追加するとき

1. `docs/<新しいガイド>.md` を作成する (既存のガイドと同様、日本語セクションの後に英語セクションを続ける形式)
2. このページの「ガイド一覧」表に 1 行追加する
3. README の日英両方からリンクを張る (冒頭のナビゲーション行またはクイックスタート付近)

---

# 📖 Documentation index

This is the table of contents for the guides in `docs/`. Start with the
[README quick start](../README.md#quick-start-first-time-here), then consult the
guides below as needed.

## Guides

| Document | Content | For whom |
|---|---|---|
| [Send-to menu / drag & drop guide](send-to.md) | Drag & drop, registering the Windows "Send to" menu, creating a "convert to JPEG + delete WebP" shortcut | Anyone who wants to convert & view downloaded folders in bulk |
| [Social preview guide](social-preview.md) | How to set the repository OGP (thumbnail) image, and a layout sketch promoting "single exe, no Node.js required" | Maintainers / contributors polishing the repository's look |
| [GIF demo proposal](gif-demo.md) | Demo GIF scripts (replaying the quick-start flow), recording tips, optimization, embed placement | Contributors adding demo GIFs to the README |

## Related README sections

- [Quick start (first time here?)](../README.md#quick-start-first-time-here)
- [Tamper check (SHA-256)](../README.md#tamper-check-sha-256) — required after downloading an exe
- [Build it yourself](../README.md#build-it-yourself) — build a single exe with `node build_exe.mjs`

## Useful links

- [Releases (latest downloads)](https://github.com/neoenox/eh-downloader/releases/latest)
- [Issues](https://github.com/neoenox/eh-downloader/issues)
- [CI (GitHub Actions)](https://github.com/neoenox/eh-downloader/actions/workflows/ci.yml)

## Adding a new document

1. Create `docs/<new-guide>.md` (follow the existing format: Japanese section followed by an English section)
2. Add a row to the "Guides" table above
3. Link it from the README (navigation line at the top or near the quick start) in both languages
