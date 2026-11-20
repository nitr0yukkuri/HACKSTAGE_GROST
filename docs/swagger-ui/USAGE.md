# ほしるべ API の使い方

API の送受信契約・意味条件・処理は [`openapi.yaml`](openapi.yaml) を正本とする。この文書は起動・検証方法、呼び出し例、フロント接続時の注意、実装時の設定だけをまとめる。API 一覧・全 JSON・全エラー・enum は繰り返さない。

企画書 `docs/hoshirube.md` にある旧 `docs/backend-api.md` への参照は廃止済み。API 仕様は `openapi.yaml` に統合した。

## ローカルで契約を見る

`docs/swagger-ui` はアプリ本体とは独立した npm プロジェクト。Node.js 22.12.0 以上、npm 10 以上を前提とし、以下のコマンドはすべてリポジトリルートで実行する。

```sh
npm --prefix docs/swagger-ui ci --ignore-scripts
npm --prefix docs/swagger-ui run lint
npm --prefix docs/swagger-ui run check
npm --prefix docs/swagger-ui run serve
```

`serve` の後、<http://127.0.0.1:8080/> を開く。Swagger UI はローカルの `swagger-ui-dist` と同一オリジンの `/openapi.yaml` だけを読み、CDN や外部バリデータを使わない。Try it out は無効。

- `lint` は Redocly CLI で OpenAPI の形式・参照・example を検証する。
- `check` はカタログと OpenAPI の一致、回答例の意味条件、seed の3星・検索語、GET の必須条件、旧パスの不存在を確認する静的検証。本番バリデータではない。
- API サーバー（API Gateway・Lambda）と AWS リソースの Terraform 定義は `infra/terraform` にあり、`hackathon-dev` へデプロイ済み。実 URL は `https://h5bu36urf3.execute-api.ap-northeast-1.amazonaws.com`（`openapi.yaml` の `servers` にも記載）。`https://api.example.invalid` は契約参照用のプレースホルダーで、実在しない。再デプロイは承認後に `terraform plan` / `apply` で行う。
- ローカルの契約モックとk6検証は [`docs/mock-api-k6.md`](../mock-api-k6.md) を参照する。これはGoogle Books・Bedrock・AWSへ接続せず、本番APIの性能や推薦品質を検証するものではない。

## 呼び出し例

`NEXT_PUBLIC_API_BASE_URL` は API のルート URL。未設定なら呼び出さない。

```js
const base = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!base) throw new Error('NEXT_PUBLIC_API_BASE_URL が未設定です');

const questionnaireVersion = 'onboarding-v1';
const answers = [
  { questionId: 'interest', selectedOptionIds: ['create'] },
  { questionId: 'themes', selectedOptionIds: ['tec', 'mon'] },
  { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
];
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
// result.items は推薦順。返された順に表示し、検索順やスコアで並べ替えない
```

`context` は質問 ID・選択肢 ID・版名だけの ASCII JSON にする。自由記述や認証情報を入れず、URL やログにも載せない。本文の JSON を参照する前に `seedRes.ok`・`booksRes.ok` を確認する。seed が失敗したら星を表示せず、点数方式へ切り替えずに再試行を案内する。

## フロント接続時の注意

- 星の配置・色・明るさ・描画はフロントの担当。初期に選ぶ星は seed の結果を正とし、フロントの点数計算で置き換えない。
- 回答と seed 結果はブラウザに保存する。ログイン・Cookie・ユーザー DB・API キーの埋め込みは使わない。
- 書籍の保存・読了記録・読了時の星座更新はフロントの担当。同じ本を複数の星で保存する場合は `(source, id)` を同一書籍のキーにし、発見した星 ID を重複なく保持する。
- `authors` は配列で返る。既存の文字列型へ変換する場合は `join('、')` などを使い、空配列は「著者情報なし」と表示する。
- `coverUrl`・`description`・`recommendationReason`・`infoUrl` は `null` になり得る。表紙なしの代替表示、理由なしの「おすすめ理由はありません」を用意し、本自体は表示する。
- `description`（内容紹介）と `recommendationReason`（おすすめ理由）は別の文章として保持し、カードでは理由、展開部分では内容紹介を表示する。`infoUrl` がある場合だけ「Google Books で詳しく見る」を表示する。
- `warnings` があっても本は表示する。0 件は「別の星も探してみよう」と案内する。
- `items` は回答意図に合う順（推薦順）で最大5冊。合う本が少なければ5冊未満になる。冊数が少ないこと自体は警告ではなく、無理に埋めない。フロントで検索順に並べ替えない。
- seed の応答を待ってから星を表示し、フロントは 30 秒で待機を打ち切る。星を切り替えたら前のリクエストを中止するか古い応答を無視する。
- API Gateway のスロットリングによる `429` は共通 JSON 形式でない場合がある。1日の外部呼び出し上限による `429` は共通 JSON（`RATE_LIMITED`）で、JST の翌日まで回復しない。いずれも HTTP ステータスと `error.code` の両方で扱い、スロットリングは時間をおいて再試行、日次上限は再試行せず案内を出す。
- 取得済み結果を画面内で再利用するときのキーは「質問票の版＋回答内容＋星 ID＋q」。回答が変わったら再利用しない。
- 再読み込み後、保存された質問票の版が未対応なら回答をやり直す。保存済みの v1 回答を勝手に v2 として送らない。

## 実装時の設定

以下は API 契約ではなく AWS 側の実装メモ。未選定の値は選定済み・実施済みとして扱わない。

- AWS リージョンは ap-northeast-1（東京）。構成は API Gateway HTTP API → Lambda（TypeScript・`nodejs22.x`・arm64）→ Google Books / Bedrock。IaC は Terraform（`infra/terraform`、ローカル state）。
- Google Books の API キーはバックエンドで保持し、ブラウザへ返さない。Bedrock は Lambda の IAM ロールで呼び、使用するモデル／推論プロファイルに必要な権限へ絞る。
- Bedrock は Converse API で呼び、モデル ID は Lambda の環境変数 `BEDROCK_MODEL_ID` で切り替える。採用モデルは Qwen3 235B A22B 2507（`qwen.qwen3-235b-a22b-2507-v1:0`）で、処理リージョンは `ap-northeast-1`。Terraform の既定値と `terraform.tfvars` で設定する。`hackathon-dev` に Qwen と推薦順の選定を反映済み。星と推薦選定の出力は tool use（`submit_themes` / `submit_recommendations`）で構造化して受け取り、Lambda で再検証する。tool use が返らない場合だけテキスト JSON をフォールバックで読む。
- CORS の許可オリジンは Terraform の `cors_allow_origins`。`hackathon-dev` では `http://localhost:3000` と `https://hoshirube-nitr0s-projects.vercel.app` を許可している（`terraform.tfvars.example` の既定はローカルのみ）。`GET`・`POST`・`Content-Type`・`X-Discovery-Context` を許可し、Cookie は使わない。CORS は認証ではないため、Gateway のスロットリング、Lambda の同時実行上限、日次の外部呼び出し上限で守る。
- 回答・推薦結果はアプリの DB に保存しない。ログは `requestId`・処理時間・件数・エラー種別を中心とし、回答全文・`X-Discovery-Context`・API キー・生成プロンプト全文を記録しない。Bedrock の呼び出しログ設定も全文保存の有無を確認する。
- 外部サービスへ送るのは選択回答・取得した書籍情報・検索語だけ。ブラウザ内の読書メモや履歴は送らない。
- 月額上限・本番オリジン・レート制限の最終値は未確定。ハッカソン期間の暫定値として、Terraform のスロットリングはバースト 8・レート 3 req/s にしている（1人が seed 1回と books 最大3回を同時に送る前提）。`budget_alert_email` を設定したときだけ月次の予算アラート（実績80%・予測100%）を作る。`hackathon-dev` では実 API の疎通・処理時間・意味関連の代表例を確認済み。再デプロイは承認後に実行する。
- 外部呼び出しは DynamoDB の日次カウンタ（Asia/Tokyo、外部呼び出しの試行回数）で上限を強制する。Bedrock は既定 3,000回/日、Google Books は 900回/日。上限は API 全体で共有され、1人が使い切ると全員が JST の翌日まで `429` になる。超過時は seed と books の検索が `429 RATE_LIMITED`、seed の再生成の直前は `502 DISCOVERY_UPSTREAM_ERROR`、books の理由生成は `200` と `RECOMMENDATION_REASON_UNAVAILABLE` の警告になる。カウンタの障害・打ち切りでは上限を適用せず処理を続ける（fail-open）。

## バックエンドの起動とデプロイ

`backend` は Lambda 用の TypeScript（ESM）。単一ファイル `backend/dist/index.mjs` に bundle し、Terraform がこれを zip する。以下のコマンドはリポジトリルートで実行する。

```sh
npm --prefix backend ci
npm --prefix backend run test
npm --prefix backend run build   # backend/dist/index.mjs を生成
npm --prefix backend run dev     # http://127.0.0.1:8787 でローカル起動
```

Google Books の API キーは SSM Parameter Store の SecureString に手動で置く（Terraform は値を持たない）。

```sh
aws ssm put-parameter --name /hoshirube/google-books-api-key --type SecureString \
  --value '<キー>' --region ap-northeast-1
```

`--value` に渡した値はシェル履歴やプロセス一覧に残ることがある。キーは別途安全に扱い、共有しない。

インフラは `infra/terraform` で管理する。`apply` は承認後に実行する。`terraform plan` の前に `npm --prefix backend run build` を実行して `backend/dist/index.mjs` を作る（無いと plan が失敗する）。

```sh
cd infra/terraform
terraform init
terraform plan
terraform apply
```

`hackathon-dev` では `apply` 後の出力 `api_base_url = https://h5bu36urf3.execute-api.ap-northeast-1.amazonaws.com`（末尾スラッシュなし）を、公開フロントを API に接続するときに `NEXT_PUBLIC_API_BASE_URL` に設定する。公開フロントは現在ローカルデモ表示で稼働している。再 apply した場合も出力の `api_base_url` を使う。Bedrock はモデルアクセスの有効化が前提で、Marketplace 課金のモデル（Claude 等）は追加の権限・契約が必要になる場合がある。
