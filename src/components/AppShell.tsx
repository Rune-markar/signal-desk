import {
  Bell,
  CircleGauge,
  History,
  ListChecks,
  Settings,
  Wifi,
  WifiOff,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

export type AppRoute = 'overview' | 'monitors' | 'inbox' | 'history' | 'settings';

interface NavItem {
  route: AppRoute;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { route: 'overview', label: 'ホーム', shortLabel: 'ホーム', icon: CircleGauge },
  { route: 'monitors', label: '監視項目', shortLabel: '監視', icon: ListChecks },
  { route: 'inbox', label: '通知', shortLabel: '通知', icon: Bell },
  { route: 'history', label: '実行履歴', shortLabel: '履歴', icon: History },
  { route: 'settings', label: '設定', shortLabel: '設定', icon: Settings }
];

interface AppShellProps {
  route: AppRoute;
  unreadCount: number;
  storageStatus: 'saved' | 'error';
  children: ReactNode;
  onNavigate: (route: AppRoute) => void;
}

export function AppShell({ route, unreadCount, storageStatus, children, onNavigate }: AppShellProps) {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="メインナビゲーション">
        <button className="brand" onClick={() => onNavigate('overview')} aria-label="Signal Desk ホーム">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-copy">
            <strong>Signal Desk</strong>
            <small>監視・通知センター</small>
          </span>
        </button>

        <nav className="desktop-nav">
          {navItems.map(({ route: itemRoute, label, icon: Icon }) => (
            <button
              key={itemRoute}
              className={route === itemRoute ? 'nav-item is-active' : 'nav-item'}
              onClick={() => onNavigate(itemRoute)}
              aria-current={route === itemRoute ? 'page' : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              {itemRoute === 'inbox' && unreadCount > 0 ? (
                <span className="nav-count" aria-label={`未読${unreadCount}件`}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={online ? 'connection-dot is-online' : 'connection-dot'} />
          <div>
            <strong>{online ? 'ネット接続あり' : 'ネット接続なし'}</strong>
            <small>{storageStatus === 'error' ? '端末保存エラー' : online ? '監視サービス未接続' : '端末内データを表示'}</small>
          </div>
        </div>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <button className="compact-brand" onClick={() => onNavigate('overview')}>
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <strong>Signal Desk</strong>
          </button>
          <div className={online ? 'online-pill' : 'online-pill is-offline'}>
            {online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
            <span>{online ? 'ネット接続あり' : 'ネット接続なし'}</span>
          </div>
          <button
            className="icon-button topbar-notification"
            onClick={() => onNavigate('inbox')}
            aria-label={unreadCount > 0 ? `通知、未読${unreadCount}件` : '通知'}
          >
            <Bell size={20} aria-hidden="true" />
            {unreadCount > 0 ? <span className="notification-indicator" /> : null}
          </button>
        </header>

        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {navItems.map(({ route: itemRoute, shortLabel, icon: Icon }) => (
          <button
            key={itemRoute}
            className={route === itemRoute ? 'mobile-nav-item is-active' : 'mobile-nav-item'}
            onClick={() => onNavigate(itemRoute)}
            aria-current={route === itemRoute ? 'page' : undefined}
          >
            <span className="mobile-icon-wrap">
              <Icon size={20} aria-hidden="true" />
              {itemRoute === 'inbox' && unreadCount > 0 ? (
                <span className="mobile-count">{unreadCount > 9 ? '9+' : unreadCount}</span>
              ) : null}
            </span>
            <span>{shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
