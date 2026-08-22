import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Monitor } from '../domain/model';
import { emptyState } from '../domain/store';
import { loadState, saveState, SERVER_CACHE_KEY, STORAGE_KEY } from '../domain/storage';
import { AppStateProvider, useAppState } from './AppStateContext';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function monitor(index: number, sourceUrl = 'https://example.com'): Monitor {
  const at = new Date(Date.UTC(2026, 7, 22, 0, index % 60)).toISOString();
  return {
    id: `monitor-${index}`,
    title: `ローカル監視${index}`,
    instruction: '変更を知らせる',
    category: 'website',
    sourceUrl,
    status: 'paused',
    schedule: { frequency: 'daily', time: '09:00', timezone: 'Asia/Tokyo' },
    severity: 'warning',
    notificationsEnabled: true,
    origin: 'native',
    lastOutcome: 'never',
    lastSummary: '初回確認を待っています',
    consecutiveFailures: 0,
    createdAt: at,
    updatedAt: at
  };
}

function stateWithMonitors(monitors: Monitor[]): AppState {
  return { ...emptyState(), monitors };
}

function Harness() {
  const {
    state,
    connection,
    migration,
    createMonitor,
    login,
    logout,
    refreshState,
    migrateLocalData,
    operationError
  } = useAppState();
  return (
    <div>
      <output aria-label="connection">{connection.status}</output>
      <output aria-label="migration-count">{migration.monitors}</output>
      <output aria-label="migration-completed">{String(migration.completed)}</output>
      <output aria-label="migration-blockers">{migration.blockers.map((blocker) => blocker.title).join(',')}</output>
      <output aria-label="monitor-titles">{state.monitors.map((item) => item.title).join(',')}</output>
      <output aria-label="operation-error">{operationError}</output>
      <button onClick={() => void createMonitor({
        title: 'ローカル監視',
        instruction: '変更を知らせる',
        category: 'website',
        sourceUrl: 'https://example.com',
        frequency: 'daily',
        time: '09:00',
        severity: 'warning',
        notificationsEnabled: true,
        startActive: false
      })}>ローカル追加</button>
      <button onClick={() => void login('secret')}>ログイン</button>
      <button onClick={() => void logout()}>ログアウト</button>
      <button onClick={() => void refreshState()}>同期</button>
      <button onClick={() => void migrateLocalData()}>移行</button>
    </div>
  );
}

function TransferHarness() {
  const { connection, migration, operationError, exportLocalData, importLocalData } = useAppState();
  const [exported, setExported] = useState('');
  return (
    <div>
      <output aria-label="connection">{connection.status}</output>
      <output aria-label="migration-count">{migration.monitors}</output>
      <output aria-label="migration-completed">{String(migration.completed)}</output>
      <output aria-label="migration-blockers">{migration.blockers.map((blocker) => blocker.title).join(',')}</output>
      <output aria-label="operation-error">{operationError}</output>
      <output aria-label="exported-json">{exported}</output>
      <button onClick={() => setExported(exportLocalData() ?? '')}>書き出す</button>
      <input
        type="file"
        aria-label="移行ファイル"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importLocalData(file);
        }}
      />
    </div>
  );
}

describe('AppStateProvider server migration snapshot', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('keeps items created while signed out available for the one-time migration', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: false });
      }
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      return new Response(null, { status: 404 });
    }));

    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );

    expect(await screen.findByLabelText('connection')).toHaveTextContent('signed-out');
    await user.click(screen.getByRole('button', { name: 'ローカル追加' }));
    await waitFor(() => expect(screen.getByLabelText('migration-count')).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    expect(screen.getByLabelText('migration-count')).toHaveTextContent('1');
  });

  it('persists an unmigrated local snapshot separately across login and reload', async () => {
    const user = userEvent.setup();
    let authenticated = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated });
      }
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        authenticated = true;
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      return new Response(null, { status: 404 });
    }));

    const first = render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('signed-out');
    await user.click(screen.getByRole('button', { name: 'ローカル追加' }));
    await user.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');

    await waitFor(() => {
      expect(
        loadState(window.localStorage, STORAGE_KEY)?.monitors.filter((item) => item.origin !== 'demo')
      ).toHaveLength(1);
      expect(loadState(window.localStorage, SERVER_CACHE_KEY)?.monitors).toHaveLength(0);
    });

    first.unmount();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    expect(screen.getByLabelText('migration-count')).toHaveTextContent('1');
  });

  it('does not promote a server cache to local migration data while signed out', async () => {
    saveState(window.localStorage, stateWithMonitors([monitor(90)]), SERVER_CACHE_KEY);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: false });
      }
      return new Response(null, { status: 404 });
    }));

    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );

    expect(await screen.findByLabelText('connection')).toHaveTextContent('signed-out');
    expect(screen.getByLabelText('migration-count')).toHaveTextContent('0');
    expect(screen.getByLabelText('monitor-titles')).not.toHaveTextContent('ローカル監視90');
    expect(window.localStorage.getItem(SERVER_CACHE_KEY)).toBeNull();
  });

  it('does not render a server cache before authentication has been confirmed', () => {
    saveState(window.localStorage, stateWithMonitors([monitor(1)]), STORAGE_KEY);
    saveState(window.localStorage, stateWithMonitors([monitor(99)]), SERVER_CACHE_KEY);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );

    expect(screen.getByLabelText('connection')).toHaveTextContent('checking');
    expect(screen.getByLabelText('monitor-titles')).toHaveTextContent('ローカル監視1');
    expect(screen.getByLabelText('monitor-titles')).not.toHaveTextContent('ローカル監視99');
  });

  it('restores only the local snapshot after a 401 response', async () => {
    saveState(window.localStorage, stateWithMonitors([monitor(1)]), STORAGE_KEY);
    const serverState = stateWithMonitors([monitor(99)]);
    let stateRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) {
        stateRequests += 1;
        return stateRequests === 1
          ? jsonResponse({ state: serverState })
          : jsonResponse({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'ログインが必要です' } }, 401);
      }
      return new Response(null, { status: 404 });
    }));

    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    expect(screen.getByLabelText('monitor-titles')).toHaveTextContent('ローカル監視99');
    await user.click(screen.getByRole('button', { name: '同期' }));

    expect(await screen.findByLabelText('connection')).toHaveTextContent('signed-out');
    expect(screen.getByLabelText('monitor-titles')).toHaveTextContent('ローカル監視1');
    expect(screen.getByLabelText('monitor-titles')).not.toHaveTextContent('ローカル監視99');
    expect(screen.getByLabelText('migration-count')).toHaveTextContent('1');
    expect(window.localStorage.getItem(SERVER_CACHE_KEY)).toBeNull();
  });

  it('migrates at most 25 local records per idempotent request', async () => {
    const localState = stateWithMonitors(Array.from({ length: 57 }, (_, index) => monitor(index)));
    saveState(window.localStorage, localState, STORAGE_KEY);
    const chunkSizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      if (url.endsWith('/api/migrate') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { state: AppState };
        chunkSizes.push(body.state.monitors.length + body.state.runs.length + body.state.notifications.length);
        return jsonResponse({ state: emptyState() });
      }
      return new Response(null, { status: 404 });
    }));

    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    await user.click(screen.getByRole('button', { name: '移行' }));

    await waitFor(() => expect(chunkSizes).toEqual([25, 25, 7]));
    expect(screen.getByLabelText('migration-completed')).toHaveTextContent('true');
  });

  it('blocks legacy HTTP monitors by name before calling the migration API', async () => {
    saveState(
      window.localStorage,
      stateWithMonitors([monitor(7, 'http://legacy.example.com/status')]),
      STORAGE_KEY
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    expect(screen.getByLabelText('migration-blockers')).toHaveTextContent('ローカル監視7');
    await user.click(screen.getByRole('button', { name: '移行' }));

    expect(screen.getByLabelText('operation-error')).toHaveTextContent('ローカル監視7');
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/migrate'))).toBe(false);
  });

  it('exports only non-demo local data as an AppState JSON file', async () => {
    const real = monitor(1);
    const demo: Monitor = { ...monitor(2), id: 'demo-monitor', origin: 'demo' };
    const user = userEvent.setup();
    render(
      <AppStateProvider initialState={stateWithMonitors([real, demo])} storage={window.localStorage}>
        <TransferHarness />
      </AppStateProvider>
    );

    await user.click(screen.getByRole('button', { name: '書き出す' }));
    const exported = JSON.parse(screen.getByLabelText('exported-json').textContent ?? '') as AppState;
    expect(exported.monitors.map((item) => item.id)).toEqual([real.id]);
    expect(exported.preferences.demoMode).toBe(false);
  });

  it('imports and persists a valid cross-origin snapshot, then clears the migration marker', async () => {
    saveState(window.localStorage, stateWithMonitors([monitor(1)]), STORAGE_KEY);
    window.localStorage.setItem('signal-desk.server-migration.v1', 'complete');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      return new Response(null, { status: 404 });
    }));
    const importedState = stateWithMonitors([monitor(7, 'http://legacy.example.com/status')]);
    const file = new File([JSON.stringify(importedState)], 'signal-desk-local.json', {
      type: 'application/json'
    });
    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <TransferHarness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    await user.upload(screen.getByLabelText('移行ファイル'), file);

    await waitFor(() => expect(screen.getByLabelText('migration-count')).toHaveTextContent('2'));
    expect(screen.getByLabelText('migration-completed')).toHaveTextContent('false');
    expect(screen.getByLabelText('migration-blockers')).toHaveTextContent('ローカル監視7');
    expect(window.localStorage.getItem('signal-desk.server-migration.v1')).toBeNull();
    expect(loadState(window.localStorage, STORAGE_KEY)?.monitors.map((item) => item.id)).toEqual([
      'monitor-1',
      'monitor-7'
    ]);
  });

  it.each([
    ['schema', new File(['{"schemaVersion":1}'], 'invalid.json', { type: 'application/json' }), '有効な移行ファイル'],
    ['size', new File(['x'.repeat(1_048_577)], 'large.json', { type: 'application/json' }), '1MB以下']
  ])('rejects an invalid migration file by %s', async (_label, file, expectedMessage) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      return new Response(null, { status: 404 });
    }));
    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <TransferHarness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    await user.upload(screen.getByLabelText('移行ファイル'), file);

    expect(await screen.findByLabelText('operation-error')).toHaveTextContent(expectedMessage);
    expect(screen.getByLabelText('migration-count')).toHaveTextContent('0');
  });

  it.each([
    ['成功', 200],
    ['失敗', 500]
  ])('removes the browser Push subscription after logout API %s', async (_label, status) => {
    const unsubscribe = vi.fn(async () => true);
    const endpoint = 'https://push.example.com/subscription/current-device';
    const getSubscription = vi.fn(async () => ({ endpoint, unsubscribe }));
    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: {
        getRegistration: vi.fn(async () => ({ pushManager: { getSubscription } }))
      }
    });
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      if (url.endsWith('/api/auth/logout')) {
        return status === 200
          ? jsonResponse({ available: true, authenticated: false })
          : jsonResponse({ error: { code: 'INTERNAL_ERROR', message: '解除できませんでした' } }, status);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));

    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    const logoutCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/auth/logout'));
    expect(JSON.parse(String(logoutCall?.[1]?.body))).toEqual({ pushEndpoint: endpoint });
    expect(screen.getByLabelText('connection')).toHaveTextContent(status === 200 ? 'signed-out' : 'connected');
    if (status === 200) expect(window.localStorage.getItem(SERVER_CACHE_KEY)).toBeNull();
  });

  it('logs out through the API when Push subscription lookup fails', async () => {
    const endpoint = 'https://push.example.com/subscription/cached-device';
    window.localStorage.setItem('signal-desk.push-endpoint.v1', endpoint);
    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: {
        getRegistration: vi.fn(async () => { throw new Error('service worker unavailable'); })
      }
    });
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/status')) {
        return jsonResponse({ available: true, authenticated: true });
      }
      if (url.endsWith('/api/state')) return jsonResponse({ state: emptyState() });
      if (url.endsWith('/api/auth/logout')) {
        expect(JSON.parse(String(init?.body))).toEqual({ pushEndpoint: endpoint });
        return jsonResponse({ available: true, authenticated: false });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <AppStateProvider storage={window.localStorage} connectToBackend>
        <Harness />
      </AppStateProvider>
    );
    expect(await screen.findByLabelText('connection')).toHaveTextContent('connected');
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));

    expect(await screen.findByLabelText('connection')).toHaveTextContent('signed-out');
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/auth/logout'))).toBe(true);
    expect(window.localStorage.getItem('signal-desk.push-endpoint.v1')).toBeNull();
  });
});
