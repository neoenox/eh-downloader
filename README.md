# E-Hentai ダウンロード & 画像変換ツール

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
| `--list <file>` | URL 一覧ファイルを一括処理 |
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
