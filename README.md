# HACKSTAGE_GROST

## 開発環境

依存パッケージをインストールし、リポジトリ直下から開発サーバーを起動します。

```bash
npm --prefix frontend install
npm run dev
```

型チェックと本番ビルドは次のコマンドで実行できます。

```bash
npm run typecheck
npm run build
```

Next.jsアプリとその依存関係・設定は [`frontend/`](./frontend/) にあります。ルートのnpmスクリプトは、コマンドをフロントエンドの作業ディレクトリに転送します。