import { FlaskConical, X } from 'lucide-react';

export function DemoBanner({ hasSamples, onClear }: { hasSamples: boolean; onClear: () => void }) {
  return (
    <section className="demo-banner" aria-label="試作版のお知らせ">
      <span className="demo-icon" aria-hidden="true">
        <FlaskConical size={19} />
      </span>
      <div>
        <strong>ローカル試作版（外部接続なし）</strong>
        <p>{hasSamples ? 'サンプルデータで画面操作を確認できます。外部監視・自動実行・Push配信はまだ動きません。' : '外部監視・自動実行・Push配信はまだ動きません。設定内容だけをこの端末に保存します。'}</p>
      </div>
      {hasSamples ? (
        <button className="text-button" onClick={onClear}>
          <X size={16} aria-hidden="true" />
          サンプルを消す
        </button>
      ) : null}
    </section>
  );
}
