# 元Docsに合わせたAPI仕様の復元 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. ユーザーは元のDocsの仕様に合わせて作るよう明示した。追加の確認待ちは行わず、下記の確定内容で修正する。

**Goal:** `cfb2b1b:docs/hoshirube.md` の「回答→Bedrockで星と検索語→GETで書籍取得」に合わせ、仕様・OpenAPI・検証を修正する。

**Architecture:** POST seedが回答を解釈して最初の星を選ぶ。GET booksが検索語でGoogle Booksを検索し、回答と取得書誌情報をもとに個別のおすすめ理由を付ける。フロントは星の選出を点数で置き換えず、APIの選出結果を描画する。

**Tech Stack:** 既存のOpenAPI 3.0.3 / docs用npm環境を再利用。依存の追加、実APIやLambda/AWSの実装・接続・デプロイは行わない。

**Spec:** Git履歴 `cfb2b1b:docs/hoshirube.md` と、この計画の具体化。既存の2026-11-16仕様のフロント点数方式・POST recommendations一本化はユーザーが否定したため置き換える。

## Global Constraints

- 作業ブランチは `feature/backend-infra`。READMEは一切編集せず、mainとのREADME差分ゼロを維持する。既存変更を破棄しない。
- DeepSeek V4.1 Flash 1017が実装。司令塔と別ThreadのDeepSeekが独立レビュー。Astra/free/他モデルへの無断切替なし。
- 今回の実装対象はAPI契約・Docs・サンプル・静的検証。API本体、AWS、フロント画面の実装は対象外。
- 元Docsに合わせて `POST /v1/discovery/seed` と `GET /v1/themes/{themeId}/books` を定義し、`GET /health` を残す。旧 `POST /v1/books/recommendations` は削除。互換aliasは作らない。
- 後続合意を維持する：質問票v1/v2、基本3問＋特になし時の追加質問、ログインなし・DBなし・ブラウザ保存、書籍最大5冊と個別のAIおすすめ理由。
- 質問票・星カタログの既存IDは変えない。元Docsのpsychologyは説明例で、現行の星ID正本はcontracts/themes.json。新しい星を勝手に追加しない。
- フロントの点数計算をAI選出の代替にしない。星の配置・色・描画はフロント。初期に選ぶ星はseedの結果を正とする。
- push/merge/deployやgit commitは実装担当が行わない。司令塔がレビュー後に既存の承認範囲でローカルコミットと同ブランチへの通常pushを行う。

## 決定した入出力・処理

### POST /v1/discovery/seed

- 本文 `{ questionnaireVersion, answers }`。既存の版別回答条件・8KiB上限・構造/意味の検証を再利用する。themeIdを要求しない。
- Bedrockが、星カタログの大ジャンル9IDから異なる3個と、各星の検索語を1回で選ぶ。
- 成功例：`{ "requestId":"example-seed-001", "themes":[{"themeId":"tec","searchQuery":"プログラミング ものづくり 入門"},{"themeId":"mon","searchQuery":"デザイン 発想 入門"},{"themeId":"phi","searchQuery":"哲学 新しい視点 入門"}] }`。
- 配列はおすすめ順で、最初の要素を初期選択する。各themeIdは既存の大ジャンルID、重複不可。名称・座標等は共有カタログ/フロントから解決する。
- 検索語はtrim後に空でなく128文字以内。AIが未定義ID・重複ID・不正検索語・不正件数を返したら無条件で画面へ流さず502 `DISCOVERY_UPSTREAM_ERROR`。AI停止/スロットリング等は503 `DISCOVERY_UNAVAILABLE`、タイムアウト504 `UPSTREAM_TIMEOUT`。フロント点数への隠れたfallbackは行わない。
- AI処理上限15秒、API全体25秒、フロント待機30秒（設計値、未実測）。不正入力では外部サービスを呼ばない。

### GET /v1/themes/{themeId}/books

- pathのthemeIdは既存15IDのいずれか。query `q` は必須、seedから受け取るsearchQueryを指定。trim後空不可、128文字以内。子ジャンルなどseedに含まれない星を探索するときはカタログの基本検索語をqに指定できる。
- GET本文は使わない。個別おすすめ理由に必要な回答は必須の `X-Discovery-Context` ヘッダーへ `JSON.stringify({ questionnaireVersion, answers })` として送る。バージョン・回答IDのみのASCIIのJSON文字列であり、認証トークンでも信用済みデータでもない。文字列をJSON解析して同じ共有回答条件で検証する。回答全文をURLやログへ載せない。
- ヘッダーは最大4KiB。欠落/型や版別回答条件の不正は422（未知版だけUNSUPPORTED_QUESTIONNAIRE_VERSION、それ以外VALIDATION_ERROR）。ヘッダーJSONの解析失敗は400 `INVALID_CONTEXT_JSON`、4KiB超過は431 `CONTEXT_TOO_LARGE`。q不正・themeId不正も422。
- Google Books検索（q、langRestrict=ja、printType=books、relevance、最大10候補）→既存の整形・重複除外→最大5冊→紹介文のある本だけBedrockで個別の理由をまとめて生成。検索語のAI生成はseedで済ませ、GETで再生成しない。
- BookItem、RecommendationResponse（requestId/themeId/items/warnings）、null/空文字の扱いは既存を維持。取得本の紹介文を根拠とし、回答との意味上の関連はprompt＋代表例の人手確認。理由失敗でも本は200で返す。
- `SEARCH_QUERY_FALLBACK` は不要になるため削除。警告は `INSUFFICIENT_BOOK_METADATA` と `RECOMMENDATION_REASON_UNAVAILABLE`。
- Google Books失敗502 `BOOKS_UPSTREAM_ERROR`、書籍検索6秒超過504 `UPSTREAM_TIMEOUT`。理由生成10秒、API全体25秒で、書籍取得済みなら理由null＋警告の部分成功。GETの理由生成のBedrock失敗に503は割り当てない。
- `Cache-Control: no-store`。CORSにX-Discovery-Contextを追加。クライアント内キャッシュキーは版＋回答＋themeId＋q。ヘッダーの回答は毎回検証し、seedを呼んだ事実の証明として扱わない。

### 共通

- 400はseed本文のJSON解析失敗（INVALID_JSON）、またはGETのコンテキストJSON解析失敗（INVALID_CONTEXT_JSON）。解析可能な型/形状/enum/必須/件数不正は422。メディアタイプ415・本文413はseedのみ。GETのヘッダーサイズ431は別定義。
- HTTP API Gatewayはschemaで入力検証しない。構造と意味の両方をLambdaで検証する。Gateway由来のエラーは共通JSONでない場合がある。
- API契約info.versionは2.0.0へ更新し、旧仕様からの破壊的な変更と明示。URLの/v1と質問票のv1/v2は別の版であり、元DocsのURLを維持する。

## Review Focus

- seedがthemeIdなしで受け付けられ、3個の大ジャンルIDと検索語を返すこと。選出をフロント点数へ戻さない。
- GETがbodyを持たず、qとヘッダーの回答で検索・個別理由の双方を実現すること。
- seedだけの503と、GETの理由失敗時200が混ざらないこと。古い検索語fallback警告・POST専用の仮定を残さない。
- 既存の質問票v1/v2・星ID・書誌フィールド・README保護を壊さないこと。
- 元Docsとの対応と後続合意の追加点がDocsとSwaggerで一貫すること。

## Task 1: 仕様・OpenAPI・静的検証を一括修正

**変更対象:** docs/openapi.yaml、docs/hoshirube.md、docs/backend-guide.md、docs/superpowers/specs/2026-11-16-backend-api-design.md、docs/scripts/check-contract.mjs。必要ならdocs/index.htmlの表示文言のみ。既存catalogのIDや質問内容は変更しない。README禁止。依存追加なし。旧planは履歴として残す。

- [x] 元Docsをgit showで読み、製品の目的と体験の記述を保ちながら、AIによる星選出と元の2つの業務APIを戻す。上記の後続合意とヘッダー補完を説明する。
- [x] OpenAPIのパス・schema・header/query/body・全成功/エラー例を整える。seedはv1通常/特になし・v2分岐の4例、GETはqとヘッダーの例、0件/理由なし等、seed不正AIや503等を含める。応答のmax5/minLength/nullableを維持する。
- [x] 静的checkerを新しいPOST seedとGET booksに合わせる。共有質問票の整合、seed本文とGETコンテキスト例の意味条件、seed例の3ID一意性/大ジャンル/検索語、GET path/query/headerの必須、両業務APIのstatusを確認する。旧パスが存在しないことも検査する。汎用バリデータを作らない。
- [x] 手順書に、同じ回答をseed本文とGETヘッダーに送る簡潔なfetch例を記載する。qはURLSearchParamsでエンコード。画面はseed完了を待って星を表示し、失敗時は再試行を案内する。
- [x] `npm --prefix docs run lint`、`npm --prefix docs run check`、git diff --check、READMEがbaseと同じblobであることを確認。seed重複/未定義ID/空q、不正な質問・v2分岐の否定ケースも対象を絞って確認する。
- [x] 実装結果と実行コマンド/実出力を指定reportへ記録。コミットせず報告する。司令塔と別ThreadのDeepSeekが同じ仕様と差分でレビューし、必要な修正後にpushする。
