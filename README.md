# Signal Desk

ChatGPTなどで管理していた監視項目を、専用画面で一覧・通知・履歴として扱うためのPWA試作版です。

## 公開先

- アプリ: <https://rune-markar.github.io/signal-desk/>
- GitHub: <https://github.com/Rune-markar/signal-desk>

`main`ブランチへのpushをGitHub Actionsで検証し、GitHub Pagesへ自動公開します。

## 現在できること

- 監視項目の追加、編集、停止、再開、削除、検索、絞り込み
- 通知の未読管理、一括既読、1時間のスヌーズ
- 実行履歴と次回予定の確認
- ChatGPTの監視内容を手入力でプレビューし、停止状態で移行
- タイムゾーン、静かな時間、ブラウザ通知権限の設定
- `localStorage`への端末内保存
- PWA用manifestと、アプリシェルのオフライン表示

> [!IMPORTANT]
> 現在はブラウザ内だけで動く機能試作版です。外部サイト、市場データ、ChatGPTのタスク、Push配信サーバーには接続していません。「デモ結果を追加」は外部通信をせず、未確認のデモ履歴だけを作ります。

## 起動

Node.js 20.19以上（または22.12以上）を使用してください。

```bash
npm install
npm run dev
```

表示されたローカルURL（`/signal-desk/`配下）をブラウザで開きます。初回は、動作確認用のサンプルが入っています。

## 品質確認

```bash
npm run check
```

`npm run check` は、Vitestによるドメイン/UIテストとTypeScript・本番ビルドを実行します。

## データの扱い

- 保存キー: `signal-desk.state.v1`
- 保存場所: 利用中ブラウザの`localStorage`
- スキーマ版: `v1`
- サンプルだけを消す操作と、ユーザー作成データを残したまま初期サンプルを復元する操作を設定画面に用意しています。

ブラウザデータを消すと内容も失われます。`localStorage`は暗号化保管ではありません。APIキー、認証情報、個人情報などの機密情報は入力しないでください。現時点では端末間同期やバックアップはありません。

## 配置条件

Viteの`base`はGitHub PagesのプロジェクトURLに合わせて`/signal-desk/`に設定しています。manifest、Service Worker、アセットURLもこの配下を使います。別のリポジトリ名や専用originのルートへ配置する場合は、`vite.config.ts`の`base`を配置先に合わせてください。

## 主な構成

```text
src/
  components/   共通UI、モーダル、監視カード
  domain/       型、予定計算、Reducer、保存、サンプル
  pages/        概要、監視、通知、履歴、設定
  state/        React Contextと永続化
  test/         ブラウザAPIのテスト設定
```

外部監視を本稼働させる場合の境界は、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)にまとめています。

## 技術構成

- React + TypeScript + Vite
- Vitest + Testing Library
- Vite PWA / Workbox
- Temporal polyfill（タイムゾーンを考慮した次回予定計算）
- Lucide Icons
- Noto Sans JP Variable（日本語UIを端末差なく表示）

Noto Sans JPのライセンスは[public/THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt)に収録しています。このプロジェクト自体には、現時点で再利用ライセンスを付与していません。

## 開発上の注意

- APIキーや認証情報をフロントエンドへ置かないでください。
- 外部データの取得、条件判定、通知配信はサーバー側で行います。
- ChatGPT側の監視項目は自動同期を前提にせず、現在は内容を確認して手動移行します。
- 実データ接続後は、出典URL、取得時刻、重複防止キー、再試行結果を履歴に残してください。
- SVGアイコンによるmanifestは生成しますが、Android/iOS実機でのインストールアイコンは未検証です。本番公開前に192px・512px PNGとApple touch iconを追加して実機確認してください。
