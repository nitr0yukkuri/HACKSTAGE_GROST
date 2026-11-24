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
- API サーバー（API Gateway・Lambda）と AWS リソースの Terraform 定義は `infra/terraform` にあり、既存の共有環境 `hackathon-dev` へデプロイ済み。実 URL は `https://h5bu36urf3.execute-api.ap-northeast-1.amazonaws.com`（`openapi.yaml` の `servers` にも記載）。`https://api.example.invalid` は契約参照用のプレースホルダーで、実在しない。
- このリポジトリのフォローアップ（ネットワーク別の日次上限と fail-closed）は PR の段階であり、既存の `hackathon-dev` は再デプロイするまで従来の挙動のままである。従来は日次上限が全体カウンタだけであった。再デプロイは承認後に、対象環境を確認してから `terraform plan` / `apply` で行う。
- 新しい環境を作る場合は、既存の `hackathon-dev` と state・tfvars・リソースを共有しない。手順は「バックエンドの起動とデプロイ」の「新しい環境を分けて作る」を参照する。
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
const params = new URLSearchParams({ q: theme.searchQuery, include: 'selectedBy' });
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
- 星別の本を取得するときは、`q` に加えて `include=selectedBy` を付ける。`include=selectedBy` を指定したときだけ各本に `selectedBy`（`ai` または `search`）が返る（オプトイン）。指定しない・空・`selectedBy` を含まない場合は、この項目を追加する前と同じ形で返る。未知のトークンは無視される。オプトインなので、画面と API のリリース順・ロールバック順に制約はない（画面が先でも API が先でもよく、古い画面を開いたままでも本の一覧が契約エラーにならない）。
- `coverUrl`・`description`・`recommendationReason`・`infoUrl` は `null` になり得る。表紙なしの代替表示を用意し、本自体は表示する。`recommendationReason` が `null` の本には、AI を使わない定型文を2文で表示する。1文目は `selectedBy` が `search` なら「{星の名前}の星に並ぶ一冊です。」、`ai` または項目なしなら「{星の名前}の星につながる一冊です。」（星の名前が渡されない場合は「この星に…」）。2文目は `description` があれば「気になったら、内容紹介をひらいてみてください。」、なければ `infoUrl` があれば「タイトルが気になったら、Google Books で中身をのぞいてみませんか？」、どちらもなければ「タイトルが気になったら、手に取ってみてください。」。本の内容には触れない。`selectedBy` は `ai`・`search` のどちらかで、画面は項目があってもなくても受け付ける。
- `description`（内容紹介）と `recommendationReason`（おすすめ理由）は別の文章として保持し、カードでは理由、展開部分では内容紹介を表示する。`infoUrl` がある場合だけ「Google Books で詳しく見る」を表示する。
- `warnings` があっても本は表示する（画面は警告を表示せず、理由がない本は本の行の定型文で示す）。0 件は「別の星も探してみよう」と案内する。
- `items` は AI が選んだ本を推薦順に先頭に置く。3冊に満たなければ、未選定の候補から内容紹介のある本を優先して（各組の中は検索順で）補い、末尾に置く（候補が3冊未満ならその全件）。AI の選定を使えないときは検索順で最大5冊を返す。冊数が少ないこと自体は警告ではない。フロントで検索順に並べ替えない。
- seed の応答を待ってから星を表示し、フロントは 30 秒で待機を打ち切る。星を切り替えたら前のリクエストを中止するか古い応答を無視する。
- API Gateway のスロットリングによる `429` は共通 JSON 形式でない場合がある。1日の外部呼び出し上限（全体または送信元ネットワーク別）による `429` は共通 JSON（`RATE_LIMITED`）で、JST の翌日まで回復しない。いずれも HTTP ステータスと `error.code` の両方で扱い、スロットリングは時間をおいて再試行、日次上限は再試行せず案内を出す、という扱いをフロント接続時の要件とする。現時点のフロント実装でこの分岐が完了していることは確認していない。カウンタ利用不可は `429` ではなく、seed の初回は `503 DISCOVERY_UNAVAILABLE`、books のキャッシュミスは `502 BOOKS_UPSTREAM_ERROR`、理由生成は `200` と警告になる。
- 取得済み結果を画面内で再利用するときのキーは「質問票の版＋回答内容＋星 ID＋q」。回答が変わったら再利用しない。
- 再読み込み後、保存された質問票の版が未対応なら回答をやり直す。保存済みの v1 回答を勝手に v2 として送らない。

## 実装時の設定

以下は API 契約ではなく AWS 側の実装メモ。未選定の値は選定済み・実施済みとして扱わない。

- AWS リージョンは ap-northeast-1（東京）。構成は API Gateway HTTP API → Lambda（TypeScript・`nodejs22.x`・arm64）→ Google Books / Bedrock。IaC は Terraform（`infra/terraform`、ローカル state）。
- Google Books の API キーはバックエンドで保持し、ブラウザへ返さない。Bedrock は Lambda の IAM ロールで呼び、使用するモデル／推論プロファイルに必要な権限へ絞る。
- Bedrock は Converse API で呼び、モデル ID は Lambda の環境変数 `BEDROCK_MODEL_ID` で切り替える。採用モデルは Qwen3 235B A22B 2507（`qwen.qwen3-235b-a22b-2507-v1:0`）で、処理リージョンは `ap-northeast-1`。Terraform の既定値と `terraform.tfvars` で設定する。`hackathon-dev` に Qwen と推薦順の選定を反映済み。星と推薦選定の出力は tool use（`submit_themes` / `submit_recommendations`）で構造化して受け取り、Lambda で再検証する。tool use が返らない場合だけテキスト JSON をフォールバックで読む。
- CORS の許可オリジンは Terraform の `cors_allow_origins`。サンプルの `terraform.tfvars.example` はローカル開発用と、現行・旧Vercelオリジンを許可する（`hackathon-dev` など既存環境の設定はその環境の実値に従う）。`GET`・`POST`・`Content-Type`・`X-Discovery-Context` を許可し、Cookie は使わない。CORS は認証ではないため、Gateway のスロットリング、Lambda の同時実行上限、日次の外部呼び出し上限で守る。
- 回答・推薦結果はアプリの DB に保存しない。ログは `requestId`・処理時間・件数・エラー種別を中心とし、回答全文・`X-Discovery-Context`・API キー・生成プロンプト全文を記録しない。日次カウンタのログには送信元 IP もその SHA256 の値も出さない。Bedrock の呼び出しログ設定も全文保存の有無を確認する。
- 外部サービスへ送るのは選択回答・取得した書籍情報・検索語だけ。ブラウザ内の読書メモや履歴は送らない。
- 月額上限・本番オリジン・レート制限の最終値は未確定。ハッカソン期間の暫定値として、Terraform のスロットリングはバースト 8・レート 3 req/s にしている（1人が seed 1回と books 最大3回を同時に送る前提）。`budget_alert_email` を設定したときだけ月次の予算アラート（実績80%・予測100%）を作る。`hackathon-dev` では実 API の疎通・処理時間・意味関連の代表例を確認済み。再デプロイは承認後に実行する。
- 外部呼び出しは DynamoDB の日次カウンタ（Asia/Tokyo、外部呼び出しの試行回数）で上限を強制する。全体上限は Bedrock が既定 3,000回/日、Google Books が 900回/日（Terraform の `daily_bedrock_limit` / `daily_google_books_limit`）。同じトランザクションで、送信元ネットワーク別の上限も `max(1, floor(全体上限 / 6))`（既定 500 / 150）で数える。ネットワークは IPv4 アドレス、または IPv6 の /64 とし、IPv4-mapped IPv6 は IPv4 として扱う。カウンタ項目は `<kind>#<JSTの日付>` と `<kind>#<JSTの日付>#net#<SHA256>` で、TTL は2日。SHA256 は JST の日付と正規化したネットワークの組から作り、同じネットワークでも日付が変われば値も変わる。日次カウンタのログに送信元 IP やこの値は出さない。
- 全体上限またはネットワーク別上限に達すると、seed と books の検索は `429 RATE_LIMITED`、seed の再生成の直前は `502 DISCOVERY_UPSTREAM_ERROR`、books の理由生成は `200` と `RECOMMENDATION_REASON_UNAVAILABLE` の警告になる。カウンタが設定済みで利用できない場合（DynamoDB 障害・競合・タイムアウト・送信元 IP の欠落や不正）は fail-closed とし、seed の初回は `503 DISCOVERY_UNAVAILABLE`、seed の再生成は `502 DISCOVERY_UPSTREAM_ERROR`、books の検索キャッシュミスは `502 BOOKS_UPSTREAM_ERROR`、理由生成は `200` と警告になる。`TransactionConflict` は同じトランザクションと同じ `ClientRequestToken` で最大2回短く再試行し、解消しなければ fail-closed になる。外部呼び出しは行わない。検索結果・推薦理由のメモリキャッシュにヒットした結果は、カウンタが利用できなくても返す。テーブル名が未設定のローカル開発・テストは従来どおり上限なしで通す。

## バックエンドの起動とデプロイ

`backend` は Lambda 用の TypeScript（ESM）。単一ファイル `backend/dist/index.mjs` に bundle し、Terraform がこれを zip する。以下のコマンドはリポジトリルートで実行する。

```sh
npm --prefix backend ci
npm --prefix backend run test
npm --prefix backend run build   # backend/dist/index.mjs を生成
```

ローカル API を起動するには AWS 認証情報と `BEDROCK_MODEL_ID` が必要。値は環境ごとに確認し、秘密情報をコミットしたりログに出したりしない。

```sh
# AWS_PROFILE など、自分の作業用の認証情報を設定する
export AWS_REGION=ap-northeast-1
export BEDROCK_MODEL_ID=qwen.qwen3-235b-a22b-2507-v1:0
# 任意: Google Books の API キーを使う場合だけ。未設定ならキーなしで呼ぶ
export GOOGLE_BOOKS_API_KEY_PARAM=/hoshirube/google-books-api-key
# 任意: ローカルで日次上限を試す場合だけ。未設定なら上限なし（ローカル・テスト用）
# export USAGE_TABLE_NAME=<自分の検証用テーブル名>
npm --prefix backend run dev     # http://127.0.0.1:8787 でローカル起動
```

`BEDROCK_MODEL_ID` を省略するとモデル呼び出しは設定エラーになる（既定値への暗黙フォールバックはしない）。`GOOGLE_BOOKS_API_KEY_PARAM` は任意で、使う場合だけ SSM Parameter Store の SecureString を手動で置く（Terraform は値を持たない）。

```sh
aws ssm put-parameter --name /hoshirube/google-books-api-key --type SecureString \
  --value '<キー>' --region ap-northeast-1
```

`--value` に渡した値はシェル履歴やプロセス一覧に残ることがある。キーは別途安全に扱い、共有しない。

### 新しい環境を分けて作る

既存の共有環境 `hackathon-dev` へこの変更をそのまま適用しない。新しい環境は、既存環境と state・tfvars・リソースを共有せず、次の順で作る。

1. 作業ディレクトリ（または worktree）と state を環境ごとに分ける。使う state は対象環境の原本または承認済みの作業コピーだけにし、他者の state や `hackathon-dev` の state を流用・改変しない。state と実 tfvars は追跡しない（リポジトリにもコミットしない）。
2. AWS の認証情報・アカウント・リージョンが対象環境のものか確認する。認証情報そのものは表示・共有しない。
3. `terraform.tfvars.example` をコピーし、`env`・`name_prefix`・`aws_region`・`bedrock_model_id`・上限・CORS を対象環境の実値にする。既存環境の tfvars は流用しない。サンプルの `cors_allow_origins` はローカルと現行・旧Vercelオリジンを含む。対象環境に必要な公開オリジンだけを設定する。tfvars に秘密情報を書かない。
4. `npm --prefix backend run build` の後、`terraform init` と `terraform plan` を実行する。初回は意図した新規作成だけが表示され、`replace`（`-/+`）や `destroy` が無いことを確認する。想定外の差分があれば apply しない。
5. 承認後に `terraform apply` を実行し、確認表示の plan がレビュー済みの内容と一致することを確かめる。

```sh
cd infra/terraform
terraform init
terraform plan
# 初回は意図した新規作成のみか、replace/destroy が無いかを確認する
terraform apply   # 承認後。確認表示の plan を再確認する
```

### 既存の共有環境 `hackathon-dev` の更新

`hackathon-dev` は既にデプロイ済みで、出力 `api_base_url = https://h5bu36urf3.execute-api.ap-northeast-1.amazonaws.com`（末尾スラッシュなし）を、公開フロントを API に接続するときに `NEXT_PUBLIC_API_BASE_URL` に設定する。公開フロントは現在ローカルデモ表示で稼働している。この PR のネットワーク別上限と fail-closed はまだ `hackathon-dev` に反映されていない。更新する場合は次を守る。

1. `hackathon-dev` の原本または承認済みの state と、それに対応する実際の tfvars を使う。別環境の state・tfvars・作業コピーを混ぜない。state と実 tfvars は追跡しない。
2. AWS のアカウント・リージョン・認証情報が `hackathon-dev` のものか確認し、`terraform state list` で既存の API Gateway・Lambda・DynamoDB・ログ・IAM が state に存在することを確かめる。state が空、または既存リソースが欠けていれば作業を止める。
3. `npm --prefix backend run build` で bundle を作り、`terraform plan` を実行する。想定外の作成・置換・削除（特に DynamoDB テーブルや API Gateway の置換）があれば apply しない。
4. 設定済みの CORS 許可オリジンを維持する。ローカル用の `http://localhost:3000` だけで上書きしない。
5. レビュー済みの差分と plan を確認し、承認後にだけ `terraform apply` を実行する。apply の確認表示でも同じ plan であることを確かめる。

```sh
cd infra/terraform
terraform init
terraform state list
terraform plan
terraform apply   # 承認後。確認表示の plan を再確認する
```

保存した plan ファイルをリポジトリ内に置かない。plan を保存する必要がある場合は、リポジトリ外のアクセス制御された場所に置く。再 apply した場合も出力の `api_base_url` を使う。Bedrock はモデルアクセスの有効化が前提で、Marketplace 課金のモデル（Claude 等）は追加の権限・契約が必要になる場合がある。
