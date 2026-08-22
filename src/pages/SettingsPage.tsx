import {
  BellRing,
  CircleAlert,
  Cloud,
  Database,
  Download,
  FileUp,
  Globe2,
  LogIn,
  LogOut,
  MoonStar,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  UploadCloud
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { AppPreferences } from '../domain/model';
import { isClockTime } from '../domain/schedule';
import { PageHeader } from '../components/PageHeader';
import type { ConnectionState, MigrationSummary, PushState } from '../state/AppStateContext';

type PermissionState = NotificationPermission | 'unsupported';

interface SettingsPageProps {
  preferences: AppPreferences;
  monitorCount: number;
  notificationCount: number;
  connection: ConnectionState;
  push: PushState;
  migration: MigrationSummary;
  busy: boolean;
  onUpdate: (preferences: Partial<AppPreferences>) => void;
  onClearDemo: () => void;
  onResetDemo: () => void;
  onLogin: (secret: string) => Promise<boolean>;
  onLogout: () => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
  onMigrateLocal: () => Promise<boolean>;
  onExportLocal: () => string | null;
  onImportLocal: (file: File) => Promise<boolean>;
  onRefreshPush: () => Promise<void>;
  onSubscribePush: () => Promise<boolean>;
  onUnsubscribePush: () => Promise<boolean>;
  onAnnounce: (message: string) => void;
}

function connectionLabel(connection: ConnectionState): string {
  if (connection.status === 'connected') return '接続済み';
  if (connection.status === 'signed-out') return 'ログインが必要';
  if (connection.status === 'checking') return '確認中';
  if (connection.status === 'offline') return 'オフライン';
  return 'ローカルモード';
}

function pushLabel(push: PushState): string {
  if (push.availability === 'unsupported') return 'ブラウザ非対応';
  if (push.availability === 'unconfigured') return 'サーバー鍵未設定';
  if (push.availability === 'available') return push.subscribed ? '配信登録済み' : '登録可能';
  return '未確認';
}

export function SettingsPage({
  preferences,
  monitorCount,
  notificationCount,
  connection,
  push,
  migration,
  busy,
  onUpdate,
  onClearDemo,
  onResetDemo,
  onLogin,
  onLogout,
  onRefresh,
  onMigrateLocal,
  onExportLocal,
  onImportLocal,
  onRefreshPush,
  onSubscribePush,
  onUnsubscribePush,
  onAnnounce
}: SettingsPageProps) {
  const [permission, setPermission] = useState<PermissionState>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const [installed, setInstalled] = useState(false);
  const [secret, setSecret] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const sync = () => setInstalled(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    if (connection.status === 'connected') void onRefreshPush();
  }, [connection.status, onRefreshPush]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    const succeeded = await onLogin(secret);
    if (succeeded) {
      setSecret('');
      onAnnounce('監視サービスへログインしました');
    }
  };

  const enableNotifications = async () => {
    if (connection.status === 'connected') {
      const succeeded = await onSubscribePush();
      setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
      if (succeeded) onAnnounce('この端末へのPush通知を有効にしました');
      return;
    }
    if (typeof Notification === 'undefined') {
      onAnnounce('このブラウザは端末通知に対応していません');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    onUpdate({ pushEnabled: result === 'granted' });
    onAnnounce(result === 'granted' ? '通知権限を許可しました。配信にはサービス接続が必要です' : '端末通知は許可されませんでした');
  };

  const disableNotifications = async () => {
    const succeeded = await onUnsubscribePush();
    if (succeeded) onAnnounce('この端末へのPush配信を解除しました');
  };

  const downloadLocalData = () => {
    const json = onExportLocal();
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `signal-desk-local-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onAnnounce('ローカル実データをJSONファイルへ書き出しました');
  };

  const importLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (await onImportLocal(file)) {
      onAnnounce('移行ファイルを読み込みました。件数とURLを確認して移行してください');
    }
  };

  const permissionLabel = permission === 'granted' ? '許可済み' : permission === 'denied' ? '拒否' : permission === 'default' ? '未設定' : '非対応';
  const updateQuietTime = (key: 'quietFrom' | 'quietTo', value: string) => {
    onUpdate({ [key]: isClockTime(value) ? value : preferences[key] });
  };
  const migrationCount = migration.monitors + migration.runs + migration.notifications;
  const migrationBlocked = migration.blockers.length > 0;

  return (
    <div className="page-stack settings-page">
      <PageHeader eyebrow="SETTINGS" title="設定" description="監視サービスへの接続、通知、時刻、端末上の保存状態を管理します。" />

      <section className="settings-section panel connection-settings">
        <div className="settings-heading"><Cloud size={20} /><div><h2>監視サービス</h2><p>Worker上の保存データ、自動監視、ChatGPT用MCPと同じ監視項目を使います。</p></div></div>
        <div className="status-list">
          <div><span><Cloud size={18} />接続状態</span><strong className={connection.status === 'connected' ? 'good-text' : ''}>{connectionLabel(connection)}</strong></div>
          <div><span><Database size={18} />表示データ</span><strong>{connection.status === 'connected' ? 'サーバーと同期' : 'この端末に保存'}</strong></div>
        </div>

        {connection.status === 'signed-out' ? (
          <form className="login-form" onSubmit={submitLogin}>
            <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
            <label className="field">
              <span>ログイン用パスフレーズ</span>
              <input type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} required />
            </label>
            <button className="button primary" type="submit" disabled={busy || !secret}>
              <LogIn size={18} />{busy ? '接続中…' : 'ログイン'}
            </button>
          </form>
        ) : (
          <div className="settings-callout">
            <p>{connection.status === 'connected'
              ? '変更はサーバーへ保存されます。この端末にはオフライン確認用の最新スナップショットも残ります。'
              : connection.status === 'checking'
                ? '同一オリジンの監視サービスを確認しています。'
                : connection.status === 'offline'
                  ? 'この起動中に認証済みなら直前のサーバー状態を表示します。再読込後は、認証確認までローカルデータだけを表示します。'
                  : 'この公開サイトには監視サーバーが接続されていません。画面操作とローカル保存は利用できます。'}</p>
            <div className="settings-actions-row compact-actions">
              {connection.status === 'connected' ? (
                <>
                  <button className="button secondary" onClick={async () => { if (await onRefresh()) onAnnounce('最新データに更新しました'); }} disabled={busy}><RefreshCw size={18} />同期</button>
                  <button className="button ghost" onClick={async () => { if (await onLogout()) onAnnounce('この端末のPush配信を解除してログアウトしました'); }} disabled={busy}><LogOut size={18} />ログアウト</button>
                </>
              ) : (
                <button className="button secondary" onClick={() => void onRefresh()} disabled={busy || connection.status === 'checking'}><RefreshCw size={18} />接続を再確認</button>
              )}
            </div>
          </div>
        )}
        {connection.error ? <p className="inline-error" role="status">{connection.error}</p> : null}
      </section>

      <section className="settings-section panel transfer-settings">
        <div className="settings-heading">
          {connection.status === 'connected' ? <FileUp size={20} /> : <Download size={20} />}
          <div>
            <h2>GitHub PagesからWorkerへ移す</h2>
            <p>別オリジン間では自動共有できないため、非サンプルデータだけをJSONファイルで受け渡します。</p>
          </div>
        </div>
        {connection.status === 'connected' ? (
          <div className="settings-callout transfer-callout">
            <p id="migration-file-help">GitHub Pages版の設定で書き出した1MB以下のJSONを選びます。読み込み後、下の件数とHTTPS URLを確認してからサーバーへ移行してください。</p>
            <input
              ref={importInputRef}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={importLocalFile}
              aria-describedby="migration-file-help"
              tabIndex={-1}
            />
            <button className="button secondary" onClick={() => importInputRef.current?.click()} disabled={busy} aria-describedby="migration-file-help">
              <FileUp size={18} />JSONファイルを選ぶ
            </button>
          </div>
        ) : connection.status === 'local' || connection.status === 'signed-out' ? (
          <div className="settings-callout transfer-callout">
            <p>移行対象は{migrationCount}件です。JSONには監視名・条件・URLが含まれるため、信頼できる端末で保管してください。サンプルは含みません。</p>
            <button className="button secondary" onClick={downloadLocalData} disabled={busy || migrationCount === 0}>
              <Download size={18} />移行用JSONを書き出す
            </button>
          </div>
        ) : (
          <div className="settings-callout transfer-callout">
            <p>接続確認が終わってから、JSONファイルの書き出しまたは読み込みを行えます。</p>
          </div>
        )}
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><Globe2 size={20} /><div><h2>時刻と地域</h2><p>監視予定と通知時刻の表示に使います。</p></div></div>
        <label className="field settings-field">
          <span>タイムゾーン</span>
          <select value={preferences.timezone} onChange={(event) => onUpdate({ timezone: event.target.value })} disabled={busy}>
            <option value="Asia/Tokyo">Asia/Tokyo（日本時間）</option>
            <option value="UTC">UTC（協定世界時）</option>
            <option value="America/New_York">America/New_York（米国東部）</option>
          </select>
        </label>
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><MoonStar size={20} /><div><h2>静かな時間</h2><p>{connection.status === 'connected' ? 'この時間帯はPush配信を控え、アプリ内に結果を保存します。' : 'サービス接続後のPush配信に使う設定です。'}</p></div></div>
        <label className="switch-row settings-switch">
          <input type="checkbox" checked={preferences.quietHoursEnabled} onChange={(event) => onUpdate({ quietHoursEnabled: event.target.checked })} disabled={busy} />
          <span className="switch-control" aria-hidden="true" />
          <span><strong>静かな時間を使う</strong><small>アプリ内の履歴は通常どおり保存します</small></span>
        </label>
        {preferences.quietHoursEnabled ? (
          <div className="quiet-time-grid">
            <label className="field"><span>開始</span><input type="time" required value={preferences.quietFrom} onChange={(event) => updateQuietTime('quietFrom', event.target.value)} disabled={busy} /></label>
            <span>から</span>
            <label className="field"><span>終了</span><input type="time" required value={preferences.quietTo} onChange={(event) => updateQuietTime('quietTo', event.target.value)} disabled={busy} /></label>
            <span>まで</span>
          </div>
        ) : null}
      </section>

      <section className="settings-section panel">
        <div className="settings-heading"><BellRing size={20} /><div><h2>端末通知</h2><p>ブラウザの権限と、監視サービスのPush購読を別々に確認できます。</p></div></div>
        <div className="status-list">
          <div><span><Smartphone size={18} />PWA</span><strong className={installed ? 'good-text' : ''}>{installed ? 'インストール済み' : 'ブラウザで利用中'}</strong></div>
          <div><span><ShieldCheck size={18} />通知権限</span><strong>{permissionLabel}</strong></div>
          <div><span><BellRing size={18} />Push配信</span><strong className={push.subscribed ? 'good-text' : ''}>{pushLabel(push)}</strong></div>
        </div>
        <div className="settings-callout">
          <p>{push.availability === 'unconfigured'
            ? 'サーバーにVAPID鍵が設定されていないため、Push配信はまだ有効にできません。アプリ内通知は利用できます。'
            : connection.status !== 'connected'
              ? '通知権限は準備できますが、実際のPush配信には監視サービスへのログインが必要です。'
              : push.subscribed
                ? 'この端末は条件一致のPush通知を受け取ります。取得失敗はアプリ内の履歴で確認できます。ブラウザ設定からも権限を停止できます。'
                : '通知を有効にすると、この端末の購読情報を監視サービスへ登録します。'}</p>
          {push.subscribed ? (
            <button className="button secondary" onClick={disableNotifications} disabled={busy}>配信を解除</button>
          ) : (
            <button className="button secondary" onClick={enableNotifications} disabled={busy || permission === 'denied' || push.availability === 'unconfigured'}>
              <BellRing size={18} />通知を有効にする
            </button>
          )}
        </div>
        {push.error ? <p className="inline-error" role="status">{push.error}</p> : null}
      </section>

      {connection.status === 'connected' && migrationCount > 0 ? (
        <section className="settings-section panel migration-settings">
          <div className="settings-heading"><UploadCloud size={20} /><div><h2>ローカルデータを一度だけ移行</h2><p>接続前にこの端末で作った実データだけを、監視サービスへ統合します。サンプルは送りません。</p></div></div>
          <div className="storage-summary">
            <div><strong>{migration.monitors}</strong><span>監視項目</span></div>
            <div><strong>{migration.runs}</strong><span>実行履歴</span></div>
            <div><strong>{migration.notifications}</strong><span>通知</span></div>
          </div>
          {migrationBlocked ? (
            <div className="migration-blockers" role="alert">
              <div className="migration-blocker-heading">
                <CircleAlert size={19} aria-hidden="true" />
                <strong>公開HTTPSでないURLがあるため移行できません</strong>
              </div>
              <p>一度ログアウトし、「監視項目」で次のURLを公開HTTPSへ修正するか、不要な項目を削除してください。</p>
              <ul>
                {migration.blockers.map((blocker) => (
                  <li key={blocker.monitorId}>
                    <strong>{blocker.title}</strong>
                    <span>{blocker.sourceUrl}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="settings-callout">
            <p>{migration.completed
              ? 'このブラウザからの移行は完了しています。再送信は行いません。'
              : migrationBlocked
                ? '上の項目を修正すると移行できるようになります。サーバー側のデータと設定はまだ変更されません。'
                : 'IDが同じデータはサーバー側を優先します。サーバーの時刻・通知設定は変更せず、元のローカルデータも端末内に残します。'}</p>
            <button className="button primary" disabled={busy || migration.completed || migrationBlocked} onClick={async () => { if (await onMigrateLocal()) onAnnounce('ローカルデータを監視サービスへ移行しました'); }}>
              <UploadCloud size={18} />{migration.completed ? '移行済み' : migrationBlocked ? 'URLの修正が必要' : '内容を確認して移行'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="settings-section panel">
        <div className="settings-heading"><Database size={20} /><div><h2>{connection.status === 'connected' ? '保存データと端末キャッシュ' : 'ローカルデータ'}</h2><p>{connection.status === 'connected' ? 'サーバーの最新状態を、この端末にもオフライン確認用として保存しています。' : 'この端末のブラウザに保存されています。'}</p></div></div>
        <div className="storage-summary">
          <div><strong>{monitorCount}</strong><span>監視項目</span></div>
          <div><strong>{notificationCount}</strong><span>通知</span></div>
          <div><strong>v1</strong><span>保存形式</span></div>
        </div>
        {connection.status === 'local' || connection.status === 'signed-out' ? (
          <div className="settings-actions-row">
            {preferences.demoMode ? <button className="button secondary" onClick={onClearDemo}>サンプルだけ消す</button> : null}
            <button className="button ghost" onClick={onResetDemo}><RotateCcw size={18} />サンプルを復元</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
