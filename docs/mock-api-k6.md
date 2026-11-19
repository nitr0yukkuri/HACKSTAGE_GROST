# ローカルAPIモックとk6

フロントのAPI接続を、AWSやGoogle Booksの認証情報なしで通し確認するためのローカル専用環境です。モックは質問票・星カタログの契約JSONを読み込み、seed・書籍取得・入力検証・CORS・エラー形式を実行します。応答する書籍は架空のfixtureです。

## 起動

Node.js 22.12.0以上を使い、リポジトリルートでモックを起動します。

```sh
npm run mock:api
```

デフォルトは `http://127.0.0.1:8787` です。ヘルス確認は `GET /health`。モックは外部サービスへ通信せず、アクセスログに回答本文・回答ヘッダー・検索語を出力しません。

フロントの画面から一連の操作を試す場合は、frontendのローカル環境ファイルに次を設定して再起動します。

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787
```

API URLを設定した状態ではseedまたは書籍取得に失敗しても固定データへ切り替えません。APIモックを停止したままこの設定を有効にすると、画面はエラーと再試行を表示します。API URLを外せばローカルデモへ戻ります。

## k6シナリオ

Grafana k6をインストールし、実行ファイルを `PATH` に追加したうえで、モックを起動した別ターミナルから実行します。

```sh
npm run k6:smoke
npm run k6:load
```

`k6:smoke` は、health・CORS preflight、v2通常回答、`interest=none` と追加質問、v1互換、3つの異なるseed星、seedから書籍取得、最大冊数と応答形式を確認します。回答の形・件数・質問ID・重複・選択数・選択肢・排他条件、JSON/Content-Type、本文とヘッダーの上限、検索語のUnicode文字数境界、不明な星、回答ヘッダーの欠落・形式、0件、部分警告も検査します。k6のcheck rateが100%でない場合は失敗します。

`k6:load` は seed → 先頭星の書籍取得を繰り返し、1から5 VUへ段階的に増やします。モック専用の目安として、check rate 100%、HTTP失敗率1%未満、応答時間p95 500ms未満・p99 1000ms未満を設定しています。この値はAWSや本番のSLOではありません。

任意のモック設定:

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `MOCK_API_HOST` | `127.0.0.1` | listenするホスト |
| `MOCK_API_PORT` | `8787` | listenするポート |
| `MOCK_API_ALLOWED_ORIGIN` | `*` | CORSの許可Origin |
| `MOCK_API_DELAY_MS` | `0` | 各API応答に足す待ち時間（画面のloading確認用） |
| `BASE_URL` | `http://127.0.0.1:8787` | k6の接続先 |

書籍APIに `q=__empty__` を渡すと0件、`q=__warning__` を渡すと部分警告を返します。これらはUI状態を手動確認するためのテスト用検索語です。

## 検証範囲

このモックとk6はHTTP契約・フロント接続・ローカルNodeサーバーの負荷を確認します。Google Booksの実データ・Bedrockの推薦・AWS API Gateway/Lambdaのタイムアウト、スロットリング、費用、同時実行、IAM、VercelからのCORSは検証しません。実APIの結合試験はバックエンドを配備し、専用の接続先で別途行う必要があります。
