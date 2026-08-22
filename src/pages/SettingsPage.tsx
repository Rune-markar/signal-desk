import { BellRing, Database, Globe2, MoonStar, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppPreferences } from '../domain/model';
import { isClockTime } from '../domain/schedule';
import { PageHeader } from '../components/PageHeader';

type PermissionState = NotificationPermission | 'unsupported';

interface SettingsPageProps {
  preferences: AppPreferences;
  monitorCount: number;
  notificationCount: number;
  onUpdate: (preferences: Partial<AppPreferences>) => void;
  onClearDemo: () => void;
  onResetDemo: () => void;
  onAnnounce: (message: string) => void;
}

export function SettingsPage({ preferences, monitorCount, notificationCount, onUpdate, onClearDemo, onResetDemo, onAnnounce }: SettingsPageProps) {
  const [permission, setPermission] = useState<PermissionState>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const sync = () => setInstalled(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      onAnnounce('このブラウザは端末通知に対応していません');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    onUpdate({ pushEnabled: result === 'granted' });
    onAnnounce(result === 'granted' ? '端末通知を許可しました' : '端末通知は許可されませんでした');
  };

  const permissionLabel = permission === 'granted' ? '許可済み' : permission === 'denied' ? '拒否' : permission === 'default' ? '未設定' : '非対応';
  const updateQuietTime = (key: 'quietFrom' | 'quietTo', value: string) => {
    onUpdate({ [key]: isClockTime(value) ? value : preferences[key] });
  };

  return (
    <div className="page-stack settings-page">
      <PageHeader eyebrow="SETTINGS" title="設定" description="通知、時刻、端末上の保存状態を管理します。" />

      <section className="settings-section panel">
        <div className="settings-heading"><Globe2 size={20} /><div><h2>時刻と地域</h2><p>監視予定と通知時刻の表示に使います。</p></div></div>
        <label className="field settings-field">
          <span>タイムゾーン</span>
          <select value={preferences.timezone} onChange={(event) => onUpdate({ timezone: event.target.value })}>
            <option value="Asia/Tokyo">Asia/Tokyo（日本時間）</option>
            <option value="UTC">UTC（協定世界時）</option>
            <option value="America/New_York">America/New_York（米国東部）</option>
          </select>
        </label>
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><MoonStar size={20} /><div><h2>配信接続後の静かな時間</h2><p>将来のPush配信で使う設定です。現在はこの端末への保存だけ行います。</p></div></div>
        <label className="switch-row settings-switch">
          <input type="checkbox" checked={preferences.quietHoursEnabled} onChange={(event) => onUpdate({ quietHoursEnabled: event.target.checked })} />
          <span className="switch-control" aria-hidden="true" />
          <span><strong>静かな時間を使う</strong><small>アプリ内の履歴は通常どおり保存します</small></span>
        </label>
        {preferences.quietHoursEnabled ? (
          <div className="quiet-time-grid">
            <label className="field"><span>開始</span><input type="time" required value={preferences.quietFrom} onChange={(event) => updateQuietTime('quietFrom', event.target.value)} /></label>
            <span>から</span>
            <label className="field"><span>終了</span><input type="time" required value={preferences.quietTo} onChange={(event) => updateQuietTime('quietTo', event.target.value)} /></label>
            <span>まで</span>
          </div>
        ) : null}
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><BellRing size={20} /><div><h2>端末通知</h2><p>通知権限とPWAの状態を確認します。</p></div></div>
        <div className="status-list">
          <div><span><Smartphone size={18} />PWA</span><strong className={installed ? 'good-text' : ''}>{installed ? 'インストール済み' : 'ブラウザで利用中'}</strong></div>
          <div><span><ShieldCheck size={18} />通知権限</span><strong>{permissionLabel}</strong></div>
        </div>
        <div className="settings-callout">
          <p>権限を許可すると端末通知の準備ができます。実際のPush配信には、次段階で通知サーバーの接続が必要です。</p>
          <button className="button secondary" onClick={requestNotifications} disabled={permission === 'denied'}>
            <BellRing size={18} />{permission === 'granted' ? '許可済み' : '通知を許可する'}
          </button>
        </div>
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><Database size={20} /><div><h2>ローカルデータ</h2><p>この端末のブラウザに保存されています。</p></div></div>
        <div className="storage-summary">
          <div><strong>{monitorCount}</strong><span>監視項目</span></div>
          <div><strong>{notificationCount}</strong><span>通知</span></div>
          <div><strong>v1</strong><span>保存形式</span></div>
        </div>
        <div className="settings-actions-row">
          {preferences.demoMode ? <button className="button secondary" onClick={onClearDemo}>サンプルだけ消す</button> : null}
          <button className="button ghost" onClick={onResetDemo}><RotateCcw size={18} />サンプルを復元</button>
        </div>
      </section>
    </div>
  );
}
