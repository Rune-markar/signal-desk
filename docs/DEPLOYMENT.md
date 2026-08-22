# Cloudflareへの配置

GitHub Pages版はローカル試作モードのまま維持できます。自動監視、D1同期、MCP、Web Pushを使う場合は、PWAとWorkerを同じCloudflare Workerから配信します。

## 必要なもの

- CloudflareアカウントとWranglerログイン
- OpenAI APIキー（参照先URLなしで公開Web検索する場合だけ）
- 十分に長いSignal Deskログイン用パスフレーズ
- Web Pushを使う場合はVAPID鍵ペア

秘密値を`.env`、`wrangler.jsonc`、フロントエンドへ書かないでください。

## 1. ローカル準備

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run check
npm run dev:worker
```

ローカルアプリは`http://localhost:8787/signal-desk/`、MCPは`http://localhost:8787/mcp`です。`.dev.vars`はGit管理対象外です。

## 2. Cloudflareへログイン

```bash
npx wrangler login
npx wrangler whoami
```

初回配置では、Workerより先にD1とOAuth用KVを明示的に作成します。これにより、schemaがないWorkerやCronを一時公開せずに済みます。

```bash
npx wrangler d1 create signal-desk --binding DB --update-config
npx wrangler kv namespace create signal-desk-oauth --binding OAUTH_KV --update-config
```

`--update-config`は発行されたIDを`wrangler.jsonc`へ追記します。既存リソースを使う場合は、この作成操作をせず各IDを設定してください。

## 3. Worker Secretを準備

VAPID鍵は、たとえば次のコマンドで生成できます。

```bash
npx web-push generate-vapid-keys --json
```

生成後、先に所有者だけが読めるファイルを作り、実際の値だけを記入します。

```bash
umask 077
touch .prod.secrets
```

`.prod.secrets`はGit管理対象外です。次の内容をエディタで記入します。

```bash
APP_LOGIN_SECRET=<16文字以上のランダムなパスフレーズ>
OPENAI_API_KEY=<OpenAI APIキー>
VAPID_PUBLIC_KEY=<生成した公開鍵>
VAPID_PRIVATE_KEY=<生成した秘密鍵>
VAPID_SUBJECT=mailto:admin@example.com
```

`OPENAI_API_KEY`は任意です。省略しても参照先URL付き監視はCloudflare Workers AIで動きます。参照先URLなしで公開Web検索する監視には設定してください。

deploy後も`.prod.secrets`は安全に保管するか削除してください。`VAPID_SUBJECT`には管理者のメールアドレス、または管理サイトのHTTPS URLを指定します。

## 4. D1 migrationとdeploy

```bash
npm run build
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy --secrets-file .prod.secrets
```

この順序なら、D1 schemaと全Secretをそろえた一つのWorker versionを初回公開できます。後から`wrangler secret put`を使うと、そのSecretを含む新しいversionが直ちに作成・deployされる点に注意してください。

deploy結果に表示されたオリジンを`https://<worker-host>`とすると、URLは次のとおりです。

- アプリ: `https://<worker-host>/signal-desk/`
- MCP: `https://<worker-host>/mcp`
- 稼働確認: `https://<worker-host>/health`

## 5. 初回ログインと移行

GitHub Pages版に既存データがある場合、先にPages版の「設定」を開きます。「GitHub PagesからWorkerへ移す」で「移行用JSONを書き出す」を実行し、生成されたJSONを安全な端末内に保存してください。JSONには監視名、条件、参照先URLなどが含まれます。サンプルデータは含みません。

1. Worker版アプリの「設定」を開く
2. `APP_LOGIN_SECRET`へ登録したパスフレーズでログイン
3. Pages版から移す場合は「JSONファイルを選ぶ」で上記ファイルを読み込む（1MB以下の有効なSignal Desk `AppState`だけを受け付けます）
4. 接続前のローカル実データがある場合は、件数とHTTPS URLの警告を確認して「内容を確認して移行」を実行

移行対象は監視項目・実行履歴・通知だけです。サーバー側のタイムゾーン、静かな時間、Push設定は変更しません。同じIDのデータはサーバー側を優先し、新しく入る監視項目の予定はサーバー側タイムゾーンで再計算します。
5. 監視項目を一件、停止中で作成
6. 「今すぐ実行」で結果と根拠URLを確認
7. 問題がなければ監視を再開

既存のChatGPT Scheduled taskを移す場合も、まず停止中でSignal Deskへ手動転記します。Signal Desk側の実行が成功するまでは、ChatGPT側の元タスクを停止しないでください。

## 6. ChatGPTから接続

ChatGPTでカスタムMCPアプリを追加できる環境から、上記のMCP URLを登録します。認証画面では接続元とscopeを確認し、Signal Deskのパスフレーズで許可します。

ChatGPTから「Signal Deskに毎朝9時の監視を追加して」のように依頼すると、許可されたMCPツールでD1へ登録できます。既存のChatGPT Scheduled Tasksが自動的に読み込まれるわけではありません。

OpenAIの最新の接続手順は、[Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)と[Authentication](https://developers.openai.com/plugins/build/auth)を確認してください。

## 運用確認

- `npx wrangler tail`でエラーイベントを確認する（tokenや秘密値は出力しない）
- D1の`runs`で成功・失敗を確認する
- Cronは15分間隔のため、予定時刻から最大約15分の遅延を見込む
- OpenAIを使う場合はOpenAI使用量、常にCloudflare利用量へ上限・通知を設定する
- PushはChrome/Firefox/Safariの実機HTTPS環境で購読・受信・クリックを確認する
- custom domainを使う場合も、アプリと`/api`と`/mcp`を同一オリジンに置く

## ロールバック

GitHub Pages版はWorkerと独立しているため、引き続きローカル試作版として利用できます。Workerを停止してもD1は削除しない限り残ります。D1、KV、Workerを削除する操作は復旧手順を決めたうえで個別に行ってください。
