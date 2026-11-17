# ほしるべ API の使い方

API の送受信契約・意味条件・処理は [`openapi.yaml`](openapi.yaml) を正本とする。この文書は起動・検証方法、呼び出し例、フロント接続時の注意、未選定の実装設定だけをまとめる。API 一覧・全 JSON・全エラー・enum は繰り返さない。

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
- API サーバー（API Gateway・Lambda）と AWS リソースは未実装。`https://api.example.invalid` は実在しないプレースホルダーで、契約参照専用。外部通信を伴う API テストやデプロイは行わない。

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
- seed の応答を待ってから星を表示し、フロントは 30 秒で待機を打ち切る。星を切り替えたら前のリクエストを中止するか古い応答を無視する。
- 取得済み結果を画面内で再利用するときのキーは「質問票の版＋回答内容＋星 ID＋q」。回答が変わったら再利用しない。
- 再読み込み後、保存された質問票の版が未対応なら回答をやり直す。保存済みの v1 回答を勝手に v2 として送らない。

## 実装時の設定

以下は API 契約ではなく AWS 側の実装メモ。未選定の値は選定済み・実施済みとして扱わない。

- 構成は API Gateway HTTP API → Lambda → Google Books / Bedrock。ブラウザは `NEXT_PUBLIC_API_BASE_URL` で接続先を切り替える。
- Google Books の API キーはバックエンドで保持し、ブラウザへ返さない。Bedrock は Lambda の IAM ロールで呼び、使用するモデル／推論プロファイルに必要な権限へ絞る。
- CORS はローカル開発と合意した Vercel のオリジンを許可し、`GET`・`POST`・`Content-Type`・`X-Discovery-Context` を許可する。Cookie は使わない。CORS は認証ではないため、Gateway のスロットリングと Lambda の同時実行上限を設定して監視する。
- 回答・推薦結果はアプリの DB に保存しない。ログは `requestId`・処理時間・件数・エラー種別を中心とし、回答全文・`X-Discovery-Context`・API キー・生成プロンプト全文を記録しない。Bedrock の呼び出しログ設定も全文保存の有無を確認する。
- 外部サービスへ送るのは選択回答と取得した書籍情報だけ。ブラウザ内の読書メモや履歴は送らない。
- AWS リージョン、Bedrock モデル／推論プロファイル、実装言語、IaC ツール、月額上限、レート設定値は未選定。実 API の疎通・処理時間・意味関連の代表例確認は未実施。デプロイは別途承認を得て行う。
