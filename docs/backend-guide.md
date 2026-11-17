# バックエンド開発ガイド

ルートの `README.md` は作品説明を管理する担当者向けのため、バックエンド作業では編集しない。開発手順はこの `docs` 配下で管理する。

## ドキュメント

- [プロダクト・構成の企画書](hoshirube.md)
- [バックエンドAPI仕様（確定版）](backend-api.md)
- [OpenAPI契約（正本）](swagger-ui/openapi.yaml)
- [星カタログ](../contracts/themes.json)
- [質問票 onboarding-v1](../contracts/questionnaires/onboarding-v1.json)
- [質問票 onboarding-v2](../contracts/questionnaires/onboarding-v2.json)

## API契約

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/v1/discovery/seed` | 質問票の版と回答から、最初に表示する星と星ごとの検索語を返す |
| `GET` | `/v1/themes/{themeId}/books` | 星・検索語・回答から書籍を最大5冊返す |
| `GET` | `/health` | APIの稼働確認 |

- ログイン・Cookie・ユーザーDBなし。回答はseedの本文と、GETの `X-Discovery-Context` ヘッダーに含める。
- seedは `themeId` を受け取らない。Bedrockが大ジャンル9IDから異なる3個と検索語を選び、おすすめ順に返す。先頭が初期選択。不正なAI出力は `502`、AI停止・スロットリングは `503`、タイムアウトは `504` とし、フロントの点数方式へfallbackしない。
- GETの `themeId` は既存15IDのいずれか。未知のIDは `422` `VALIDATION_ERROR` で、`details[]` に `UNKNOWN_THEME_ID` を入れる。`q` は必須で、seedの `searchQuery` を `URLSearchParams` でエンコードして送る。trim後空不可、128文字以内。
- GETの `X-Discovery-Context` は必須。`JSON.stringify({ questionnaireVersion, answers })` のASCII JSON文字列で、最大4KiB。認証トークンでもセッションでも、seedを呼んだ証明でもない。毎回、共有質問票の回答条件で検証する。CORSの許可ヘッダーに含める。欠落は `422` `VALIDATION_ERROR`（`field: "X-Discovery-Context"`・`code: "INVALID_REQUEST_SHAPE"`）。
- 質問票は `onboarding-v1` と `onboarding-v2` を受理する。v2は `interest=none` のときだけ `curiosity` を必須にする。
- 検索語の生成はseedで行い、GETでは再生成しない。おすすめ理由は書籍の内容紹介を根拠に生成する。根拠不足や生成失敗では理由を `null` にし、本自体は `200` で返す。
- `GET` の回答JSONの解析失敗は `400` `INVALID_CONTEXT_JSON`、ヘッダー4KiB超過は `431` `CONTEXT_TOO_LARGE`、型・版・回答条件の不正は `422`。アプリケーションとしての `503` はseedのみに定義し、GETには定義しない。
- API契約は `info.version: 2.0.0`。URLの `/v1` と質問票の `onboarding-v1`・`onboarding-v2` は独立した版。
- APIサーバー（API Gateway・Lambda）は未実装。OpenAPIの `https://api.example.invalid` は実在しないプレースホルダー。

## 画面から呼ぶ流れ

1. `POST /v1/discovery/seed` に版と回答を送り、最初の星と検索語を受け取る。
2. 回答とseedの結果をブラウザに保存する。
3. seedの結果を星として描画し、先頭の星を初期選択にする。星の座標・色・配置はフロントで決める。
4. 星を選んだら `GET /v1/themes/{themeId}/books` に `q` と `X-Discovery-Context` を付けて書籍を取得する。

```js
const base = process.env.NEXT_PUBLIC_API_BASE_URL; // API未実装のため、現状は値が未設定
if (!base) throw new Error('NEXT_PUBLIC_API_BASE_URL が未設定です');

const answers = [
  { questionId: 'interest', selectedOptionIds: ['create'] },
  { questionId: 'themes', selectedOptionIds: ['tec', 'mon'] },
  { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
];
const questionnaireVersion = 'onboarding-v1';
const context = JSON.stringify({ questionnaireVersion, answers });

const seedRes = await fetch(`${base}/v1/discovery/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ questionnaireVersion, answers }),
});
if (!seedRes.ok) throw new Error(`seed failed: ${seedRes.status}`);
const seed = await seedRes.json();
// seed.themes はおすすめ順。回答と seed を保存し、seed.themes[0] を初期選択にする

const theme = seed.themes[0];
const params = new URLSearchParams({ q: theme.searchQuery });
const booksRes = await fetch(
  `${base}/v1/themes/${encodeURIComponent(theme.themeId)}/books?${params}`,
  { headers: { 'X-Discovery-Context': context } },
);
if (!booksRes.ok) throw new Error(`books failed: ${booksRes.status}`);
const result = await booksRes.json();
```

`base` はNext.jsの環境変数 `NEXT_PUBLIC_API_BASE_URL` から設定し、未設定なら呼び出さない。`context` は質問ID・選択肢ID・版名だけのASCII JSONにする。自由記述や認証情報を入れず、URLやログにも載せない。`seedRes.ok`・`booksRes.ok` を本文のJSON参照前に確認し、失敗時の表示や再試行は呼び出し側のUIで扱う。seedが失敗したら星を表示せず、点数方式へ切り替えずに再試行を案内する。取得済みの書籍結果を画面内で再利用するときのキーは「版＋回答＋themeId＋q」とする。

## ローカルで契約を見る

`docs/swagger-ui` はアプリ本体とは独立したnpmプロジェクト。Node.js 22.12.0以上、npm 10以上を前提とする。<br>
以下のnpmコマンドはすべてリポジトリルートで実行する。

```sh
npm --prefix docs/swagger-ui ci --ignore-scripts
npm --prefix docs/swagger-ui run lint
npm --prefix docs/swagger-ui run check
npm --prefix docs/swagger-ui run serve
```

`docs/swagger-ui` は静的配布アセットのみのため、依存導入では `--ignore-scripts` を付け、不要なpostinstallを実行しない。グローバルのnpm設定は変更しない。

`serve` を実行したら、ブラウザで <http://127.0.0.1:8080/> を開く。

- `lint` はRedocly CLIでOpenAPIの形式・参照・exampleを検証する。
- `check` は星・質問ID・enum・選択数・版がカタログとOpenAPIで一致すること、seed本文とGETコンテキストの回答例が意味条件を満たすこと、seed例が3個の異なる大ジャンルIDと有効な検索語を持つこと、GETのpath・query・headerが必須であること、旧パスが存在しないことを確認する静的検証。本番バリデータではなく、APIの動作確認は行わない。
- Swagger UIは `swagger-ui-dist` のローカルアセットと同一オリジンの `/openapi.yaml` だけを読み、CDNや外部バリデータを使わない。Try it outは無効。
- 外部通信を伴うAPIテストやデプロイは行わない。

## 主な構成

```text
contracts/
  themes.json                  星ID・名称・親子関係・基本検索語
  questionnaires/              質問票の版ごとの定義
docs/
  backend-api.md                確定API仕様
  backend-guide.md              この開発ガイド
  hoshirube.md                  プロダクト・構成の企画書
  swagger-ui/
    openapi.yaml                送受信契約の正本（OpenAPI 3.0.3）
    index.html                  ローカルSwagger UI
    package.json                ドキュメント用ツール
    package-lock.json           依存の固定
    redocly.yaml                Redocly lint設定
    scripts/check-contract.mjs  カタログと意味条件の静的検証
    node_modules/               ローカル依存（Git対象外）
```

## 実装状況

- フロントの確認対象は `feature/frontend-MVP` の `771b1e7`。
- バックエンドAPI、AWSリソース、デプロイはこのリポジトリの今回の作業に含まない。
