import type {
  MonitorCategory,
  MonitorOutcome,
  RunStatus,
  MonitorSeverity,
  MonitorStatus
} from './model';

export function formatDateTime(value: string | undefined, timezone = 'Asia/Tokyo'): string {
  if (!value) return '未実行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時不明';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Tokyo'
    }).format(date);
  }
}

export function relativeTime(value: string | undefined, now = new Date()): string {
  if (!value) return '予定なし';
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '日時不明';
  const diffMinutes = Math.round((target - now.getTime()) / 60_000);
  const abs = Math.abs(diffMinutes);

  if (abs < 1) return 'まもなく';
  if (abs < 60) return diffMinutes > 0 ? `約${abs}分後` : `約${abs}分前`;
  const hours = Math.round(abs / 60);
  if (hours < 24) return diffMinutes > 0 ? `約${hours}時間後` : `約${hours}時間前`;
  const days = Math.round(hours / 24);
  return diffMinutes > 0 ? `約${days}日後` : `約${days}日前`;
}

export const statusLabels: Record<MonitorStatus, string> = {
  active: '有効',
  paused: '停止中',
  error: '確認が必要'
};

export const categoryLabels: Record<MonitorCategory, string> = {
  market: '価格・数値',
  news: 'ニュース',
  website: 'ページ更新',
  report: '定期レポート'
};

export const severityLabels: Record<MonitorSeverity, string> = {
  info: 'お知らせ',
  warning: '要確認',
  critical: '重要'
};

export const outcomeLabels: Record<MonitorOutcome, string> = {
  matched: '条件に一致',
  clear: '変化なし',
  failed: '取得失敗',
  never: '未実行'
};

export const runStatusLabels: Record<RunStatus, string> = {
  matched: '条件に一致',
  clear: '変化なし',
  failed: '取得失敗',
  simulated: 'デモ（未確認）'
};
