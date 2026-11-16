# ほしるべ MVP：バックエンド・API仕様の提案

作成日：2026-11-16

状態：チーム相談用の提案。下記の「確定した前提」以外は、採用を提案する内容です。

作業ブランチ：`feature/backend-infra`（`main` から分岐）

確認したフロント：`feature/frontend-MVP` の `771b1e7`

## 1. チームに提案したいこと

> MVPでは、星空の表示と興味の点数計算は、現在のフロントの実装を活かしたいです。
> 星を選んだら「選んだ星のID」と「質問への回答」をバックエンドに送り、本を最大5冊返す構成を提案します。
> 各書籍には、書名・著者・表紙に加えて、その人の回答に合ったAIのおすすめ理由を付けます。
> 質問は基本3問程度ですが、「特になし」のあとの追加質問にも対応できるよう、回答を配列で送ります。
> 質問・選択肢・星のIDをフロントとバックエンドで共有し、サンプルJSONをもとに並行開発したいです。

### 確定した前提

- MVPはログインなし。ユーザーアカウントとセッション管理は作らない。
- 質問への回答、保存した本、読了記録はブラウザ内に保存する。
- 書名・著者・表紙に加え、その人に合ったおすすめ理由をAIで作り、JSONで返して表示する。
- 質問は基本3問程度を想定。「特になし」を選んだ場合などに増える可能性がある。正確な文面・分岐は未確定。

### この文書で提案する判断

- 星の明るさは現在のフロントの点数方式を維持する。AIによる星の選定はMVPでは行わない。
- 業務APIは `POST /v1/books/recommendations` の1本から始める。
- AIは検索語の作成と、実際に取得した本のおすすめ理由の作成に使う。
- 1回のレスポンスは最大5冊。追加読み込み、購入価格・評価・ページ数の表示、書籍詳細APIは後回しにする。

## 2. 構成案の比較

| 案 | 星の決定 | 必要な業務API | 判断 |
| --- | --- | --- | --- |
| A：現在のフロントを活かす | フロントの点数計算 | 書籍推薦 | 推奨。動いている星空を活かし、本とおすすめ理由の接続に集中できる |
| B：点数計算をバックエンドへ移す | バックエンドの固定ルール | 星の決定＋書籍推薦 | 計算を一元管理できるが、MVPでは移植とAPI接続の作業が増える |
| C：企画書のAI選定方式 | Bedrockが回答から星を選ぶ | 星の決定＋書籍推薦 | 柔軟に選べるが、生成結果の検証、失敗時の代替処理、待ち時間が増える |

本書はA案を具体化した提案であり、チームが選択済みという意味ではありません。

既存の [企画書](../../hoshirube.md) にある `POST /v1/discovery/seed` と `GET /v1/themes/{themeId}/books` は、A案の採用時には置き換えます。採用前に企画書の記載を確定仕様として書き換えません。

## 3. フロントとバックエンドの分担

| フロント担当 | バックエンド・AWS担当 |
| --- | --- |
| 質問の表示、追加質問への分岐 | 回答IDと質問票の版の検証 |
| 回答のブラウザ保存 | 星・回答からの書籍検索 |
| 点数計算、星の色・明るさ・座標 | Google Booksの結果の整形 |
| 選んだ星と回答をAPIへ送信 | 本ごとのおすすめ理由の生成・検証 |
| 読み込み・0件・エラー・理由なしの表示 | 共通エラー、タイムアウト、ログ |
| 書籍の保存・読了記録、読了時の星座の更新 | API Gateway、Lambda、Bedrock、接続設定 |

読了時にどの星を結ぶかは別の画面仕様として決めます。本書では新しい星座の成長ルールを確定しません。

質問終了時はAPIを待たずに星空を表示できます。最初に選択されている星の本をAPIで取得し、その後は星の選択時に取得します。

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

## 5. 書籍推薦のリクエスト

### 通常の回答例

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
| `themeId` | string | 選んだ星。現在のフロントの `World.id` と同じIDを使う |
| `questionnaireVersion` | string | 質問・選択肢の意味と検証ルールを識別する版 |
| `answers` | array | 実際に回答した質問。表示しなかった質問は送らない |
| `questionId` | string | 質問の固定ID。表示順では識別しない |
| `selectedOptionIds` | string[] | 選択肢の固定ID。単一選択でも配列にする |

質問の文面や選択肢ラベルを毎回送る必要はありません。バックエンドは共有した質問票定義でIDの意味を解決します。自由記述はMVPの対象外です。

### 「特になし」の追加質問を含む例

追加質問を入れる版は `onboarding-v2` として分けます。以下は `curiosity` を追加する場合の具体案です。`onboarding-v1` の受理IDには追加しません。画面の文面・この追加質問案の採否は未確定です。

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

質問数そのものは3問に固定しません。ただし、未知の質問を無条件に受け入れる設計でもありません。質問を追加・変更する際は、フロントとバックエンドで質問票定義を共有します。

### 質問ID・選択肢IDのたたき台

現在のフロントは `q1`・`q3` に選択肢の位置番号を保存しています。APIには意味のあるIDに変換して送る案です。

| 質問ID | 現在の選択肢・意味 | APIで送る選択肢ID |
| --- | --- | --- |
| `interest` | q1=0：何かをつくる・つくってみたい | `create` |
| `interest` | q1=1：考える・深く知りたい | `think_deeply` |
| `interest` | q1=2：知らない世界をのぞきたい | `explore_unknown` |
| `interest` | q1=3：人や社会のことを知りたい | `people_society` |
| `interest` | q1=4：特にない・なんとなく | `none` |
| `themes` | q2：選んだ大ジャンル | 大ジャンルIDをそのまま使用 |
| `themes` | omakase=true：おまかせ | `omakase` のみ |
| `reading_experience` | q3=0：新しい視点に出会う | `new_perspective` |
| `reading_experience` | q3=1：知らない知識が増える | `learn_knowledge` |
| `reading_experience` | q3=2：考えが深まる・整理される | `deepen_thought` |
| `reading_experience` | q3=3：物語の世界に没頭する | `immerse_story` |
| `curiosity` | 音楽で気分が変わる理由（追加案） | `music_emotions` |
| `curiosity` | 宇宙の謎（追加案） | `space_mysteries` |
| `curiosity` | 街が今の形になった理由（追加案） | `city_origins` |

### 検証ルール

- 本文は最大8 KiB、`answers` は1〜10件。同じ `questionId` と同じ選択肢IDの重複は拒否する。
- `onboarding-v1` は `interest`・`themes`・`reading_experience` の3問が必須。他の質問IDは受け付けない。
- `interest` と `reading_experience` は各1つ。`themes` は大ジャンルを1〜9個、または `omakase` だけを選ぶ。
- `onboarding-v2` はv1の3問に加え、`interest=none` の場合だけ `curiosity` が必須で1〜3個。それ以外の場合は `curiosity` を送らない。既存の3問画面はv1で接続する。
- 未知の質問・選択肢・星・質問票の版、未回答を表す空配列は `422`。`null` を選択肢の代わりに送らない。
- 回答配列の順序は意味を持たない。おすすめの説明に用いるのはIDの意味と選択内容。
- 採用時に各版の定義を固定する。質問ID・選択肢・分岐条件が変わる場合は、新しい質問票の版を共有してから公開する。文面の誤字修正など意味の変わらない修正は同じ版でよい。
- 将来、追加質問で従来の必須質問を省略するなら、その分岐の必須条件も新しい版で定義する。APIパスやJSONの基本形は変えない。

質問票定義の正本は、実装時に追加する `contracts/questionnaires/<version>.json` とする提案です。質問ID・選択肢ID・表示文言・必須条件を置き、フロントとバックエンドが同じ定義を参照します。この文書の作成段階ではJSONファイルや読込処理は実装しません。

新しい版は、バックエンドがその版を受理できる状態を先に公開し、疎通確認後にフロントが送信を開始します。移行中はv1とv2の両方を受理し、保存されたv1の回答を勝手にv2として送信しません。

### 使用できる星のID

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

`themeId` は大・中ジャンルのどちらも受け付けます。回答で選ばなかった星も探索できるため、`themes` に含まれていない星も指定可能です。`psychology` など、現在のフロントにないIDはこの版では追加しません。

## 6. 書籍推薦のレスポンス

以下は架空の書籍を使ったJSON例です。実在するGoogle Booksの検索結果ではありません。

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

項目は欠落させず、上表の `null` または空配列を使います。書籍ID・書名のない候補は返しません。`infoUrl` はHTTPSのGoogle Books公式ページのみ採用し、不適切なURLは `null` とします。

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
2. 星IDに対応する基本検索語を取得する。例：`tec-prog` →「プログラミング 入門」。全15星に基本検索語を用意する。
3. Bedrockで、星と回答から検索語を作る。失敗時は基本検索語に戻して検索を続ける。検索語は空文字を禁止し、128文字以内に制限する。
4. Google Books APIを日本語・書籍のみ・関連度順で最大10件検索する。指定は `langRestrict=ja`、`printType=books`、`orderBy=relevance`、`maxResults=10`。
5. volume IDの重複と、ID・書名がない候補を除き、検索結果の順で最大5冊を選ぶ。ISBN単位の版違い統合はMVPでは行わない。
6. 紹介文のある候補をまとめてBedrockに渡し、本ごとの個別のおすすめ理由を生成する。1冊ごとに別々の呼び出しはしない。対象がなければ生成を呼ばず、書籍と根拠不足の警告を返す。
7. 理由を検証し、書籍情報とともにJSONで返す。候補が0件なら理由生成は呼ばず `items: []` を返す。

1リクエストにつき、通常はGoogle Books 1回・Bedrock最大2回を想定します。MVPでは外部サービスへの自動再試行を重ねません。該当本が少ないときも5冊を埋めるための無関係な検索はせず、取得できた冊数を返します。

時間配分の初期案は、検索語生成3秒・書籍検索6秒・理由生成10秒を各処理のハード上限とし、API全体の処理期限を25秒、フロントの待機上限を30秒とします。各上限にはSDK内の待ち時間も含め、残りの約6秒は検証・整形・応答などの余裕にします。各処理には、その上限と全体の残り時間の短い方を適用します。

検索語が3秒で作れなければ基本検索語へ戻します。書籍検索が6秒を超えたら、全体が25秒未満でも `504` にします。理由生成が10秒または全体の期限に達したら、取得済みの本を `200` の部分成功で返します。全体の期限に達したときも、有効な書籍を取得済みなら `200`、取得できていなければ `504` とし、応答のための時間を残して処理を打ち切ります。

これらは未実測の設計値です。利用モデルと接続先の制約を実装時に確認し、実測して調整します。Bedrockのスロットリング・一時停止は各生成処理の失敗として扱い、書籍が取得できる限り `200` と警告へ落とします。

## 8. 0件・部分成功・エラー

| 状況 | HTTP | レスポンスと画面 |
| --- | --- | --- |
| 正常 | `200` | 書籍とおすすめ理由を表示 |
| 検索が正常に終わり0件 | `200` | `items: []`。「別の星も探してみよう」と案内 |
| 検索語のAI生成に失敗 | `200` | 基本検索語で検索。警告 `SEARCH_QUERY_FALLBACK` |
| 紹介文がなく理由の根拠が不足 | `200` | 該当本の理由は `null`。警告 `INSUFFICIENT_BOOK_METADATA` |
| 一部または全部の理由生成に失敗 | `200` | 本は返す。該当本の理由は `null`。警告 `RECOMMENDATION_REASON_UNAVAILABLE` |
| JSONを解釈できない | `400` | `INVALID_JSON` |
| 本文が8 KiB超過 | `413` | `PAYLOAD_TOO_LARGE` |
| Content-Typeが未対応 | `415` | `UNSUPPORTED_MEDIA_TYPE` |
| 質問票の版が未対応 | `422` | `UNSUPPORTED_QUESTIONNAIRE_VERSION` |
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

`details` は対象がなければ `[]`。フロントの分岐には `error.code`、入力箇所の特定には `details` を使います。アプリケーションとして `503` は定義せず、Bedrockの失敗にも割り当てません。API Gateway等が返す `429`・`503` などのエラーや通信断では、このJSONがない場合もあるため、フロントはHTTPステータスと一般的な通信エラー表示でも扱えるようにします。

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
- 再読み込み後に対応していない質問票の版が保存されていた場合は、質問への回答をやり直す案とする。

## 10. AWS・接続設定の提案

- 構成は API Gateway HTTP API → Lambda → Google Books / Bedrock。
- ブラウザは `NEXT_PUBLIC_API_BASE_URL` で接続先を切り替える。値はAPIのルートURLで、フロントが `/v1/books/recommendations` を付ける。
- Google BooksのAPIキーはバックエンドで保持する。ブラウザへ返さない。
- BedrockはLambdaのIAMロールで呼び出し、使用するモデル／推論プロファイルに必要な権限へ絞る。
- CORSはローカル開発と合意したVercelのオリジンを許可する。`GET`・`POST` と `Content-Type` を許可し、Cookieは使わない。HTTP APIのCORS設定でプリフライトに対応する。
- CORSは認証ではない。公開APIとして呼ばれる前提で、GatewayのスロットリングとLambdaの同時実行上限を設定し、利用状況を監視する。
- 回答・推薦結果をアプリのDBに保存しない。ログは `requestId`、処理時間、件数、エラー種別を中心とし、回答全文・APIキー・生成プロンプト全文を記録しない。
- 外部サービスへの送信対象は選択回答と取得した書籍情報。ブラウザ内の読書メモや履歴は送らない。Bedrockの呼び出しログ設定も全文保存の有無を確認する。
- リージョン、Bedrockモデル／推論プロファイル、実装言語、IaCツール、月額上限、レート設定値は、実装開始前にAWS担当が具体化する。デプロイは別途承認を得て行う。

## 11. チームで確認する項目

各項目は、この文書の提案値を採用するか、変更するかを確認します。

- [ ] 星の決定はフロントの点数方式を維持し、星を決めるAPIはMVPでは作らない。
- [ ] 業務APIは `POST /v1/books/recommendations` の1本にする。
- [ ] 質問ID・選択肢ID・星ID・質問票の版を共有し、追加質問版はバックエンド先行で接続する。
- [ ] 基本3問と追加質問の文面・分岐・必須条件をフロント担当と確定する。
- [ ] 書籍は最大5冊。表紙・書名・著者・個別のおすすめ理由を主に表示する。
- [ ] AIの理由生成に失敗しても、本は表示できる仕様にする。
- [ ] 内容紹介・外部詳細リンクの表示位置はフロント担当が決める。

### 実装を受け入れる条件

- v1の通常回答を受け取れる。追加質問案を採用する場合は、v2の「特になし＋追加質問」もその版の条件で受け取れる。v1で追加質問を送った場合とv2で必要な追加回答が欠けた場合は拒否する。
- 大・中ジャンルの星を検索でき、0件と外部APIの失敗を区別できる。
- 書籍情報の欠落・AIの不正なJSON・理由生成の一部失敗でも、上記の形式を守る。
- 紹介文がない本を理由生成に渡さず、書籍情報は残して根拠不足の警告を返す。紹介文がある本の理由は、回答・書誌情報とのつながりを代表例で人が確認する。
- 不正なIDや版を拒否し、外部APIへ渡さない。
- API接続時に、読み込み・成功・0件・理由なし・通信失敗を画面で確認する。
- モックで契約を確認し、使用するGoogle Books・Bedrockで疎通と処理時間を実測する。未実測を成功扱いにしない。

## 12. 参考と確認範囲

- [Google Books：検索API](https://developers.google.com/books/docs/v1/reference/volumes/list) — 検索パラメータとページング。
- [Google Books：Volume](https://developers.google.com/books/docs/v1/reference/volumes) — 書誌情報、著者配列、画像、HTML形式の内容紹介。
- [Google Books：利用ガイド](https://developers.google.com/books/docs/v1/using) — 公開データ取得時のAPIキー等。
- [Amazon Bedrock：Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) — モデル呼び出し。
- [API Gateway HTTP API：CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html) — オリジンとプリフライトの設定。

外部仕様は2026-11-16に公式資料で確認。APIパス、件数、質問票ID、時間配分などは、ほしるべ向けの提案値です。アプリの実装・AWSへの接続・動作テストは、この文書の作成には含めていません。
