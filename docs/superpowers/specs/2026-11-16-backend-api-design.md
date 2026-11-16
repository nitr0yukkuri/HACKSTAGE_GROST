# ほしるべ MVP：バックエンドAPI仕様（確定版）

作成日：2026-11-16

状態：確定（API契約 v1.0.0）。実装はこの契約に従う。

作業ブランチ：`feature/backend-infra`（`main` から分岐）

確認したフロント：`feature/frontend-MVP` の `771b1e7`

関連ファイル：

- 送受信契約の正本：[`docs/openapi.yaml`](../../openapi.yaml)（OpenAPI 3.0.3）
- 星ID・名称・親子関係・基本検索語：[`contracts/themes.json`](../../../contracts/themes.json)
- 質問票の正本：[`contracts/questionnaires/onboarding-v1.json`](../../../contracts/questionnaires/onboarding-v1.json)、[`onboarding-v2.json`](../../../contracts/questionnaires/onboarding-v2.json)
- ローカルSwagger UI：[`docs/index.html`](../../index.html)
- 静的検証：[`docs/scripts/check-contract.mjs`](../../scripts/check-contract.mjs)

## 1. 確定した仕様

- MVPはログインなし。ユーザーアカウント、Cookie、セッション管理、ユーザーDBを作らない。
- 質問への回答、保存した本、読了記録はブラウザ内に保存する。
- 星の決定と明るさの計算は、現在のフロントの点数方式（`calcScores`・`tiersFor`）を維持する。AIによる星の選定はMVPでは行わない。
- 業務APIは `POST /v1/books/recommendations` の1本。稼働確認は `GET /health`。
- 回答と選んだ星を受け取り、書籍を最大5冊返す。各書籍には、回答と書誌情報に基づく個別のおすすめ理由を付ける。
- おすすめ理由の生成に失敗した場合や根拠が不足する場合も、本自体は返す。理由は `null`、警告を `warnings` に含める。
- 質問票は `onboarding-v1` と `onboarding-v2` の両方を受理する。既存の3問画面は `onboarding-v1` で接続できる。
- 星は既存フロントの15ID（大ジャンル9・中ジャンル6）を使う。座標・色・明るさはフロントの表示関心事であり、API契約には含めない。
- APIは回答・推薦結果をアプリのDBに保存しない。

### 契約の正本の分担

| 対象 | 正本 |
| --- | --- |
| パス、HTTPステータス、JSONの構造、enum、上限 | `docs/openapi.yaml` |
| 星ID、名称、親子関係、基本検索語 | `contracts/themes.json` |
| 質問ID、選択肢ID、表示文言、選択数、必須・分岐条件 | `contracts/questionnaires/<version>.json` |
| 意味上の制約、処理、画面との分担 | この文書 |

今回のOpenAPIスキーマは、質問の組み合わせ・条件付き必須・排他選択・本文全体のバイト数を表現していない。これらは `description`・`x-validation-rules`・カタログに明記し、Lambdaで検証する。API Gateway HTTP APIは、インポートしたrequestBody/schemaを入力検証に使わないため、型・必須・enum・件数を含む構造検証もLambdaで行う（[HTTP APIのOpenAPI定義](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-open-api.html)）。

## 2. 採用した構成

| 案 | 星の決定 | 必要な業務API | 判断 |
| --- | --- | --- | --- |
| A：現在のフロントを活かす | フロントの点数計算 | 書籍推薦 | 採用 |
| B：点数計算をバックエンドへ移す | バックエンドの固定ルール | 星の決定＋書籍推薦 | 不採用 |
| C：企画書のAI選定方式 | Bedrockが回答から星を選ぶ | 星の決定＋書籍推薦 | 不採用 |

A案を採用する。動いている星空を活かし、書籍推薦とおすすめ理由の接続に集中する。星を決めるAPIはMVPでは作らない。

企画書にあった `POST /v1/discovery/seed` と `GET /v1/themes/{themeId}/books` は、この契約で置き換える。実装済みのAPIとしては扱わない。

## 3. フロントとバックエンドの分担

| フロント担当 | バックエンド・AWS担当 |
| --- | --- |
| 質問の表示、追加質問への分岐 | 回答IDと質問票の版の検証 |
| 回答のブラウザ保存 | 星・回答からの書籍検索 |
| 点数計算、星の色・明るさ・座標 | Google Booksの結果の整形 |
| 選んだ星と回答をAPIへ送信 | 本ごとのおすすめ理由の生成・検証 |
| 読み込み・0件・エラー・理由なしの表示 | 共通エラー、タイムアウト、ログ |
| 書籍の保存・読了記録、読了時の星座の更新 | API Gateway、Lambda、Bedrock、接続設定 |

質問終了時はAPIを待たずに星空を表示できる。最初に選択されている星の本をAPIで取得し、その後は星の選択時に取得する。

読了時にどの星を結ぶかは別の画面仕様として扱う。この文書では新しい星座の成長ルールを定義しない。

## 4. API一覧と共通ルール

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/v1/books/recommendations` | 回答に合う書籍とおすすめ理由を取得 |
| `GET` | `/health` | APIの稼働確認。外部サービスは呼ばない |

- HTTPS・JSON。POSTの `Content-Type` は `application/json`。
- ログイン・Cookie・フロントに埋め込むAPIキーは不要。
- 回答はリクエスト本文に含める。URLのクエリには含めない。
- 推薦レスポンスは `Cache-Control: no-store`。CDNなどで別の利用者に再利用しない。
- 成功・エラーともに、Lambdaが返すJSONには `requestId` を含める。
- `GET /health` の成功例は `{"status":"ok","requestId":"example-health-001"}`。外部APIやBedrockの利用可否まで保証するものではない。
- API Gateway HTTP APIは、インポートしたrequestBody/schemaで入力検証しない。型・必須・enum・件数を含む構造検証と、質問の組み合わせ・排他などの意味検証はLambdaで行う。
- APIサーバー（API Gateway・Lambda）は未実装。OpenAPIのサーバーURL `https://api.example.invalid` は契約参照用のプレースホルダーで、実在しない。
- ローカルSwagger UIは `http://127.0.0.1:8080/` で参照する。ローカルの `swagger-ui-dist` と同一オリジンの `/openapi.yaml` だけを読み、CDNや外部バリデータは使わない。Try it outは無効にしている。

## 5. 書籍推薦のリクエスト

### 通常の回答例（onboarding-v1）

```http
POST /v1/books/recommendations
Content-Type: application/json
```

```json
{
  "themeId": "tec-prog",
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
| `themeId` | string | 選んだ星。既存フロントの `World.id` と同じID |
| `questionnaireVersion` | string | 質問・選択肢の意味と検証ルールを識別する版。`onboarding-v1` または `onboarding-v2` |
| `answers` | array | 実際に回答した質問。表示しなかった質問は送らない |
| `questionId` | string | 質問の固定ID。表示順では識別しない |
| `selectedOptionIds` | string[] | 選択肢の固定ID。単一選択でも配列にする |

質問の文面や選択肢ラベルを毎回送る必要はない。バックエンドは共有した質問票定義でIDの意味を解決する。自由記述はMVPの対象外。

### 「特になし」の回答例

`onboarding-v1` では「特になし」を選んでも3問のまま送る。

```json
{
  "themeId": "sci",
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
  "themeId": "sci",
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
- JSONとして解釈できるが、型・形状・必須・enum・件数が不正な場合も `422` `VALIDATION_ERROR`。`details` に `INVALID_REQUEST_SHAPE` や `ANSWERS_COUNT_OUT_OF_RANGE` などを入れる。
- 未知の質問・選択肢・星、未回答を表す空配列は `422` `VALIDATION_ERROR`。未知の質問票の版は `422` `UNSUPPORTED_QUESTIONNAIRE_VERSION`。`null` を選択肢の代わりに送らない。
- 回答配列の順序は意味を持たない。おすすめの説明に用いるのはIDの意味と選択内容。
- 質問ID・選択肢・分岐条件が変わる場合は、新しい質問票の版を共有してから公開する。文面の誤字修正など意味の変わらない修正は同じ版でよい。
- 新しい版は、バックエンドがその版を受理できる状態を先に公開し、疎通確認後にフロントが送信を開始する。移行中はv1とv2の両方を受理し、保存されたv1の回答を勝手にv2として送信しない。
- 質問票定義の正本は `contracts/questionnaires/<version>.json`。フロントとバックエンドは同じ定義を参照する。

今回のOpenAPIスキーマは、質問の組み合わせ、条件付き必須、排他選択、本文のバイト数を表現していない。これらは上記のルールとして明記し、カタログを使ってLambdaで検証する。

### 使用できる星のID

大ジャンル（`parentId: null`）：

| 大ジャンル | ID | 現在の中ジャンルID |
| --- | --- | --- |
| 哲学 | `phi` | `phi-ethics`、`phi-intro` |
| 歴史 | `his` | なし |
| 社会 | `soc` | なし |
| 自然科学 | `sci` | なし |
| テクノロジー | `tec` | `tec-prog`、`tec-sec` |
| ものづくり | `mon` | `mon-design`、`mon-think` |
| 芸術 | `art` | なし |
| 言語 | `lan` | なし |
| 文学 | `lit` | なし |

中ジャンルは `phi-ethics`・`phi-intro`・`tec-prog`・`tec-sec`・`mon-design`・`mon-think` の6件。名称・親子関係・基本検索語は `contracts/themes.json` を正本とする。

`themeId` は大・中ジャンルのどちらも受け付ける。回答で選ばなかった星も探索できるため、`themes` に含まれていない星も指定できる。`psychology` など、現在のフロントにないIDはこの版では追加しない。

## 6. 書籍推薦のレスポンス

以下は架空の書籍を使ったJSON例。実在するGoogle Booksの検索結果ではない。

```json
{
  "requestId": "example-request-001",
  "themeId": "tec-prog",
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

## 7. バックエンドの処理

1. 本文、星ID、質問票の版、回答の整合性を検証する。不正な入力で外部サービスを呼ばない。
2. 星IDに対応する基本検索語を `contracts/themes.json` から取得する。例：`tec-prog` →「プログラミング 入門」。全15星に基本検索語を用意する。
3. Bedrockで、星と回答から検索語を作る。失敗時は基本検索語に戻して検索を続ける。検索語は空文字を禁止し、128文字以内に制限する。
4. Google Books APIを日本語・書籍のみ・関連度順で最大10件検索する。指定は `langRestrict=ja`、`printType=books`、`orderBy=relevance`、`maxResults=10`。
5. volume IDの重複と、ID・書名がない候補を除き、検索結果の順で最大5冊を選ぶ。ISBN単位の版違い統合はMVPでは行わない。
6. 紹介文のある候補をまとめてBedrockに渡し、本ごとの個別のおすすめ理由を生成する。1冊ごとに別々の呼び出しはしない。対象がなければ生成を呼ばず、書籍と根拠不足の警告を返す。
7. 理由を検証し、書籍情報とともにJSONで返す。候補が0件なら理由生成は呼ばず `items: []` を返す。

1リクエストにつき、通常はGoogle Books 1回・Bedrock最大2回を想定する。MVPでは外部サービスへの自動再試行を重ねない。該当本が少ないときも5冊を埋めるための無関係な検索はせず、取得できた冊数を返す。

### 時間配分（決定した上限値）

以下は実測値ではなく、実装で守る上限値として決定した値。

| 処理 | 上限 |
| --- | --- |
| 検索語生成 | 3秒 |
| 書籍検索 | 6秒 |
| 理由生成 | 10秒 |
| API全体の処理期限 | 25秒 |
| フロントの待機上限 | 30秒 |

各上限にはSDK内の待ち時間も含め、残りの約6秒は検証・整形・応答などの余裕に使う。各処理には、その上限と全体の残り時間の短い方を適用する。

検索語が3秒で作れなければ基本検索語へ戻す。書籍検索が6秒を超えたら、全体が25秒未満でも `504` にする。理由生成が10秒または全体の期限に達したら、取得済みの本を `200` の部分成功で返す。全体の期限に達したときも、有効な書籍を取得済みなら `200`、取得できていなければ `504` とし、応答のための時間を残して処理を打ち切る。

Bedrockのスロットリング・一時停止は各生成処理の失敗として扱い、書籍が取得できる限り `200` と警告へ落とす。実装後、利用モデルと接続先の制約を確認し、実測して必要なら上限値を見直す。実測前の値を「実測済み」として扱わない。

## 8. 0件・部分成功・エラー

| 状況 | HTTP | レスポンスと画面 |
| --- | --- | --- |
| 正常 | `200` | 書籍とおすすめ理由を表示 |
| 検索が正常に終わり0件 | `200` | `items: []`。「別の星も探してみよう」と案内 |
| 検索語のAI生成に失敗 | `200` | 基本検索語で検索。警告 `SEARCH_QUERY_FALLBACK` |
| 紹介文がなく理由の根拠が不足 | `200` | 該当本の理由は `null`。警告 `INSUFFICIENT_BOOK_METADATA` |
| 一部または全部の理由生成に失敗 | `200` | 本は返す。該当本の理由は `null`。警告 `RECOMMENDATION_REASON_UNAVAILABLE` |
| JSONとして解釈できない（パース失敗のみ） | `400` | `INVALID_JSON` |
| 本文が8 KiB超過（Lambdaが受信時のバイト数で判定） | `413` | `PAYLOAD_TOO_LARGE` |
| Content-Typeが未対応 | `415` | `UNSUPPORTED_MEDIA_TYPE` |
| 質問票の版が未対応 | `422` | `UNSUPPORTED_QUESTIONNAIRE_VERSION` |
| 型・形状・必須・enum・件数が不正 | `422` | `VALIDATION_ERROR`。`details` に `INVALID_REQUEST_SHAPE` / `ANSWERS_COUNT_OUT_OF_RANGE` など |
| 星ID・回答・必須条件が不正 | `422` | `VALIDATION_ERROR` |
| リクエスト過多 | `429` | `RATE_LIMITED`。連打せず時間をおいて再試行 |
| Google Booksが失敗・不正な結果 | `502` | `BOOKS_UPSTREAM_ERROR`。0件扱いにしない |
| 書籍検索の6秒上限、または書籍取得前に全体期限へ到達 | `504` | `UPSTREAM_TIMEOUT` |
| 想定外の内部エラー | `500` | `INTERNAL_ERROR`。秘密情報や内部例外は本文に含めない |

### 部分成功の例

```json
{
  "requestId": "example-request-002",
  "themeId": "tec-prog",
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

アプリケーションとして `503` は定義せず、Bedrockの失敗にも割り当てない。API Gateway等が返す `429`・`503` などのエラーや通信断では、このJSONがない場合もあるため、フロントはHTTPステータスと一般的な通信エラー表示でも扱えるようにする。

## 9. 現在のフロントからの変更点

| 現在の実装 | 接続時の変更 |
| --- | --- |
| `calcScores`・`tiersFor` で星の明るさを計算 | 維持。追加質問で点数を変える場合はフロント側で追加 |
| `OnboardingAnswers` が `q1`・`q2`・`q3` 固定 | 送信時に質問ID・選択肢IDへ変換。追加質問は回答配列に含める |
| 回答をURLから復元 | URLだけに依存せず、質問票の版と回答をブラウザ保存して復元する |
| `booksForWorld` が固定の `BOOKS` を返す | API呼び出しに置き換え。固定データは開発用モックとして区別 |
| `Book.author` が文字列 | APIの `authors` を配列で扱う。既存型へ変換する場合は `join('、')` |
| `Book.coverUrl` は省略可能 | APIでは `null`。画面用の型を合わせるか、変換時に `undefined` にする |
| `Book.description` をカードに表示 | おすすめ理由を追加し、内容紹介と区別して表示 |
| `Book.worldIds` が固定で付いている | API結果とレスポンスの `themeId` を関連付ける。発見した星を保存記録に含める |

- 同じ本を複数の星で保存する場合は `(source, id)` で同一書籍とし、発見した星のIDを重複なく保持する。
- 星の切り替え時は前のリクエストを中止するか、古いレスポンスを無視し、別の星の本が表示されないようにする。
- 取得済み結果は画面内で再利用してよい。キーは「質問票の版＋回答内容＋星ID」とし、回答を変更したら再利用しない。
- 再読み込み後に対応していない質問票の版が保存されていた場合は、質問への回答をやり直す。

## 10. 実装設定（API契約とは別）

以下はAPIの送受信契約ではなく、AWS側の実装設定。値が未選定のものは選定済み・実施済みとして扱わない。

- 構成は API Gateway HTTP API → Lambda → Google Books / Bedrock。
- ブラウザは `NEXT_PUBLIC_API_BASE_URL` で接続先を切り替える。値はAPIのルートURLで、フロントが `/v1/books/recommendations` を付ける。
- Google BooksのAPIキーはバックエンドで保持する。ブラウザへ返さない。
- BedrockはLambdaのIAMロールで呼び出し、使用するモデル／推論プロファイルに必要な権限へ絞る。
- CORSはローカル開発と合意したVercelのオリジンを許可する。`GET`・`POST` と `Content-Type` を許可し、Cookieは使わない。HTTP APIのCORS設定でプリフライトに対応する。
- CORSは認証ではない。公開APIとして呼ばれる前提で、GatewayのスロットリングとLambdaの同時実行上限を設定し、利用状況を監視する。
- 回答・推薦結果をアプリのDBに保存しない。ログは `requestId`、処理時間、件数、エラー種別を中心とし、回答全文・APIキー・生成プロンプト全文を記録しない。
- 外部サービスへの送信対象は選択回答と取得した書籍情報。ブラウザ内の読書メモや履歴は送らない。Bedrockの呼び出しログ設定も全文保存の有無を確認する。
- AWSリージョン、Bedrockモデル／推論プロファイル、実装言語、IaCツール、月額上限、レート設定値は未選定。API担当が実装開始時に具体化する。
- デプロイは別途承認を得て行う。

## 11. 受け入れ条件

- `onboarding-v1` の通常回答と「特になし」の3問回答を受け取れる。
- `onboarding-v2` の「特になし＋curiosity」を受け取れる。v1でcuriosityを送った場合、v2で必要なcuriosityが欠けた場合、v2で不要なcuriosityを送った場合は拒否する。
- 大・中ジャンルの星を検索でき、0件と外部APIの失敗を区別できる。
- 書籍情報の欠落・AIの不正なJSON・理由生成の一部失敗でも、第6節の形式を守る。
- 紹介文がない本を理由生成に渡さず、書籍情報は残して根拠不足の警告を返す。紹介文がある本の理由は、回答・書誌情報とのつながりを代表例で人が確認する。
- 不正なIDや版を拒否し、外部APIへ渡さない。
- API接続時に、読み込み・成功・0件・理由なし・通信失敗を画面で確認する。
- モックで契約を確認し、使用するGoogle Books・Bedrockで疎通と処理時間を実測する。実測前の上限値を成功実績として扱わない。

## 12. ドキュメントと検証

OpenAPI・カタログ・Swagger UIは次のコマンドで扱う。いずれもドキュメント用で、アプリ本体の依存とは分離している。Node.js 22.12.0以上、npm 10以上を前提とする。

```sh
npm --prefix docs ci --ignore-scripts
npm --prefix docs run lint
npm --prefix docs run check
npm --prefix docs run serve
```

`docs` は静的配布アセットのみのため、依存導入では `--ignore-scripts` を付け、不要なpostinstallを実行しない。グローバルのnpm設定は変更しない。

- `lint` はRedocly CLIでOpenAPIの形式・参照・exampleとスキーマの一致を検証する。
- `check` はカタログとOpenAPIのenum・選択数・版の一致、リクエスト例の意味条件、未知の星・未知の選択肢・v2分岐の変異検出を確認する静的検証。本番バリデータではなく、APIの動作確認は行わない。
- `serve` は `http-server` で `docs` を `127.0.0.1:8080` に配信する。Swagger UIはローカルアセットのみを使い、Try it outは無効。
- 今回の検証範囲は、仕様・JSON例の静的検証とローカルSwagger UIの表示確認。外部通信を伴うAPIテスト、AWS接続、デプロイは行っていない。

### 参考

- [Google Books：検索API](https://developers.google.com/books/docs/v1/reference/volumes/list) — 検索パラメータとページング。
- [Google Books：Volume](https://developers.google.com/books/docs/v1/reference/volumes) — 書誌情報、著者配列、画像、HTML形式の内容紹介。
- [Google Books：利用ガイド](https://developers.google.com/books/docs/v1/using) — 公開データ取得時のAPIキー等。
- [Amazon Bedrock：Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) — モデル呼び出し。
- [API Gateway HTTP API：CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html) — オリジンとプリフライトの設定。

外部仕様は2026-11-16に公式資料で確認。APIパス、件数、質問票ID、時間配分などは、ほしるべ向けに決定した契約値。
