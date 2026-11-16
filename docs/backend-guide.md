# バックエンド開発ガイド

ルートの `README.md` は作品説明を管理する担当者向けのため、バックエンド作業では編集しない。開発手順はこの `docs` 配下で管理する。

## ドキュメント

- [プロダクト・構成の企画書](hoshirube.md)
- [バックエンドAPI仕様（確定版）](superpowers/specs/2026-11-16-backend-api-design.md)
- [OpenAPI契約（正本）](openapi.yaml)
- [星カタログ](../contracts/themes.json)
- [質問票 onboarding-v1](../contracts/questionnaires/onboarding-v1.json)
- [質問票 onboarding-v2](../contracts/questionnaires/onboarding-v2.json)

## API契約

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/v1/books/recommendations` | 星ID・質問票の版・回答から書籍を最大5冊返す |
| `GET` | `/health` | APIの稼働確認 |

- ログイン・Cookie・ユーザーDBなし。回答はリクエスト本文に含める。
- 質問票は `onboarding-v1` と `onboarding-v2` を受理する。v2は `interest=none` のときだけ `curiosity` を必須にする。
- おすすめ理由は書籍の内容紹介を根拠に生成する。根拠不足や生成失敗では理由を `null` にし、本自体は返す。
- APIサーバー（API Gateway・Lambda）は未実装。OpenAPIの `https://api.example.invalid` は実在しないプレースホルダー。

## ローカルで契約を見る

`docs` はアプリ本体とは独立したnpmプロジェクト。Node.js 22.12.0以上、npm 10以上を前提とする。<br>
以下のnpmコマンドはすべてリポジトリルートで実行する。

```sh
npm --prefix docs ci --ignore-scripts
npm --prefix docs run lint
npm --prefix docs run check
npm --prefix docs run serve
```

`docs` は静的配布アセットのみのため、依存導入では `--ignore-scripts` を付け、不要なpostinstallを実行しない。グローバルのnpm設定は変更しない。

`serve` を実行したら、ブラウザで <http://127.0.0.1:8080/> を開く。

- `lint` はRedocly CLIでOpenAPIの形式・参照・exampleを検証する。
- `check` は星・質問ID・enum・選択数・版がカタログとOpenAPIで一致すること、リクエスト例が必須・排他・v2分岐を満たすこと、未知の星・未知の選択肢・不正なv2分岐を検出できることを確認する静的検証。本番バリデータではなく、APIの動作確認は行わない。
- Swagger UIは `swagger-ui-dist` のローカルアセットと同一オリジンの `/openapi.yaml` だけを読み、CDNや外部バリデータを使わない。Try it outは無効。
- 外部通信を伴うAPIテストやデプロイは行わない。

## 主な構成

```text
contracts/
  themes.json                  星ID・名称・親子関係・基本検索語
  questionnaires/              質問票の版ごとの定義
docs/
  openapi.yaml                 送受信契約の正本（OpenAPI 3.0.3）
  index.html                   ローカルSwagger UI
  package.json                 ドキュメント用ツール
  redocly.yaml                 Redocly lint設定
  scripts/check-contract.mjs   カタログと意味条件の静的検証
  hoshirube.md                 プロダクト・構成の企画書
  superpowers/specs/           確定API仕様
```

## 実装状況

- フロントの確認対象は `feature/frontend-MVP` の `771b1e7`。
- バックエンドAPI、AWSリソース、デプロイはこのリポジトリの今回の作業に含まない。
