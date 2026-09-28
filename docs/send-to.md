# 「送る」メニュー / ドラッグ&ドロップで run_all.bat を使う方法

フォルダを `run_all.bat` に投げ込むだけで、**WebP → PNG/JPEG 変換 → ビューワーで閲覧**まで自動で実行されます。このドキュメントでは Windows の「送る」メニューへの登録手順と、ドラッグ&ドロップの使い方を説明します。

> **仕組み**: `run_all.mjs` は URL が 1 つも渡されずにフォルダだけ渡された場合、自動で「変換 + 閲覧」モード（`--from` 相当）になります。URL が渡されたときは従来どおりダウンロード → 変換 → 閲覧を実行します。そのため bat 1 つで「URL を貼る使い方」と「フォルダを投げる使い方」の両方ができます。

---

## 前提

- このリポジトリを任意の場所に配置（例: `C:\tools\eh-downloader`）。**配置場所はどこでも OK**（後述のショートカットは移動しても壊れません）
- [Node.js](https://nodejs.org/) v18 以上がインストール済み
- 初回のみ `run_all.bat` を一度ダブルクリックして実行し、`sharp` をインストールしておく（未インストールのままフォルダを投げると変換がスキップされ、閲覧だけ行われます）

## 方法 1: ドラッグ&ドロップ

1. エクスプローラーでダウンロード済みギャラリーフォルダ（`3553112_タイトル/01.webp ...` など）を選択
2. `run_all.bat` の上にドラッグ&ドロップ
3. コンソールが開き、変換 → 完了後に既定ブラウザでビューワーが起動します

- **複数フォルダを同時に投げても OK**。全部が変換され、ビューワーは最初のフォルダ（同一親フォルダ内ならその親）を開きます。PageDown /「次フォルダ」で切り替えられます
- フォルダの中にサブフォルダが入れ子になっていても、画像を含むフォルダを自動で見つけてすべて変換します

## 方法 2: 「送る」メニューに登録

一度登録しておけば、フォルダを右クリック → **送る → run_all** で実行できます。

1. `Win + R` を押して「ファイル名を指定して実行」を開く
2. `shell:sendto` と入力して Enter（「SendTo」フォルダが開きます）
3. エクスプローラーで `run_all.bat` を右クリック → **ショートカットの作成**
4. 作成したショートカットを「SendTo」フォルダに移動（コピー）する
5. 分かりやすい名前に変更（例: `変換して閲覧 (run_all)`）

**使い方**: フォルダを右クリック → **送る** → `run_all` を選択。

> ショートカットの「作業フォルダ」はどこでも構いません。`run_all.bat` は自分自身の場所（`%~dp0`）に移動してから動くためです。リポジトリを別ドライブへ移動してもショートカットのリンク先を修正するだけで済みます。

### JPEG 変換 + 元 WebP 削除のショートカットを作る

「送る」に登録するショートカットの**リンク先**に引数を追記すると、定型操作をワンクリックにできます。

1. SendTo フォルダのショートカットを右クリック → **プロパティ**
2. 「リンク先」の末尾にオプションを追記:

```text
E:\tools\eh-downloader\run_all.bat --format jpeg --del
```

3. 名前を `変換して閲覧 (JPEG, 元削除)` などに変更

| 追記する引数 | 動作 |
|---|---|
| `--format jpeg` | JPEG に変換（デフォルトは PNG） |
| `--del` | 変換成功後に元 WebP を削除（⚠ 復元不可） |
| `--force` | 変換済みの画像も再変換 |
| `--open-only` | 変換せずビューワーで開くだけ（再閲覧用） |

> 「送る」は複数フォルダの同時送信にも対応しています。エクスプローラーで複数選択して右クリック → 送る、で全部が処理されます。

## 方法 3: デスクトップに D&D 専用ショートカット

「送る」を使わない場合は、`run_all.bat` のショートカットをデスクトップに置くだけでも D&D の受け皿になります。アイコンを変更すれば見分けも付けられます（ショートカットのプロパティ → アイコンの変更）。

## 動作の流れと注意

- フォルダを渡すと**ダウンロードフェーズはスキップ**され、変換 → 閲覧のみ実行されます
- ビューワーは別プロセスで起動するため、変換完了後コンソールは自動で閉じます（エラー時は終了コードを表示して一時停止します）
- 変換済みのフォルダを再度投げても、変換済み画像はスキップされ、未変換分だけ処理されます（`--force` 時は全再変換）
- 元 WebP は `--del` を付けない限り削除されません
- サムネイルのキャッシュ（`.thumbcache/`）は閲覧フォルダ内に作られます。フォルダごと削除すればキャッシュも消えます

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| ウィンドウが一瞬で閉じて何も起きない | コマンドプロンプトから `run_all.bat <フォルダ>` を手動実行してエラーを確認。多くは Node.js 未インストール |
| 変換がスキップされる（閲覧のみ） | `sharp` 未インストール。`run_all.bat` を一度普通に起動してインストールさせる |
| ビューワーが開かない | ポート 8420 付近が使用中でも自動で次のポートを使います。コンソールに表示された URL を確認 |

---

<a id="english"></a>
# Using run_all.bat via "Send to" menu / drag & drop (English)

Dropping a folder onto `run_all.bat` runs **WebP → PNG/JPEG conversion and opens the viewer** automatically.

> **How it works**: when `run_all.mjs` receives folder path(s) without any URL, it switches to the "convert + view" mode (equivalent to `--from`). With a URL it behaves as before (download → convert → view), so one bat file covers both workflows.

## Prerequisites

- Place this repository anywhere (e.g. `C:\tools\eh-downloader`)
- [Node.js](https://nodejs.org/) v18+
- Run `run_all.bat` once (double-click) to install `sharp`; otherwise conversion is skipped and only the viewer opens

## Method 1: Drag & drop

1. Select a downloaded gallery folder in Explorer (`3553112_title/01.webp ...`)
2. Drop it onto `run_all.bat`
3. A console opens, converts the images, then the viewer starts in your default browser

- You can drop **multiple folders at once**. All are converted; the viewer opens the first folder (or their common parent), and PageDown / "next folder" switches between galleries
- Nested subfolders are searched automatically

## Method 2: Register in the "Send to" menu

1. Press `Win + R`, type `shell:sendto`, press Enter (the SendTo folder opens)
2. Right-click `run_all.bat` → **Create shortcut**
3. Move the shortcut into the SendTo folder
4. Rename it, e.g. `Convert & view (run_all)`

**Usage**: right-click a folder → **Send to** → `run_all`.

### Shortcut with fixed options (JPEG + delete)

1. Right-click the shortcut in SendTo → **Properties**
2. Append options to the **Target** field:

```text
E:\tools\eh-downloader\run_all.bat --format jpeg --del
```

3. Rename it, e.g. `Convert & view (JPEG, delete source)`

| Extra argument | Behavior |
|---|---|
| `--format jpeg` | Convert to JPEG (default is PNG) |
| `--del` | Delete source WebP after conversion (⚠ unrecoverable) |
| `--force` | Re-convert already converted images |
| `--open-only` | Only open the viewer (no conversion) |

## Method 3: Desktop shortcut

Simply put a shortcut of `run_all.bat` on your desktop and drop folders onto it.

## Notes

- Dropping a folder skips the download phase (convert + view only)
- The viewer runs as a separate process, so the console closes automatically after conversion (on error it pauses and shows the exit code)
- Re-dropping an already converted folder only converts what is new (unless `--force`)
- Source WebP files are kept unless `--del` is given
- Thumbnail cache (`.thumbcache/`) lives inside each browsed folder; deleting the folder removes the cache

## Troubleshooting

| Symptom | Fix |
|---|---|
| Console flashes and nothing happens | Run `run_all.bat <folder>` from a terminal to see the error; usually Node.js is missing |
| Conversion skipped (viewer only) | `sharp` is not installed; run `run_all.bat` normally once to install it |
| Viewer does not open | If port 8420 is busy the next port is used automatically — check the URL printed in the console |
