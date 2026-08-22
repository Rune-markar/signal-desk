import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { emptyState } from './domain/store';
import { saveState, STORAGE_KEY } from './domain/storage';
import { AppStateProvider } from './state/AppStateContext';

function renderEmptyApp() {
  window.location.hash = '#/monitors';
  return render(
    <AppStateProvider initialState={emptyState()} storage={window.localStorage}>
      <App />
    </AppStateProvider>
  );
}

describe('Signal Desk', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '#/monitors';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates, pauses, resumes, and manually runs a monitor', async () => {
    const user = userEvent.setup();
    renderEmptyApp();

    await user.click(screen.getByRole('button', { name: '最初の監視を追加' }));
    const dialog = screen.getByRole('dialog', { name: '新しい監視項目' });
    await user.type(within(dialog).getByLabelText(/監視名/), '公式サイト更新');
    await user.type(within(dialog).getByLabelText(/何を確認するか/), '製品仕様が変更されたら知らせる');
    await user.type(within(dialog).getByLabelText(/参照先URL/), 'https://example.com/product');
    await user.click(within(dialog).getByRole('button', { name: '監視項目を保存' }));

    expect(await screen.findByRole('heading', { name: '公式サイト更新' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '一時停止' }));
    expect(screen.getAllByText('停止中').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '再開' }));
    expect(screen.getAllByText('有効').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'デモ結果を追加' }));
    expect(await screen.findByRole('status')).toHaveTextContent('デモ結果を追加しました');
    expect(screen.getAllByLabelText(/未読1件/).length).toBeGreaterThan(0);
  });

  it('validates required monitor fields', async () => {
    const user = userEvent.setup();
    renderEmptyApp();
    await user.click(screen.getByRole('button', { name: '最初の監視を追加' }));
    await user.click(screen.getByRole('button', { name: '監視項目を保存' }));
    expect(screen.getByText('監視名を入力してください')).toBeInTheDocument();
    expect(screen.getByText('何を確認するか入力してください')).toBeInTheDocument();
  });

  it('isolates the page behind a modal and restores it after Escape', async () => {
    const user = userEvent.setup();
    const { container } = renderEmptyApp();
    const appShell = container.querySelector<HTMLElement>('.app-shell')!;

    await user.click(screen.getByRole('button', { name: '最初の監視を追加' }));
    expect(screen.getByRole('dialog', { name: '新しい監視項目' })).toBeInTheDocument();
    expect(appShell).toHaveAttribute('aria-hidden', 'true');
    expect(appShell.inert).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(appShell).not.toHaveAttribute('aria-hidden');
    expect(appShell.inert).toBe(false);
  });

  it('imports a ChatGPT task as paused after preview', async () => {
    const user = userEvent.setup();
    renderEmptyApp();
    await user.click(screen.getAllByRole('button', { name: /ChatGPTから移行/ })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'ChatGPTの監視を移行' });
    await user.type(within(dialog).getByLabelText(/タスク名/), '毎朝のニュース');
    await user.type(within(dialog).getByLabelText(/指示文/), '重要ニュースがあれば知らせる');
    await user.click(within(dialog).getByRole('button', { name: /変換内容を確認/ }));
    expect(within(dialog).getByText('停止中（テスト後に再開）')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /停止中で保存/ }));
    expect(await screen.findByRole('heading', { name: '毎朝のニュース' })).toBeInTheDocument();
    expect(screen.getAllByText('ChatGPTから移行').length).toBeGreaterThan(0);
    expect(screen.getAllByText('停止中').length).toBeGreaterThan(0);
  });

  it('shows a warning when browser storage rejects writes', async () => {
    const failingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0
    } as Storage;
    window.location.hash = '#/overview';
    render(
      <AppStateProvider initialState={emptyState()} storage={failingStorage}>
        <App />
      </AppStateProvider>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('変更を保存できません');
  });

  it('opens the inbox from a Push notification query parameter', () => {
    window.history.replaceState(null, '', '/?view=inbox&notification=notification-1');
    render(
      <AppStateProvider initialState={emptyState()} storage={window.localStorage}>
        <App />
      </AppStateProvider>
    );

    expect(screen.getByRole('heading', { name: '通知' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/inbox');
  });

  it('names legacy HTTP monitors that must be fixed before migration', async () => {
    const localState = {
      ...emptyState(),
      monitors: [{
        id: 'legacy-http',
        title: '旧HTTP監視',
        instruction: '更新を確認する',
        category: 'website' as const,
        sourceUrl: 'http://legacy.example.com/status',
        status: 'paused' as const,
        schedule: { frequency: 'daily' as const, time: '09:00', timezone: 'Asia/Tokyo' },
        severity: 'warning' as const,
        notificationsEnabled: true,
        origin: 'native' as const,
        lastOutcome: 'never' as const,
        lastSummary: '初回確認を待っています',
        consecutiveFailures: 0,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z'
      }]
    };
    saveState(window.localStorage, localState, STORAGE_KEY);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ available: true, authenticated: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/api/state')) {
        return new Response(JSON.stringify({ state: emptyState() }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(null, { status: 404 });
    }));
    window.location.hash = '#/settings';

    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <App />
      </AppStateProvider>
    );

    expect(await screen.findByText('公開HTTPSでないURLがあるため移行できません')).toBeInTheDocument();
    expect(screen.getByText('旧HTTP監視')).toBeInTheDocument();
    expect(screen.getByText('http://legacy.example.com/status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'URLの修正が必要' })).toBeDisabled();
  });
});
