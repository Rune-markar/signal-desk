# Signal Desk アーキテクチャ

## 方針

本稼働モードでは **Signal Deskを監視項目の正本** とします。ChatGPTはMCPツールを通じてSignal Deskへ登録・更新・実行できますが、監視予定、履歴、通知はSignal Desk側で管理します。

```text
ChatGPT ── OAuth 2.1 + MCP ─┐
                            v
PWA ── session cookie ── Cloudflare Worker ── D1
                              │                 ├─ monitors
                              │                 ├─ runs
                              │                 └─ notifications
                              ├─ Cron ── Workers AI / Responses API / Web source
                              └─ Web Push ── browser / installed PWA
```

ChatGPT Scheduled Tasksを正本にはしません。一般利用できるScheduled Tasksの一覧・履歴同期APIは確認できないため、既存タスクは画面で内容を確認して手動移行します。ChatGPT側の元タスクは、Signal Deskでの実行確認後に利用者が停止します。

## 2つの動作モード

### ローカル試作モード

GitHub Pagesなど、同一オリジンに`/api/auth/status`がない環境では従来どおり動きます。

- `localStorage`へ保存
- 外部通信をしないデモ実行
- サンプルと手動移行UI
- GitHub Pagesで継続利用可能

### Worker接続モード

Cloudflare Workerからビルド済みPWAを配信すると、同一オリジンのAPIを検出します。

- D1が正本
- PWAはサーバー状態を読み、認証済みの同一起動中に通信が切れた場合だけ直前の状態を表示
- Cronによる定期実行
- Workers AI、またはResponses APIによる判定
- アプリ内通知とWeb Push
- OAuth保護された`/mcp`

接続前のローカル実データは、利用者の明示操作で一度だけ統合します。`demo`データは送信せず、同じIDはサーバー側を優先します。新規に統合する監視予定はサーバーのタイムゾーンで再計算します。同一Workerオリジンでは未移行ローカルsnapshotとサーバーcacheを別キーで保持しますが、cold startでは認証完了までcacheを描画しません。logout、401、未認証確認時にはcacheを削除します。GitHub PagesとWorkerは別オリジンのため、Pages側で非`demo`の`AppState`をJSONへ書き出し、Worker側で1MB上限とschemaを検証してから未移行snapshotへ読み込みます。

## 認証とデータ境界

この版は単一所有者向けです。`APP_OWNER_ID`を論理テナントIDとして使い、D1の全データ行は`user_id`で分離してあります。運用開始後に`APP_OWNER_ID`を変更すると旧データは自動移行されません。CronとMCPは常に現在のownerだけを受け付け、古い接続は再認証が必要です。

### PWA

- `APP_LOGIN_SECRET`はWorker Secretとしてのみ保管
- SHA-256を用いた一定時間比較
- ランダムなセッショントークンを発行し、D1にはハッシュだけを保存
- Cookieは`HttpOnly; Secure; SameSite=Strict`
- 状態変更APIは`Origin`と`Sec-Fetch-Site`で同一オリジンを確認
- 接続元IPは生値で保存せず、秘密値と組み合わせたハッシュでログイン試行を制限

### MCP

- OAuth 2.1 Authorization Code + S256 PKCE
- RFC 9728 Protected Resource Metadata
- RFC 8414 Authorization Server Metadata
- CIMDを優先し、互換用にDCRも提供
- 同意画面でクライアント名と要求scopeを表示
- CSRFトークンは短寿命のStrict Cookieと照合
- `monitors:read`、`monitors:write`、`monitors:run`をツールごとに検査
- 実効scopeをアクセストークン固有のpropsへ保存し、refreshで狭めたtokenへ元の広いgrant権限を引き継がない

OAuthのアクセストークンやアプリのログイン用パスフレーズはログへ出しません。

## API

Cookie認証されたPWAが使う主なAPIです。成功する状態変更は原則として最新の`{ state }`を返します。

```text
GET    /api/auth/status
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/state
POST   /api/monitors
PATCH  /api/monitors/:id
DELETE /api/monitors/:id
POST   /api/monitors/:id/run
PATCH  /api/notifications
PATCH  /api/notifications/:id
PATCH  /api/preferences
POST   /api/migrate
GET    /api/push/key
POST   /api/push/subscribe
POST   /api/push/unsubscribe
```

PWAのログアウト要求には現在の端末のPush endpointを含めます。Worker側でその購読を削除してからセッションを破棄し、ブラウザ側でも購読を解除します。これにより共有端末でログアウト後も監視内容が通知され続ける状態を避けます。

ローカル移行はD1の1 invocationあたりクエリ上限に収まるよう25件単位で再送可能なチャンクに分割し、各行を`INSERT OR IGNORE`で統合します。途中で失敗しても、再実行時に完了済みの行は重複しません。

API入力はZodで検証し、JSON本文を1MBに制限します。監視項目を削除しても、監査用の実行履歴と通知は残します。

## 監視実行

Cronは15分ごとに起動し、予定時刻を過ぎた`active`または`error`状態の監視を既定3件（明示指定時も最大10件）選びます。既定値はCloudflare FreeのD1・外部subrequest上限に余裕を残す設定です。

- Cron予定時刻に一意制約を置き、同じ起動の再配信を重複実行しない
- 監視項目に5分のleaseを取り、手動実行との競合を防ぐ
- 最大3件を並行処理
- Push配信は更新時刻が新しい端末購読を最大5件まで対象にする
- 成功・不一致・失敗をすべて`runs`へ保存
- URLなし監視でOpenAI APIキー未設定の場合も偽の成功にせず、失敗履歴として保存
- 条件一致通知は判定内容と根拠から`dedupe_key`を作り重複を防ぐ

失敗した監視にも次回予定を設定し、後続Cronで再試行します。

## Workers AI、Responses APIと外部取得

参照先URLがある場合はWorkerが先に取得し、Cloudflare Workers AIの`@cf/openai/gpt-oss-120b`で判定します。OpenAI APIキーが設定されている環境ではResponses APIを優先し、既定モデル`gpt-5.6-luna`、`store: false`、低reasoning、Strict JSON Schemaを使います。どちらも次の形だけを受け取ります。

```json
{
  "status": "matched",
  "summary": "判定の要約",
  "evidenceUrls": ["https://example.com/source"]
}
```

参照先URLがなく現在の公開情報を調べる監視では、OpenAI Responses APIのWeb検索を使います。この場合だけOpenAI APIキーが必要です。URLがなくAPIキーもない場合、モデルの内部知識で現在情報を推測せず失敗として記録します。

外部取得では次を強制します。

- HTTPSのみ
- URL credentials、localhost、`.local`、`.internal`、private/reserved IP literalを拒否
- リダイレクトを自動追跡せず、最大5回まで各遷移先を再検証
- テキスト系Content-Typeのみ
- 512KB、20秒の上限
- `global_fetch_strictly_public`による公開ネットワーク限定fetch
- 取得内容を信頼できないデータとしてモデルへ明示し、ページ内命令を実行しない

## MCPツール

`/mcp`は次のツールを公開します。

| ツール | scope | 役割 |
| --- | --- | --- |
| `list_monitors` | `monitors:read` | 監視項目一覧 |
| `get_notifications` | `monitors:read` | 通知一覧 |
| `create_monitor` | `monitors:write` | 監視作成 |
| `update_monitor` | `monitors:write` | 条件・予定・通知設定の更新 |
| `pause_monitor` | `monitors:write` | 停止・再開 |
| `run_monitor` | `monitors:run` | 即時実行 |
| `delete_monitor` | `monitors:write` | 監視項目削除 |

読み取り、変更、外部実行、破壊操作をtool annotationで区別します。ChatGPTでSignal DeskのMCPを接続した後は、会話からこれらを呼び出せます。ただし、ChatGPT Scheduled Tasks自体が結果をMCPへ自動転送する仕組みではありません。

## Web Push

ブラウザの`PushSubscription`をD1へ保存し、VAPID鍵はWorker Secretからだけ使用します。

- 条件一致時だけPushを送信
- 静かな時間はPushを控え、D1の通知と履歴は保存
- 期限切れ購読とPushサービスの404/410を削除
- 最後の購読がなくなった場合はサーバー側のPush有効状態も解除
- 通知クリックは同一オリジンのSignal Desk通知一覧だけを開く

Push未設定・ブラウザ非対応・権限拒否はUI上で別の状態として表示します。Pushサービスの一時的な429/5xxや通信失敗はbest-effortで、永続的な再送outboxはまだありません。D1のアプリ内通知と実行履歴を正本として確認します。

## 既知の制約

- ChatGPT Scheduled Tasksの既存一覧、実行履歴、通知先を同期・置換しない
- 汎用Webページ監視であり、ログイン必須サイト、JavaScript描画専用ページ、CAPTCHAには対応しない
- DNS名の安全性はCloudflareの公開ネットワーク限定fetchにも依存する
- 通知クリック、バックグラウンドPush、PWAインストールは本番HTTPSと実機で最終確認が必要
- 一時的に失敗したWeb Pushの永続再送は行わない。アプリ内通知は失われない
- 現在の認証UIは単一所有者向け。複数利用者公開前に外部IdPとアカウント管理を追加する
