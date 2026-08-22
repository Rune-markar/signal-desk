# Signal Desk

監視項目を専用画面で管理し、定期実行、履歴、アプリ内通知、Web Pushを扱うPWAです。ChatGPTからはOAuth保護されたMCPツールを使って、同じ監視項目を登録・更新・実行できます。

## 公開先

- GitHub Pages（ローカル試作モード）: <https://rune-markar.github.io/signal-desk/>
- GitHub: <https://github.com/Rune-markar/signal-desk>

GitHub Pagesは秘密情報や定期処理を持てないため、ブラウザ内デモとして動作します。自動監視・MCP・Pushを使う本稼働URLは、Cloudflare Workerをdeployしたときに発行されます。

## 動作モード

### GitHub Pages / ローカル試作モード

- 監視項目の追加、編集、停止、再開、削除、検索、絞り込み
- 通知の未読、一括既読、スヌーズ
- 実行履歴と次回予定
- ChatGPT Scheduled taskの内容を手入力し、停止中で移行
- `localStorage`への保存
- Worker版へ渡す非サンプルデータのJSON書き出し
- 外部通信をしない「デモ結果」
- PWAアプリシェルのオフライン表示

### Cloudflare Worker接続モード

- D1を正本にした端末間同期
- セッション認証と単一所有者のデータ分離
- 15分ごとのCronと実行lease
- OpenAI Responses APIによる条件判定
- HTTPSページの安全な取得、またはWeb検索
- 成功・不一致・失敗の履歴と通知重複防止
- VAPID Web Pushと静かな時間
- OAuth 2.1 + PKCEで保護された`/mcp`
- ChatGPTからの一覧、作成、更新、停止・再開、即時実行、削除
- 接続前ローカルデータの明示的一回移行
- GitHub Pages版で書き出したJSONの検証・読み込み

認証済みの画面がそのままオフラインになった場合は、同じ起動中だけ直前のサーバー状態を閲覧できます。再読込時は認証確認までローカルデータだけを表示し、ログアウト・401・未認証確認時には端末のサーバーキャッシュを削除します。オフライン中のサーバーデータ変更は行いません。

## ChatGPTとの境界

Signal Deskを監視項目の正本にします。ChatGPTにMCPを接続すると、会話からSignal Deskの監視を操作できます。

一方、ChatGPT Scheduled Tasksの既存一覧や実行履歴を取得する一般向けAPIは確認できないため、次は行いません。

- 既存Scheduled Tasksの自動取り込み
- ChatGPT側通知の送信先をSignal Deskへ置換
- ChatGPT側とSignal Desk側の双方向同期

既存タスクは画面の「ChatGPTから移行」で内容を確認し、停止中として手動保存します。Signal Deskでテスト成功後に、元のChatGPTタスクを利用者が停止してください。

GitHub Pages版とWorker版はオリジンが異なるため、ブラウザ保存データは自動共有されません。Pages版の「設定」で移行用JSONを書き出し、Worker版へログインして同じ「設定」から読み込んだ後、件数とURLを確認して明示的に移行します。JSONには監視条件やURLが含まれるため、安全な端末で扱ってください。

## ローカル起動

Node.js 20.19以上（または22.12以上）を使用してください。

GitHub Pages相当のローカル試作モード:

```bash
npm install
npm run dev
```

Worker接続モード:

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:worker
```

Worker接続モードのアプリは`http://localhost:8787/signal-desk/`、MCPは`http://localhost:8787/mcp`です。`.dev.vars`へ実際の秘密値を設定し、Gitへ追加しないでください。

## 品質確認

```bash
npm run check
```

`npm run check`は次を実行します。

- Vitestのドメイン、UI、監視元URL、Push URLテスト
- フロントエンドTypeScriptとVite本番ビルド
- Worker TypeScript
- Wranglerのdeploy dry-run

## 配置

CloudflareへのD1 migration、Worker Secret、VAPID、deploy、ChatGPT MCP接続は[配置手順](docs/DEPLOYMENT.md)を参照してください。実装上の境界とセキュリティ設計は[アーキテクチャ](docs/ARCHITECTURE.md)にまとめています。

## 主な構成

```text
src/
  api/          PWAから同一オリジンAPIへのクライアント
  components/   共通UI、モーダル、監視カード
  domain/       型、予定計算、Reducer、ローカル保存
  pages/        概要、監視、通知、履歴、設定
  state/        ローカル/サーバー両モードの状態管理
worker/
  migrations/   D1 schema
  api.ts        Cookie認証されたPWA API
  auth.ts       セッション、同一オリジン、試行制限
  db.ts         D1 repository
  runner.ts     Responses API、外部取得、Cron、lease
  push.ts       VAPID Web Push
  mcp.ts        ChatGPT用MCPツール
  oauth.ts      OAuth同意フロー
  index.ts      Worker統合入口
```

## 技術構成

- React 19 + TypeScript + Vite
- Vitest + Testing Library
- Vite PWA / Workbox
- Cloudflare Workers + D1 + KV + Cron + Static Assets
- Cloudflare Agents SDKのstateless MCP handler
- Cloudflare Workers OAuth Provider
- OpenAI Responses API
- Web Push / VAPID
- Temporal polyfill

## セキュリティ上の注意

- APIキー、ログイン用パスフレーズ、VAPID private keyをフロントエンドやGitへ置かないでください。
- 監視元はHTTPSのみです。Workerはprivate network、危険なredirect、非テキスト応答、512KB超過を拒否します。
- 外部ページは信頼できないデータとしてモデルへ渡し、ページ内の命令を実行しません。
- この版の認証は単一所有者向けです。不特定多数へ公開する前に外部IdPとアカウント管理を追加してください。
- Push受信、通知クリック、PWAインストール、Android/iOSアイコンは本番HTTPSと実機で最終確認してください。

Noto Sans JPのライセンスは[public/THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt)に収録しています。このプロジェクト自体には、現時点で再利用ライセンスを付与していません。
