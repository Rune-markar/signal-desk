# 外部監視へ拡張するための設計境界

## 現在の試作版

現在のアプリは、画面設計とローカル状態管理を検証するフロントエンドです。

```text
React UI -> Reducer -> localStorage
                `-> デモ実行結果
```

監視項目、通知、実行履歴、設定を一つの状態として保存します。手動実行は外部通信を行わず、`isDemo: true`かつ`status: 'simulated'`の未確認結果だけを追加し、監視本体の最終成功状態は変更しません。

## 本稼働時の推奨構成

```text
PWA
  | HTTPS / Web Push購読
API + 認証
  |-- 監視項目DB
  |-- 実行履歴・通知Outbox
  `-- スケジューラー
        |-- 対象データ取得アダプター
        |-- 条件判定
        `-- 通知生成・重複防止
```

### サーバー側の責務

- 認証とユーザーごとのデータ分離
- 時刻・タイムゾーンを考慮した定期実行
- 外部APIやWebページからのデータ取得
- 条件判定と根拠URLの保存
- 失敗時の再試行、タイムアウト、レート制限
- `dedupeKey`による同一通知の重複防止
- 静かな時間を考慮したWeb Push配信
- APIキー、Webhook秘密情報、Push秘密鍵の安全な保管

### フロントエンド側の責務

- 監視項目と通知の管理画面
- 実行状態・失敗理由・最終成功時刻の明示
- Push購読の登録と解除
- オフライン時の既読操作などを再同期
- デモ結果と実データを明確に区別

## APIの最小案

```text
GET    /api/monitors
POST   /api/monitors
PATCH  /api/monitors/:id
DELETE /api/monitors/:id
POST   /api/monitors/:id/run
GET    /api/runs
GET    /api/notifications
PATCH  /api/notifications/:id
POST   /api/push-subscriptions
DELETE /api/push-subscriptions/:id
```

クライアント側の型は`src/domain/model.ts`を起点にできますが、サーバー導入時はAPI入力を別途検証し、保存データの移行処理を追加してください。

## 次に決めること

1. 最初に接続する監視元（株価、ニュース、Webページ、社内データなど）
2. 更新頻度と許容遅延
3. 通知先（Web Push、メール、LINEなど）
4. ユーザー認証とホスティング先
5. 取得元の利用規約、レート制限、障害時の扱い

監視元が決まるまでは、汎用スクレイピングや特定サービスへの自動同期を実装しません。
