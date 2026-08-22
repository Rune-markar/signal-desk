import { APP_SCHEMA_VERSION, type AppState } from './model';
import { getNextRunAt } from './schedule';

function before(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export function createInitialState(now = new Date()): AppState {
  const createdAt = before(now, 14 * 24 * 60);
  const newsRunAt = before(now, 95);
  const priceRunAt = before(now, 26);

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    preferences: {
      timezone: 'Asia/Tokyo',
      quietHoursEnabled: true,
      quietFrom: '22:00',
      quietTo: '07:00',
      pushEnabled: false,
      demoMode: true
    },
    monitors: [
      {
        id: 'demo-news',
        title: '保有銘柄の重要ニュース',
        instruction: '保有銘柄の決算、適時開示、業績修正、経営上の重要ニュースを確認する',
        category: 'news',
        status: 'active',
        schedule: {
          frequency: 'weekdays',
          time: '08:30',
          timezone: 'Asia/Tokyo'
        },
        severity: 'warning',
        notificationsEnabled: true,
        origin: 'demo',
        nextRunAt: getNextRunAt(now, 'weekdays', '08:30', 'Asia/Tokyo'),
        lastOutcome: 'never',
        lastSummary: '外部接続前のサンプル設定です',
        consecutiveFailures: 0,
        createdAt,
        updatedAt: newsRunAt
      },
      {
        id: 'demo-price',
        title: 'ウォッチリストの価格変動',
        instruction: '登録銘柄が前日終値から5%以上変動した場合に知らせる',
        category: 'market',
        status: 'active',
        schedule: {
          frequency: 'hourly',
          time: '09:00',
          timezone: 'Asia/Tokyo'
        },
        severity: 'critical',
        notificationsEnabled: true,
        origin: 'demo',
        nextRunAt: getNextRunAt(now, 'hourly', '09:00', 'Asia/Tokyo'),
        lastOutcome: 'never',
        lastSummary: '外部接続前のサンプル設定です',
        consecutiveFailures: 0,
        createdAt,
        updatedAt: priceRunAt
      },
      {
        id: 'demo-site',
        title: '製品ページの更新',
        instruction: '指定した製品ページの仕様または価格が変更されたら知らせる',
        category: 'website',
        sourceUrl: 'https://example.com/product',
        status: 'paused',
        schedule: {
          frequency: 'daily',
          time: '12:00',
          timezone: 'Asia/Tokyo'
        },
        severity: 'info',
        notificationsEnabled: true,
        origin: 'demo',
        lastOutcome: 'never',
        lastSummary: '一時停止中です',
        consecutiveFailures: 0,
        createdAt,
        updatedAt: createdAt
      }
    ],
    runs: [
      {
        id: 'demo-run-price',
        monitorId: 'demo-price',
        monitorTitle: 'ウォッチリストの価格変動',
        status: 'simulated',
        summary: '画面確認用のデモ結果です。外部データは取得していません。',
        evidenceUrls: [],
        startedAt: priceRunAt,
        finishedAt: priceRunAt,
        isDemo: true
      },
      {
        id: 'demo-run-news',
        monitorId: 'demo-news',
        monitorTitle: '保有銘柄の重要ニュース',
        status: 'simulated',
        summary: '画面確認用のデモ結果です。外部データは取得していません。',
        evidenceUrls: [],
        startedAt: newsRunAt,
        finishedAt: newsRunAt,
        isDemo: true
      }
    ],
    notifications: [
      {
        id: 'demo-notification-price',
        monitorId: 'demo-price',
        monitorTitle: 'ウォッチリストの価格変動',
        runId: 'demo-run-price',
        title: 'サンプル通知：価格変動',
        body: '登録銘柄のうち1件が設定した5%の変動条件に一致しました。これは画面確認用のサンプル通知です。',
        severity: 'critical',
        status: 'unread',
        detectedAt: priceRunAt,
        dedupeKey: 'demo-price:sample-1',
        isDemo: true
      },
      {
        id: 'demo-notification-welcome',
        monitorId: 'system',
        monitorTitle: 'Signal Desk',
        title: 'プロジェクトの準備ができました',
        body: '現在はローカル試作版です。監視項目の作成・停止・通知管理を試せます。',
        severity: 'info',
        status: 'read',
        detectedAt: before(now, 180),
        readAt: before(now, 170),
        dedupeKey: 'system:welcome',
        isDemo: true
      }
    ]
  };
}
