#!/usr/bin/env node
// 単一exe (SEA) 用エントリ: run_all 統合版
//
// eh-runall.exe <URL|フォルダ|urls.txt> [run_all のオプション]
//
// SEA 内ではファイル相対の動的 import が使えないため、バンドル時に
// 4 スクリプト (run_all / eh_download / convert_images / image_viewer) を
// 1 ファイルに束ねる (build_exe.mjs の --runall で使用)。
// バンドル後は同一チャンクに全モジュールが含まれるため、EH_EMBEDDED=1 を
// 自分で設定し、run_all の埋め込みモード経由で各機能を呼び出す。
//
// `__view` サブコマンド: run_all から「ビューワーだけを別プロセスで起動する」
// ために使う (SEA の実行ファイルは自分自身を spawn する)。

// 埋め込みモードを有効化してから run_all を読み込む (順序重要)
process.env.EH_EMBEDDED = "1";

async function main() {
  if (process.argv[2] === "__view") {
    // ビューワー単体起動 (run_all の内部から spawn される)
    const { runViewer } = await import("./image_viewer.mjs");
    await runViewer(process.argv.slice(3));
  } else {
    const { runAll } = await import("./run_all.mjs");
    await runAll(process.argv.slice(2));
  }
}

main().catch((e) => {
  console.error("[ERROR]", e && e.stack || e);
  process.exit(1);
});
