# API契約確定とSwagger UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バックエンド担当が決定したAPI契約をOpenAPI 3.0と共有カタログで固定し、ローカルのSwagger UIで参照できるようにする。

**Architecture:** 星の点数計算は現在のフロントに残す。API契約は `docs/openapi.yaml`、質問票・星のID定義は `contracts/`、背景・意味上の制約は既存のMarkdownに集約する。Swagger UIはローカル配布のアセットを使い、アプリのサーバーやAWSリソースは実装しない。

**Tech Stack:** OpenAPI 3.0.3、JSON、Swagger UI dist 5.35.0、Redocly CLI 2.79.0、http-server 14.1.1。docs配下の独立したnpmプロジェクトとlockfileで管理する。Node >=22.12.0、npm >=10。

**Spec:** `docs/superpowers/specs/2026-11-16-backend-api-design.md`。ユーザーが「仕様はこっちで全て決めちゃおう」と設計判断を委任したため、提案の確認待ちはせず、以下の判断で確定版にする。

## Global Constraints

- `feature/backend-infra` の現在のチェックアウトで作業する。ユーザーがこのブランチでの分離を指定済み。ブランチを切り替えない。
- DeepSeek V4.1 Flash 1017が実装し、別子Threadの同モデルと司令塔が独立してレビューする。free/Astra/他モデルへ切り替えない。
- push・merge・deployはしない。既存変更を破棄しない。バックエンドの実サービスも作らない。
- 業務APIは `POST /v1/books/recommendations`、稼働確認は `GET /health`。
- ログイン・Cookie・ユーザーDBなし。APIの回答は星ID・質問票の版・回答配列。最大5冊。理由は書籍紹介文を根拠に生成し、根拠不足や生成失敗ではnull＋警告で本自体を返す。
- starsは既存フロント771b1e7の15ID（大9・中6）。`themeId` はWorld.id、authorsは配列、coverUrl/description/recommendationReason/infoUrlはnullable。
- `onboarding-v1` はinterest/themes/reading_experienceの3問、v2はinterest=none時だけcuriosity必須で1〜3選択。それ以外でcuriosityを送らない。両版をサポートし、既存画面はv1で接続できる。
- v2のcuriosity選択肢はmusic_emotions（音楽で気分が変わる理由）、space_mysteries（宇宙の謎）、city_origins（街が今の形になった理由）。これをAPI契約として固定する。画面文言の調整は意味を変えない範囲で可能。
- 質問票定義の正本はcontracts/questionnaires/<version>.json。星ID・名称・親・基本検索語の正本はcontracts/themes.json。選択肢のIDや意味は既存仕様の表を使う。
- 外部通信を伴うAPIテスト・本番設定はしない。仕様・JSON例の検証とローカルSwagger UIの表示確認だけを今回の検証範囲とする。
- npmのキャッシュは `/private/tmp/hoshirube-npm-cache` を指定する。既存のユーザーキャッシュを修復・変更しない。

## Review Focus

- v1に追加質問を混ぜる／v2で必要な追加回答を欠く場合を、schemaで表せる範囲と将来のLambdaで検証する範囲に明確に分ける。
- questionIdの一意性・omakaseとの排他・版別必須条件が、OpenAPI 3.0だけで自動検証できるかのように書かない。
- nullable必須項目・理由なしの警告・0件例がOpenAPIの型に一致する。
- OpenAPIのenum・質問票のID・星ID・既存フロント771b1e7とのずれを検出できる。
- Swagger UIがローカルアセットとローカルYAMLを読み、実APIが未実装とわかり、ダミーサーバーへの実行を誘導しない。

---

### Task 1: 確定API契約とローカルドキュメントを一式作る

**Files:**
- Create: `docs/openapi.yaml` — 送受信契約の正本、OpenAPI 3.0.3。
- Create: `contracts/themes.json` — 15星のid/name/parentId/searchQuery。座標や色は入れない。
- Create: `contracts/questionnaires/onboarding-v1.json`, `contracts/questionnaires/onboarding-v2.json` — 各版のID・文言・選択肢・選択数・条件。
- Create: `docs/package.json`, `docs/package-lock.json`, `docs/redocly.yaml` — フロントとは独立したドキュメント用ツール。
- Create: `docs/index.html` — ローカルのswagger-ui-distから読み込むSwagger UI。
- Create: `docs/scripts/check-contract.mjs` — カタログとOpenAPIのenum/例/版/意味上の回答条件の整合確認。アプリの本番バリデータとして公開しない。
- Modify: `docs/superpowers/specs/2026-11-16-backend-api-design.md`, `docs/hoshirube.md`, `README.md` — 確定仕様と操作手順を反映。既存仕様書のパスは維持する。
- Modify/Create: `.gitignore` — node_modules等を除外。フロント側の将来のignoreと整合する汎用パターン。

**Interfaces:**
- Consumes: 既存仕様書全体と、`git show 771b1e7:frontend/src/types/hoshirube.ts` 等。作業ツリーにフロントを取り込まない。
- Produces: `npm --prefix docs ci --ignore-scripts`, `npm --prefix docs run lint`, `npm --prefix docs run check`, `npm --prefix docs run serve`。serveは127.0.0.1:8080、docsディレクトリを静的配信。
- docs npm依存は上記3パッケージを完全な版番号で固定する。YAMLをcheck-contractから読むために必要なら `yaml` を実際のレジストリで版確認して直接依存に追加し、lockfileへ固定してよい。
- Swagger UIのURLは `http://127.0.0.1:8080/`。YAMLは同一オリジンの `/openapi.yaml`。CDNは使わず、外部のvalidatorも無効にする。

- [x] **Step 1: 検証対象を固定する**

OpenAPIに、v1通常・v1特になし（3問のまま）・v2追加質問・v2特になし以外・成功・0件・理由生成失敗・根拠不足・入力不正の例を用意する。check-contractはカタログとenumの一致、質問票の版・一意な質問ID・選択数・omakase排他・v2分岐を検査する。壊した一時コピーに対して未知の星/未知の選択肢/不正なv2分岐の各1例を検出できることも確認する。レスポンスの必須項目・型などはRedoclyに任せ、汎用バリデータやカタログ完全文法検査、エラー定数の重複コピーは作らない。独自スクリプトはIDの整合と回答例の意味条件に責務を限定する。生成した値を同じ値と比較するだけのテストにしない。

- [x] **Step 2: 仕様と共有カタログを確定する**

既存仕様の提案・確認待ちの表現を確定仕様に変え、採用はA案と記録する。質問票v2を将来の未確定案ではなく対応契約とする。新しいIDには新しい版、バックエンド先行の順序を維持する。AWSのリージョン等はAPI契約とは別の実装設定として扱い、未選択の値を実施済みと書かない。hoshirube.md内の古いseed/GET検索とAI星選定の説明も現在の確定内容へ更新する。READMEからOpenAPI・Swagger・確定仕様に辿れるようにする。

- [x] **Step 3: OpenAPIを作る**

OpenAPI 3.0.3、info.version=1.0.0、security=[]。POSTのrequestBody必須。サーバーURLは未デプロイであることを明示した `https://api.example.invalid` とし、実在のAPIであるように見せない。v1/v2はoneOfと版のenumで表し、questionIdごとの選択肢enumを対応付ける。配列の上限・uniqueItems・必須・additionalProperties:falseを適切に定義し、3.0で表せない質問票の条件はdescription/x-validation-rulesとカタログで明記する。

レスポンスは既存仕様の全項目とstatus（200/400/413/415/422/429/500/502/504）を定義する。Gateway由来の429等はアプリの共通JSONとは限らないことを説明する。healthも定義する。nullを省略可能と取り違えない。本文8KiB制限はJSONSchemaのmaxLengthで代用しない。infoUrl/coverUrlのHTTPS条件、reason最大200文字、description最大1000文字、items最大5を反映する。重要な意味制約は文章でも正確に記述する。

- [x] **Step 4: ローカルSwagger UIと検証コマンドを用意する**

docs配下の依存をインストールしlockfileを作る。Redocly lintでOpenAPIの形式・参照・メディアタイプ例を検証する設定を入れる。Swagger UIはローカルアセットのみ、APIの未実装を説明し、supportedSubmitMethods=[]などでTry it outを無効にする。フロントのroot package.jsonは作らない。カスタムHTTPサーバーは書かずhttp-serverを使う。

- [x] **Step 5: 検証する**

Run: `npm --cache /private/tmp/hoshirube-npm-cache --prefix docs ci --ignore-scripts`

Run: `npm --prefix docs run lint` と `npm --prefix docs run check`

Expected: 終了0。lintで未解決参照や無効な例がない。checkで15星と2版のカタログが一致し、正例が通り不正例を検出する。

Run: `npm --prefix docs run serve` を起動し、HTTPで `/`・`/openapi.yaml`・SwaggerのJS/CSSが200になることを確認する。実APIは呼ばない。ブラウザでの表示確認は司令塔も行う。

Run: `git diff --check`

- [x] **Step 6: レビュー可能な状態で報告する**

実装担当はコミットしない。変更ファイル、検証コマンドと実出力、残る制限を指定されたreportファイルに記録する。司令塔と別ThreadのDeepSeekがレビュー後、必要な修正を実装担当へ戻す。問題解消後に司令塔がローカルコミットする。
