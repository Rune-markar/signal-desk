import { FlaskConical, X } from 'lucide-react';
import type { ConnectionStatus } from '../state/AppStateContext';

export function DemoBanner({ hasSamples, connectionStatus = 'local', onClear }: { hasSamples: boolean; connectionStatus?: ConnectionStatus; onClear: () => void }) {
  if (connectionStatus === 'connected') return null;
  const title = connectionStatus === 'signed-out'
    ? '監視サービスはログアウト中です'
    : connectionStatus === 'offline'
      ? 'オフラインのため端末内データを表示中'
      : connectionStatus === 'checking'
        ? '監視サービスへの接続を確認中'
        : 'ローカル試作版（外部接続なし）';
  const description = connectionStatus === 'signed-out'
    ? '設定画面からログインするまで、変更はこの端末だけに保存され、手動実行はデモになります。'
    : connectionStatus === 'offline'
      ? '最後に保存したデータを確認できます。通信が戻ったら接続状態を更新してください。'
      : hasSamples
        ? 'サンプルデータで画面操作を確認できます。外部監視・自動実行・Push配信は動きません。'
        : '外部監視・自動実行・Push配信は動きません。設定内容だけをこの端末に保存します。';
  return (
    <section className="demo-banner" aria-label="試作版のお知らせ">
      <span className="demo-icon" aria-hidden="true">
        <FlaskConical size={19} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {hasSamples && (connectionStatus === 'local' || connectionStatus === 'signed-out') ? (
        <button className="text-button" onClick={onClear}>
          <X size={16} aria-hidden="true" />
          サンプルを消す
        </button>
      ) : null}
    </section>
  );
}
