# ほしるべ MVP：バックエンドAPI仕様（確定版）

作成日：2026-11-16（2026-11-17 元企画のAPIフローへ復元）

状態：確定（API契約 v2.0.0）。実装はこの契約に従う。

作業ブランチ：`feature/backend-infra`（`main` から分岐）

確認したフロント：`feature/frontend-MVP` の `771b1e7`

関連ファイル：

- 送受信契約の正本：[`docs/swagger-ui/openapi.yaml`](swagger-ui/openapi.yaml)（OpenAPI 3.0.3）
- 星ID・名称・親子関係・基本検索語：[`contracts/themes.json`](../contracts/themes.json)
- 質問票の正本：[`contracts/questionnaires/onboarding-v1.json`](../contracts/questionnaires/onboarding-v1.json)、[`onboarding-v2.json`](../contracts/questionnaires/onboarding-v2.json)
- ローカルSwagger UI：[`docs/swagger-ui/index.html`](swagger-ui/index.html)
- 静的検証：[`docs/swagger-ui/scripts/check-contract.mjs`](swagger-ui/scripts/check-contract.mjs)

## 1. 確定した仕様

- MVPはログインなし。ユーザーアカウント、Cookie、セッション管理、ユーザーDBを作らない。
- 質問への回答、seedの結果、保存した本、読了記録はブラウザ内に保存する。
- 元の企画どおり、回答から最初に見せる星を選ぶのはBedrock（`POST /v1/discovery/seed`）。星の配置・色・明るさ・描画はフロントの表示関心事であり、初期に選ぶ星をフロントの固定点数で置き換えない。
- 業務APIは `POST /v1/discovery/seed` と `GET /v1/themes/{themeId}/books` の2本。稼働確認は `GET /health`。
- seedは星IDを受け取らず、質問票の版と回答から、異なる大ジャンル3個と星ごとの検索語を返す。配列はおすすめ順で、先頭を初期選択にする。
- 星を選ぶと、seedの検索語 `q` と回答ヘッダーで書籍を最大5冊取得する。各書籍には、回答と書誌情報に基づく個別のおすすめ理由を付ける。
- おすすめ理由の生成に失敗した場合や根拠が不足する場合も、本自体は `200` で返す。理由は `null`、警告を `warnings` に含める。
- 質問票は `onboarding-v1` と `onboarding-v2` の両方を受理する。既存の3問画面は `onboarding-v1` で接続できる。
- 星は既存フロントの15ID（大ジャンル9・中ジャンル6）を使う。座標・色・明るさはAPI契約に含めない。新しい星IDを追加しない。
- APIは回答・推薦結果をアプリのDBに保存しない。
- API契約の `info.version` は `2.0.0`。旧契約からの破壊的な変更である。URLの `/v1` はAPIの版、質問票の `onboarding-v1`・`onboarding-v2` は質問票の版で、互いに独立している。

### 契約の正本の分担

| 対象 | 正本 |
| --- | --- |
| パス、HTTPステータス、JSONの構造、enum、上限 | `docs/swagger-ui/openapi.yaml` |
| 星ID、名称、親子関係、基本検索語 | `contracts/themes.json` |
| 質問ID、選択肢ID、表示文言、選択数、必須・分岐条件 | `contracts/questionnaires/<version>.json` |
| 意味上の制約、処理、画面との分担 | この文書 |

今回のOpenAPIスキーマは、質問の組み合わせ・条件付き必須・排他選択・本文全体のバイト数・ヘッダーの意味条件を表現していない。これらは `description`・`x-validation-rules`・カタログに明記し、Lambdaで検証する。API Gateway HTTP APIは、インポートしたrequestBody/schemaを入力検証に使わないため、型・必須・enum・件数を含む構造検証もLambdaで行う（[HTTP APIのOpenAPI定義](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-open-api.html)）。

## 2. 経緯と採用した構成

2026-11-16の仕様では、フロントの点数計算（`calcScores`・`tiersFor`）で星を選び、`POST /v1/books/recommendations` の1本に統合していた。ユーザーは元の企画 `docs/hoshirube.md`（`cfb2b1b`）の「回答→Bedrockで星と検索語→GETで書籍取得」に合わせて作り直すよう明示したため、この判断を取り消す。

| 案 | 星の決定 | 業務API | 判断 |
| --- | --- | --- | --- |
| A：元企画どおりBedrockが選ぶ | 回答からBedrockが選ぶ | seed＋書籍取得 | 採用 |
| B：フロントの固定点数 | フロントの点数計算 | 書籍推薦のみ | 不採用（今回取り消した判断） |
| C：バックエンドの固定ルール | バックエンドの固定ルール | 星の決定＋書籍推薦 | 不採用 |

A案を採用する。後から合意した質問票v1/v2、基本3問＋「特になし」時の追加質問、ログインなし・ブラウザ保存、最大5冊と個別のおすすめ理由は維持する。旧 `POST /v1/books/recommendations` は廃止し、互換aliasを作らない。旧パスは現仕様のAPI一覧に含めない。

## 3. フロントとバックエンドの分担

| フロント担当 | バックエンド・AWS担当 |
| --- | --- |
| 質問の表示、追加質問への分岐 | 回答IDと質問票の版の検証 |
| 回答とseed結果のブラウザ保存 | 回答から最初の星と検索語を選ぶ（Bedrock） |
| seed結果の星の配置・色・明るさ・描画 | 星ID・検索語の検証、Google Books検索 |
| seedとGETの呼び出し | 検索結果の整形、重複除外、最大5冊への制限 |
| 読み込み・0件・エラー・理由なしの表示 | 本ごとのおすすめ理由の生成・検証 |
| 書籍の保存・読了記録、読了時の星座の更新 | 共通エラー、タイムアウト、ログ |
| 星を切り替えたときの古い応答の無視 | API Gateway、Lambda、Bedrock、接続設定 |

質問終了後、画面はseedの完了を待って星を表示する。seedが失敗した場合は星を表示せず、点数方式へのfallbackをせずに再試行を案内する。初期選択の星の本をGETで取得し、その後は星の選択時に取得する。

読了時にどの星を結ぶかは別の画面仕様として扱う。この文書では新しい星座の成長ルールを定義しない。

## 4. API一覧と共通ルール

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/v1/discovery/seed` | 回答から最初に表示する星と検索語を取得 |
| `GET` | `/v1/themes/{themeId}/books` | 星・検索語・回答から書籍とおすすめ理由を取得 |
| `GET` | `/health` | APIの稼働確認。外部サービスは呼ばない |

- HTTPS・JSON。seedの `Content-Type` は `application/json`。
- ログイン・Cookie・フロントに埋め込むAPIキーは不要。
- seedの回答はリクエスト本文に含める。GETの回答は必須の `X-Discovery-Context` ヘッダーに含め、URLのクエリには含めない。
- 推薦レスポンスは `Cache-Control: no-store`。CDNなどで別の利用者に再利用しない。
- 成功・エラーともに、Lambdaが返すJSONには `requestId` を含める。
- `GET /health` の成功例は `{"status":"ok","requestId":"example-health-001"}`。外部APIやBedrockの利用可否まで保証するものではない。
- API Gateway HTTP APIは、インポートしたrequestBody/schemaで入力検証しない。型・必須・enum・件数を含む構造検証と、質問の組み合わせ・排他などの意味検証はLambdaで行う。
- APIサーバー（API Gateway・Lambda）は未実装。OpenAPIのサーバーURL `https://api.example.invalid` は契約参照用のプレースホルダーで、実在しない。
- ローカルSwagger UIは `http://127.0.0.1:8080/` で参照する。ローカルの `swagger-ui-dist` と同一オリジンの `/openapi.yaml` だけを読み、CDNや外部バリデータは使わない。Try it outは無効にしている。
- 400は本文（seed）またはコンテキスト（GET）のJSON解析失敗にだけ使う。解析可能な型・形状・enum・必須・件数不正は422。メディアタイプ415と本文413はseedだけに定義する。GETのヘッダーサイズ431は別に定義する。
- `503` はseedの `DISCOVERY_UNAVAILABLE` だけに定義する。GETの理由生成のBedrock失敗には `503` を割り当てない。

## 5. seedのリクエスト

### 通常の回答例（onboarding-v1）

```http
POST /v1/discovery/seed
Content-Type: application/json
```

```json
{
  "questionnaireVersion": "onboarding-v1",
  "answers": [
    {
      "questionId": "interest",
      "selectedOptionIds": ["create"]
    },
    {
      "questionId": "themes",
      "selectedOptionIds": ["tec", "mon"]
    },
    {
      "questionId": "reading_experience",
      "selectedOptionIds": ["new_perspective"]
    }
  ]
}
```

| 項目 | 型 | ルール |
| --- | --- | --- |
| `questionnaireVersion` | string | 質問・選択肢の意味と検証ルールを識別する版。`onboarding-v1` または `onboarding-v2` |
| `answers` | array | 実際に回答した質問。表示しなかった質問は送らない |
| `questionId` | string | 質問の固定ID。表示順では識別しない |
| `selectedOptionIds` | string[] | 選択肢の固定ID。単一選択でも配列にする |

質問の文面や選択肢ラベルを毎回送る必要はない。バックエンドは共有した質問票定義でIDの意味を解決する。自由記述はMVPの対象外。seedの本文に `themeId` を含めない。

### 「特になし」の回答例

`onboarding-v1` では「特になし」を選んでも3問のまま送る。

```json
{
  "questionnaireVersion": "onboarding-v1",
  "answers": [
    {
      "questionId": "interest",
      "selectedOptionIds": ["none"]
    },
    {
      "questionId": "themes",
      "selectedOptionIds": ["omakase"]
    },
    {
      "questionId": "reading_experience",
      "selectedOptionIds": ["learn_knowledge"]
    }
  ]
}
```

### 追加質問を含む例（onboarding-v2）

`onboarding-v2` は、`interest` が `none` のときだけ `curiosity` を必須にする。`interest` が `none` 以外のときは `curiosity` を送らない。

```json
{
  "questionnaireVersion": "onboarding-v2",
  "answers": [
    {
      "questionId": "interest",
      "selectedOptionIds": ["none"]
    },
    {
      "questionId": "curiosity",
      "selectedOptionIds": ["music_emotions", "space_mysteries"]
    },
    {
      "questionId": "themes",
      "selectedOptionIds": ["omakase"]
    },
    {
      "questionId": "reading_experience",
      "selectedOptionIds": ["learn_knowledge"]
    }
  ]
}
```

`curiosity` の選択肢は次の3つに固定する。画面文言は意味を変えない範囲で調整できるが、IDと意味はこの契約を変えない。

| 選択肢ID | 意味 |
| --- | --- |
| `music_emotions` | 音楽で気分が変わる理由 |
| `space_mysteries` | 宇宙の謎 |
| `city_origins` | 街が今の形になった理由 |

### 質問ID・選択肢ID

| 質問ID | 選択肢IDと意味 | 選択数 |
| --- | --- | --- |
| `interest` | `create`：何かをつくる・つくってみたい / `think_deeply`：考える・深く知りたい / `explore_unknown`：知らない世界をのぞきたい / `people_society`：人や社会のことを知りたい / `none`：特にない・なんとなく | 1 |
| `themes` | 大ジャンルID（`phi`・`his`・`soc`・`sci`・`tec`・`mon`・`art`・`lan`・`lit`）、または `omakase`（おまかせ） | 1〜9、または `omakase` だけ |
| `reading_experience` | `new_perspective`：新しい視点に出会う / `learn_knowledge`：知らない知識が増える / `deepen_thought`：考えが深まる・整理される / `immerse_story`：物語の世界に没頭する | 1 |
| `curiosity` | `music_emotions`・`space_mysteries`・`city_origins` | v2で `interest=none` のとき1〜3 |

### 検証ルール

- 本文は最大8 KiB。`answers` は、`onboarding-v1` は3件、`onboarding-v2` は `interest=none` なら4件、それ以外は3件。同じ `questionId` と同じ選択肢IDの重複は拒否する。
- `onboarding-v1` は `interest`・`themes`・`reading_experience` の3問が必須。他の質問IDは受け付けない。
- `onboarding-v2` はv1の3問に加え、`interest=none` の場合だけ `curiosity` が必須で1〜3個。それ以外の場合は `curiosity` を送らない。
- `themes` は大ジャンルを1〜9個、または `omakase` だけを選ぶ。`omakase` と個別テーマを同時に選ばない。
- JSONとして解釈できるが、型・形状・必須・enum・件数が不正な場合は `422` `VALIDATION_ERROR`。`details` に `INVALID_REQUEST_SHAPE` や `ANSWERS_COUNT_OUT_OF_RANGE` などを入れる。
- 未知の質問・選択肢、未回答を表す空配列は `422` `VALIDATION_ERROR`。未知の質問票の版は `422` `UNSUPPORTED_QUESTIONNAIRE_VERSION`。`null` を選択肢の代わりに送らない。seedは星IDを受け取らないため、星の存在確認はGETのpathで行う。
- 回答配列の順序は意味を持たない。星の選出と説明に用いるのはIDの意味と選択内容。
- 質問ID・選択肢・分岐条件が変わる場合は、新しい質問票の版を共有してから公開する。文面の誤字修正など意味の変わらない修正は同じ版でよい。
- 新しい版は、バックエンドがその版を受理できる状態を先に公開し、疎通確認後にフロントが送信を開始する。移行中はv1とv2の両方を受理し、保存されたv1の回答を勝手にv2として送信しない。
- 質問票定義の正本は `contracts/questionnaires/<version>.json`。フロントとバックエンドは同じ定義を参照する。
- 不正な入力では外部サービスを呼ばない。

## 6. seedのレスポンスと星の選出

LambdaがBedrockに回答を渡し、星カタログの大ジャンル9ID（`phi`・`his`・`soc`・`sci`・`tec`・`mon`・`art`・`lan`・`lit`）から異なる3個と、各星の検索語を1回で選ばせる。

成功例（架空）：

```json
{
  "requestId": "example-seed-001",
  "themes": [
    { "themeId": "tec", "searchQuery": "プログラミング ものづくり 入門" },
    { "themeId": "mon", "searchQuery": "デザイン 発想 入門" },
    { "themeId": "phi", "searchQuery": "哲学 新しい視点 入門" }
  ]
}
```

| 項目 | 型 | ルール |
| --- | --- | --- |
| `requestId` | string | 問い合わせ・ログ照合用 |
| `themes` | array | 必ず3件。おすすめ順。先頭を初期選択にする |
| `themes[].themeId` | string | 大ジャンル9IDのいずれか。重複不可 |
| `themes[].searchQuery` | string | LambdaがAIの生出力をtrimして返す。返却値は前後の空白を含まず、1〜128文字 |

- 名称・座標・色・明るさは返さない。星の名称は共有カタログから、配置・色・描画はフロントから解決する。
- 検索語はLambdaがAI出力をtrimし、前後の空白を除いた値を返す。AI出力の前後に空白があっても、そのまま応答へ含めない。応答値は常に1〜128文字とする。
- AIが未定義ID・重複ID・不正な検索語・不正な件数を返した場合、無条件で画面へ流さない。`502` `DISCOVERY_UPSTREAM_ERROR` を返す。
- AIの停止・スロットリングなどで選出できない場合は `503` `DISCOVERY_UNAVAILABLE`、タイムアウトは `504` `UPSTREAM_TIMEOUT`。
- フロントの点数方式への隠れたfallbackは行わない。seedが失敗した画面は星を表示せず、再試行を案内する。
- 検索語はseedで確定する。GETで検索語をAIに再生成させない。

### 時間配分（seed）

| 処理 | 上限 |
| --- | --- |
| Bedrockの星・検索語選出 | 15秒 |
| API全体の処理期限 | 25秒 |
| フロントの待機上限 | 30秒 |

以下は設計値で、実測値ではない。各上限にはSDK内の待ち時間も含める。AI処理が15秒を超えたら `504`。全体の期限に達した場合も `504` とし、応答のための時間を残して打ち切る。

## 7. 書籍取得のリクエスト

```http
GET /v1/themes/tec/books?q=%E3%83%97%E3%83%AD%E3%82%B0%E3%83%A9%E3%83%9F%E3%83%B3%E3%82%B0%20%E5%85%A5%E9%96%80
X-Discovery-Context: {"questionnaireVersion":"onboarding-v1","answers":[{"questionId":"interest","selectedOptionIds":["create"]},{"questionId":"themes","selectedOptionIds":["tec","mon"]},{"questionId":"reading_experience","selectedOptionIds":["new_perspective"]}]}
```

| 対象 | ルール |
| --- | --- |
| path `themeId` | 既存15ID（大ジャンル9・中ジャンル6）のいずれか。未知のIDは `422` `VALIDATION_ERROR` で、`details[]` に `field: "themeId"`・`code: "UNKNOWN_THEME_ID"` を入れる |
| query `q` | 必須。seedから受け取った `searchQuery` を指定。trim後空不可、128文字以内。不正は `422` `VALIDATION_ERROR` |
| header `X-Discovery-Context` | 必須。`JSON.stringify({ questionnaireVersion, answers })`。最大4 KiB |

- GETの本文は使わない。回答はヘッダーだけに含め、URL・ログには載せない。
- ヘッダーは `questionnaireVersion` と `answers` だけを持つASCIIのJSON文字列。質問ID・選択肢ID・版名はASCIIの既知IDに限る。
- このヘッダーは認証トークンでもセッションでも、seedを呼んだ事実の証明でもない。信用済みデータとして扱わず、文字列をJSON解析して、seed本文と同じ共有回答条件で毎回検証する。
- seedに含まれない子ジャンルなど、seedの検索語がない星を探索するときは、`contracts/themes.json` の基本検索語を `q` に指定できる。
- ヘッダーの欠落、`questionnaireVersion`・`answers` の型・形状・版ごとの回答条件の不正は `422`。未知の版だけ `UNSUPPORTED_QUESTIONNAIRE_VERSION`、それ以外は `VALIDATION_ERROR`。
- ヘッダー欠落時の `422` `VALIDATION_ERROR` は、`details[]` に `field: "X-Discovery-Context"`・`code: "INVALID_REQUEST_SHAPE"` を入れる。
- ヘッダーのJSON解析失敗は `400` `INVALID_CONTEXT_JSON`。4 KiB超過は `431` `CONTEXT_TOO_LARGE`。
- 不正な入力では外部サービスを呼ばない。
- CORSの許可ヘッダーに `X-Discovery-Context` を追加する。
- クライアント内キャッシュのキーは「質問票の版＋回答＋themeId＋q」とする。回答が変わったら再利用しない。

## 8. 書籍取得のレスポンス

以下は架空の書籍を使ったJSON例。実在するGoogle Booksの検索結果ではない。

```json
{
  "requestId": "example-request-001",
  "themeId": "tec",
  "items": [
    {
      "id": "example-volume-001",
      "source": "google_books",
      "title": "はじめてのプログラミングと発想",
      "authors": ["サンプル著者"],
      "coverUrl": null,
      "description": "身近な題材を使って、プログラムを作る考え方を紹介する入門書です。",
      "recommendationReason": "「何かをつくってみたい」を選んだあなたに、身近な題材から制作を始めるきっかけとしておすすめします。技術を使ったものづくりの見方に触れられる一冊です。",
      "infoUrl": null
    }
  ],
  "warnings": []
}
```

| 項目 | 型 | 表示・用途 |
| --- | --- | --- |
| `requestId` | string | 問い合わせ・ログ照合用。通常の書籍カードには出さない |
| `themeId` | string | リクエストと同じ星ID |
| `items` | array | 0〜5冊。返された順に表示する |
| `items[].id` | string | Google Booksのvolume ID。ISBNではない |
| `items[].source` | string | MVPでは `google_books` 固定 |
| `items[].title` | string | 書名。空文字にしない |
| `items[].authors` | string[] | 著者。不明なら `[]` |
| `items[].coverUrl` | string / null | 表紙。不明または安全に表示できるHTTPS URLがない場合は `null` |
| `items[].description` | string / null | Google Books由来の内容紹介。HTMLを除き、最大1,000文字に整形 |
| `items[].recommendationReason` | string / null | AIが作る個別のおすすめ理由。根拠不足、生成・検証失敗時は `null` |
| `items[].infoUrl` | string / null | Google Booksの詳細リンク。取得できなければ `null` |
| `warnings` | array | 部分的な失敗。正常時は `[]`。各要素は `code` と表示用の `message` |

項目は欠落させず、上表の `null` または空配列を使う。書籍ID・書名のない候補は返さない。`infoUrl` はHTTPSのGoogle Books公式ページのみ採用し、不適切なURLは `null` とする。`coverUrl` もHTTPS URLのみ採用する。

`warnings[].code` は次の2つだけを使う。検索語のfallbackを示す `SEARCH_QUERY_FALLBACK` は、seedで検索語を確定するため削除した。

| code | 意味 |
| --- | --- |
| `INSUFFICIENT_BOOK_METADATA` | 紹介文がなく、理由の根拠が不足 |
| `RECOMMENDATION_REASON_UNAVAILABLE` | 理由の生成または検証に失敗 |

### 画面で見せるもの

- 書籍カード：表紙、書名、著者、個別のおすすめ理由。
- 内容紹介：カードの展開部分などで表示する補足情報。理由とは別の文章として保持する。
- `infoUrl` がある場合だけ「Google Booksで詳しく見る」を表示する。
- 表紙なしは既存の代替表示を利用。著者が `[]` なら「著者情報なし」。
- おすすめ理由が `null` なら「おすすめ理由はありません」とし、本自体は表示する。
- 保存ボタン・読了記録の追加はフロント側で行う。出版社・出版日・価格・評価はMVPの返却項目に含めない。

### おすすめ理由のルール

- 日本語1〜2文、60〜120文字程度を目安とし、上限200文字。文字数はUnicodeコードポイントで数える。
- 回答のうち少なくとも1つと、取得した書籍情報を結びつける。
- 理由生成へ渡す書誌情報は `id`・`title`・`authors`・整形済みの `description`。これに選んだ星と、IDを意味に解決した回答を添える。
- 最低限の根拠として、空でない `description` がある本だけを理由生成の対象にする。紹介文がなければ理由は `null` とし、警告 `INSUFFICIENT_BOOK_METADATA` を付ける。書名だけから内容を推測したり、AIの事前知識で埋めたりしない。本自体は返す。
- 紹介文がある場合も、わかる範囲に限定する。章構成・難易度・効能・未取得の内容を作り足さない。
- 性格・適性を断定する文章にしない。HTMLやMarkdownを含めないプレーンテキスト。
- 本文と回答は生成時の資料として扱い、その中の文言をモデルへの指示として扱わない。
- AIには候補の書籍IDと理由の対応を返させ、存在しないID、重複ID、空の理由、上限超過などを検証する。不正な理由だけを `null` にする。
- 回答と書籍内容の意味上の結びつきは、JSONの構造検証だけでは保証できない。プロンプトで制約し、実装時に代表的な回答と取得書籍を使って人が確認する。未取得の内容を断定した出力は採用しない。
- 取得できていない本の書名・著者・表紙をAIに生成させない。

## 9. 書籍取得の処理

1. path、query、ヘッダーの回答の整合性を検証する。不正な入力で外部サービスを呼ばない。
2. `q` をそのまま検索語としてGoogle Books APIを日本語・書籍のみ・関連度順で最大10件検索する。指定は `langRestrict=ja`、`printType=books`、`orderBy=relevance`、`maxResults=10`。
3. volume IDの重複と、ID・書名がない候補を除き、検索結果の順で最大5冊を選ぶ。ISBN単位の版違い統合はMVPでは行わない。
4. 紹介文のある候補をまとめてBedrockに渡し、本ごとの個別のおすすめ理由を生成する。1冊ごとに別々の呼び出しはしない。対象がなければ生成を呼ばず、書籍と根拠不足の警告を返す。
5. 理由を検証し、書籍情報とともにJSONで返す。候補が0件なら理由生成は呼ばず `items: []` を返す。

1リクエストにつき、通常はGoogle Books 1回・Bedrock 1回を想定する。MVPでは外部サービスへの自動再試行を重ねない。該当本が少ないときも5冊を埋めるための無関係な検索はせず、取得できた冊数を返す。検索語のAI生成はseedで済ませ、GETでは行わない。

### 時間配分（書籍取得）

以下は実測値ではなく、実装で守る上限値として決定した値。

| 処理 | 上限 |
| --- | --- |
| 書籍検索 | 6秒 |
| 理由生成 | 10秒 |
| API全体の処理期限 | 25秒 |
| フロントの待機上限 | 30秒 |

各上限にはSDK内の待ち時間も含め、残りの時間は検証・整形・応答などの余裕に使う。各処理には、その上限と全体の残り時間の短い方を適用する。

書籍検索が6秒を超えたら、全体が25秒未満でも `504` にする。理由生成が10秒または全体の期限に達したら、取得済みの本を `200` の部分成功で返す。全体の期限に達したときも、有効な書籍を取得済みなら `200`、取得できていなければ `504` とし、応答のための時間を残して処理を打ち切る。

Bedrockのスロットリング・一時停止は理由生成の失敗として扱い、書籍が取得できる限り `200` と警告へ落とす。GETの理由生成失敗に `503` は割り当てない。実装後、利用モデルと接続先の制約を確認し、実測して必要なら上限値を見直す。実測前の値を「実測済み」として扱わない。

## 10. 0件・部分成功・エラー

| 状況 | HTTP | レスポンスと画面 |
| --- | --- | --- |
| 正常 | `200` | 書籍とおすすめ理由を表示 |
| 検索が正常に終わり0件 | `200` | `items: []`。「別の星も探してみよう」と案内 |
| 紹介文がなく理由の根拠が不足 | `200` | 該当本の理由は `null`。警告 `INSUFFICIENT_BOOK_METADATA` |
| 一部または全部の理由生成に失敗 | `200` | 本は返す。該当本の理由は `null`。警告 `RECOMMENDATION_REASON_UNAVAILABLE` |
| seed本文をJSONとして解釈できない（パース失敗のみ） | `400` | `INVALID_JSON` |
| GETのコンテキストをJSONとして解釈できない | `400` | `INVALID_CONTEXT_JSON` |
| seed本文が8 KiB超過（Lambdaが受信時のバイト数で判定） | `413` | `PAYLOAD_TOO_LARGE` |
| seedのContent-Typeが未対応 | `415` | `UNSUPPORTED_MEDIA_TYPE` |
| 質問票の版が未対応 | `422` | `UNSUPPORTED_QUESTIONNAIRE_VERSION` |
| 型・形状・必須・enum・件数が不正 | `422` | `VALIDATION_ERROR`。`details` に `INVALID_REQUEST_SHAPE` / `ANSWERS_COUNT_OUT_OF_RANGE` など |
| 星ID・回答・検索語・必須条件が不正 | `422` | `VALIDATION_ERROR` |
| GETのコンテキストヘッダーが4 KiB超過 | `431` | `CONTEXT_TOO_LARGE` |
| リクエスト過多 | `429` | `RATE_LIMITED`。連打せず時間をおいて再試行 |
| seedのAI出力が不正（未定義ID・重複・不正検索語・不正件数） | `502` | `DISCOVERY_UPSTREAM_ERROR`。星を表示しない |
| Google Booksが失敗・不正な結果 | `502` | `BOOKS_UPSTREAM_ERROR`。0件扱いにしない |
| seedのAIが停止・スロットリング | `503` | `DISCOVERY_UNAVAILABLE`。再試行を案内 |
| seedのAIが15秒超過、書籍検索が6秒超過、または書籍取得前に全体期限へ到達 | `504` | `UPSTREAM_TIMEOUT` |
| 想定外の内部エラー | `500` | `INTERNAL_ERROR`。秘密情報や内部例外は本文に含めない |

### 部分成功の例

```json
{
  "requestId": "example-request-002",
  "themeId": "tec",
  "items": [
    {
      "id": "example-volume-001",
      "source": "google_books",
      "title": "はじめてのプログラミングと発想",
      "authors": [],
      "coverUrl": null,
      "description": "身近な題材を使って、プログラムを作る考え方を紹介する入門書です。",
      "recommendationReason": null,
      "infoUrl": null
    }
  ],
  "warnings": [
    {
      "code": "RECOMMENDATION_REASON_UNAVAILABLE",
      "message": "一部の本のおすすめ理由を取得できませんでした。"
    }
  ]
}
```

### アプリケーションエラーの共通形式

```json
{
  "requestId": "example-request-003",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "回答内容を確認してください。",
    "details": [
      {
        "field": "answers[1].selectedOptionIds",
        "code": "EXCLUSIVE_OPTION_CONFLICT"
      }
    ]
  }
}
```

`details` は対象がなければ `[]`。フロントの分岐には `error.code`、入力箇所の特定には `details` を使う。`details[].code` は `UNKNOWN_THEME_ID`・`UNKNOWN_QUESTION_ID`・`UNKNOWN_OPTION_ID`・`DUPLICATE_QUESTION_ID`・`DUPLICATE_OPTION_ID`・`EMPTY_SELECTION`・`SELECTION_COUNT_OUT_OF_RANGE`・`EXCLUSIVE_OPTION_CONFLICT`・`MISSING_REQUIRED_QUESTION`・`FORBIDDEN_QUESTION` など。全列挙はOpenAPIの `ErrorDetail` を正本とする。

アプリケーションとして `503` を定義するのはseedの `DISCOVERY_UNAVAILABLE` だけとし、GETのBedrock理由生成失敗には割り当てない。API Gateway等が返す `429`・`503` などのエラーや通信断では、このJSONがない場合もあるため、フロントはHTTPステータスと一般的な通信エラー表示でも扱えるようにする。

## 11. 現在のフロントからの変更点

| 現在の実装 | 接続時の変更 |
| --- | --- |
| `calcScores`・`tiersFor` で星の明るさを計算 | 初期の星の選出はseedの結果を使う。点数計算で選出を置き換えない。配置・色・描画はフロントに残す |
| `OnboardingAnswers` が `q1`・`q2`・`q3` 固定 | 送信時に質問ID・選択肢IDへ変換。追加質問は回答配列に含める |
| 回答をURLから復元 | URLだけに依存せず、質問票の版・回答・seed結果をブラウザ保存して復元する |
| `booksForWorld` が固定の `BOOKS` を返す | seedとGETのAPI呼び出しに置き換え。固定データは開発用モックとして区別 |
| `Book.author` が文字列 | APIの `authors` を配列で扱う。既存型へ変換する場合は `join('、')` |
| `Book.coverUrl` は省略可能 | APIでは `null`。画面用の型を合わせるか、変換時に `undefined` にする |
| `Book.description` をカードに表示 | おすすめ理由を追加し、内容紹介と区別して表示 |
| `Book.worldIds` が固定で付いている | API結果とレスポンスの `themeId` を関連付ける。発見した星を保存記録に含める |

- seedの応答を待ってから星を表示する。失敗時は星を表示せず、再試行を案内する。フロントの点数方式へfallbackしない。
- 星を選ぶときは、`X-Discovery-Context` に `JSON.stringify({ questionnaireVersion, answers })` を設定する。認証情報や自由記述を入れない。
- 同じ本を複数の星で保存する場合は `(source, id)` で同一書籍とし、発見した星のIDを重複なく保持する。
- 星の切り替え時は前のリクエストを中止するか、古いレスポンスを無視し、別の星の本が表示されないようにする。
- 取得済み結果は画面内で再利用してよい。キーは「質問票の版＋回答内容＋星ID＋q」とし、回答を変更したら再利用しない。
- 再読み込み後に対応していない質問票の版が保存されていた場合は、質問への回答をやり直す。

## 12. 実装設定（API契約とは別）

以下はAPIの送受信契約ではなく、AWS側の実装設定。値が未選定のものは選定済み・実施済みとして扱わない。

- 構成は API Gateway HTTP API → Lambda → Google Books / Bedrock。
- ブラウザは `NEXT_PUBLIC_API_BASE_URL` で接続先を切り替える。値はAPIのルートURLで、フロントが `/v1/discovery/seed` と `/v1/themes/{themeId}/books` を付ける。
- Google BooksのAPIキーはバックエンドで保持する。ブラウザへ返さない。
- BedrockはLambdaのIAMロールで呼び出し、使用するモデル／推論プロファイルに必要な権限へ絞る。
- CORSはローカル開発と合意したVercelのオリジンを許可する。`GET`・`POST`、`Content-Type`、`X-Discovery-Context` を許可し、Cookieは使わない。HTTP APIのCORS設定でプリフライトに対応する。
- CORSは認証ではない。`X-Discovery-Context` も認証・セッションではない。公開APIとして呼ばれる前提で、GatewayのスロットリングとLambdaの同時実行上限を設定し、利用状況を監視する。
- 回答・推薦結果をアプリのDBに保存しない。ログは `requestId`、処理時間、件数、エラー種別を中心とし、回答全文・`X-Discovery-Context`・APIキー・生成プロンプト全文を記録しない。
- 外部サービスへの送信対象は選択回答と取得した書籍情報。ブラウザ内の読書メモや履歴は送らない。Bedrockの呼び出しログ設定も全文保存の有無を確認する。
- AWSリージョン、Bedrockモデル／推論プロファイル、実装言語、IaCツール、月額上限、レート設定値は未選定。API担当が実装開始時に具体化する。
- デプロイは別途承認を得て行う。

## 13. 受け入れ条件

- `onboarding-v1` の通常回答と「特になし」の3問回答をseedで受け取れる。
- `onboarding-v2` の「特になし＋curiosity」をseedで受け取れる。v1でcuriosityを送った場合、v2で必要なcuriosityが欠けた場合、v2で不要なcuriosityを送った場合は拒否する。
- seedが `themeId` なしで受け付けられ、異なる大ジャンル3個と、それぞれ空でない128文字以内の検索語を返す。AIの未定義ID・重複ID・不正検索語・不正件数を `502`、停止・スロットリングを `503` として扱い、点数方式のfallbackをしない。
- `GET /v1/themes/{themeId}/books` が本文なしで、必須の `q` と `X-Discovery-Context` を受け取れる。未知の星・不正な `q`・回答条件の不正を `422`、ヘッダーの解析失敗を `400`、4 KiB超過を `431` とする。
- 大・中ジャンルの星を検索でき、0件と外部APIの失敗を区別できる。
- 書籍情報の欠落・AIの不正なJSON・理由生成の一部失敗でも、第8節の形式を守り `200` で本を返す。
- 紹介文がない本を理由生成に渡さず、書籍情報は残して根拠不足の警告を返す。紹介文がある本の理由は、回答・書誌情報とのつながりを代表例で人が確認する。
- 不正なIDや版を拒否し、外部APIへ渡さない。旧 `POST /v1/books/recommendations` が存在せず、`SEARCH_QUERY_FALLBACK` を返さない。
- API接続時に、seedの待機・失敗、読み込み・成功・0件・理由なし・通信失敗を画面で確認する。
- モックで契約を確認し、使用するGoogle Books・Bedrockで疎通と処理時間を実測する。実測前の上限値を成功実績として扱わない。

## 14. ドキュメントと検証

OpenAPI・カタログ・Swagger UIは次のコマンドで扱う。いずれもドキュメント用で、アプリ本体の依存とは分離している。Node.js 22.12.0以上、npm 10以上を前提とする。

```sh
npm --prefix docs/swagger-ui ci --ignore-scripts
npm --prefix docs/swagger-ui run lint
npm --prefix docs/swagger-ui run check
npm --prefix docs/swagger-ui run serve
```

`docs/swagger-ui` は静的配布アセットのみのため、依存導入では `--ignore-scripts` を付け、不要なpostinstallを実行しない。グローバルのnpm設定は変更しない。これらのコマンドはリポジトリルートで実行する。

- `lint` はRedocly CLIでOpenAPIの形式・参照・exampleとスキーマの一致を検証する。
- `check` はカタログとOpenAPIのenum・選択数・版の一致、seed本文とGETコンテキストの回答例の意味条件、seed例の3ID一意性・大ジャンル・検索語、GETのpath・query・headerの必須、旧パスの不存在、未知の星・未知の選択肢・v2分岐の変異検出を確認する静的検証。本番バリデータではなく、APIの動作確認は行わない。
- `serve` は `http-server` で `docs/swagger-ui` を `127.0.0.1:8080` に配信する。Swagger UIはローカルアセットのみを使い、Try it outは無効。
- 今回の検証範囲は、仕様・JSON例の静的検証とローカルSwagger UIの表示確認。外部通信を伴うAPIテスト、AWS接続、デプロイは行っていない。

### 参考

- [Google Books：検索API](https://developers.google.com/books/docs/v1/reference/volumes/list) — 検索パラメータとページング。
- [Google Books：Volume](https://developers.google.com/books/docs/v1/reference/volumes) — 書誌情報、著者配列、画像、HTML形式の内容紹介。
- [Google Books：利用ガイド](https://developers.google.com/books/docs/v1/using) — 公開データ取得時のAPIキー等。
- [Amazon Bedrock：Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) — モデル呼び出し。
- [API Gateway HTTP API：CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html) — オリジンとプリフライトの設定。

外部仕様は2026-11-16に公式資料で確認。APIパス、件数、質問票ID、時間配分などは、ほしるべ向けに決定した契約値。
