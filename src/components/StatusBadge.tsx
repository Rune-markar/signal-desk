import { AlertTriangle, Check, CirclePause, Info, Siren } from 'lucide-react';
import { severityLabels, statusLabels } from '../domain/format';
import type { MonitorSeverity, MonitorStatus } from '../domain/model';

export function MonitorStatusBadge({ status }: { status: MonitorStatus }) {
  const Icon = status === 'active' ? Check : status === 'paused' ? CirclePause : AlertTriangle;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={14} aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: MonitorSeverity }) {
  const Icon = severity === 'critical' ? Siren : severity === 'warning' ? AlertTriangle : Info;
  return (
    <span className={`severity-badge severity-${severity}`}>
      <Icon size={14} aria-hidden="true" />
      {severityLabels[severity]}
    </span>
  );
}
