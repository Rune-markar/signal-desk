import { createMcpHandler } from 'agents/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import { APP_SCHEMA_VERSION, type AppState, type Monitor } from '../src/domain/model';
import {
  createMcpAccessTokenProps,
  createSignalDeskMcpServer,
  MCP_SCOPES,
  type SignalDeskMcpOperations
} from './mcp';

const emptyState: AppState = {
  schemaVersion: APP_SCHEMA_VERSION,
  monitors: [],
  runs: [],
  notifications: [],
  preferences: {
    timezone: 'Asia/Tokyo',
    quietHoursEnabled: false,
    quietFrom: '22:00',
    quietTo: '07:00',
    pushEnabled: false,
    demoMode: false
  }
};

const createdMonitor: Monitor = {
  id: 'monitor-created-exactly',
  title: '新しい監視',
  instruction: '作成結果を確認する',
  category: 'website',
  status: 'active',
  schedule: {
    frequency: 'daily',
    time: '09:00',
    timezone: 'Asia/Tokyo'
  },
  severity: 'info',
  notificationsEnabled: true,
  origin: 'native',
  lastOutcome: 'never',
  lastSummary: 'まだ実行されていません。',
  consecutiveFailures: 0,
  createdAt: '2026-08-22T06:00:00.000Z',
  updatedAt: '2026-08-22T06:00:00.000Z'
};

function parseMcpResponse(body: string): Record<string, unknown> {
  if (body.trim().startsWith('{')) return JSON.parse(body) as Record<string, unknown>;
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  if (!data) throw new Error(`MCP response did not contain data: ${body}`);
  return JSON.parse(data.slice('data: '.length)) as Record<string, unknown>;
}

async function callTool(
  operations: SignalDeskMcpOperations,
  props: Record<string, unknown>,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const handler = createMcpHandler(
    () => createSignalDeskMcpServer(operations),
    {
      route: '/mcp',
      legacy: 'stateless',
      authContext: { props }
    }
  );
  const response = await handler.fetch(new Request('https://signal.example/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args }
    })
  }));
  expect(response.status).toBe(200);
  return parseMcpResponse(await response.text());
}

function createOperations() {
  const createMonitor = vi.fn(async () => createdMonitor);
  const operations: SignalDeskMcpOperations = {
    loadState: vi.fn(async () => emptyState),
    createMonitor,
    updateMonitor: vi.fn(async () => emptyState),
    deleteMonitor: vi.fn(async () => emptyState),
    runMonitor: vi.fn(async () => emptyState)
  };
  return { operations, createMonitor };
}

describe('OAuth token scope enforcement at the MCP boundary', () => {
  it('copies only the provider-computed effective scope into access-token props', () => {
    const props = createMcpAccessTokenProps({
      userId: 'owner',
      clientId: 'client-1',
      requestedScope: [MCP_SCOPES.read, MCP_SCOPES.read]
    });

    expect(props.scopes).toEqual([MCP_SCOPES.read]);
    expect(props).not.toHaveProperty('grantScopes');
  });

  it('rejects create_monitor through the real MCP handler for a read-only token', async () => {
    const { operations, createMonitor } = createOperations();
    const props = createMcpAccessTokenProps({
      userId: 'owner',
      clientId: 'client-1',
      requestedScope: [MCP_SCOPES.read]
    });

    const payload = await callTool(operations, props, 'create_monitor', {
      title: '作成されない監視',
      instruction: '権限境界を確認する',
      category: 'website',
      frequency: 'daily',
      time: '09:00',
      severity: 'info',
      notificationsEnabled: true,
      startActive: true
    });

    expect(payload).toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining(MCP_SCOPES.write) }]
      }
    });
    expect(createMonitor).not.toHaveBeenCalled();
  });

  it('rejects legacy grant-level props even when they claim write scope', async () => {
    const { operations, createMonitor } = createOperations();
    const payload = await callTool(
      operations,
      {
        userId: 'owner',
        clientId: 'client-1',
        scopes: [MCP_SCOPES.read, MCP_SCOPES.write]
      },
      'create_monitor',
      {
        title: '旧形式の監視',
        instruction: '旧grant propsを拒否する',
        category: 'website',
        frequency: 'daily',
        time: '09:00',
        severity: 'info',
        notificationsEnabled: true,
        startActive: true
      }
    );

    expect(payload).toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('認証が必要') }]
      }
    });
    expect(createMonitor).not.toHaveBeenCalled();
  });

  it('returns the exact record produced by createMonitor without relying on state ordering', async () => {
    const { operations, createMonitor } = createOperations();
    const props = createMcpAccessTokenProps({
      userId: 'owner',
      clientId: 'client-1',
      requestedScope: [MCP_SCOPES.write]
    });

    const payload = await callTool(operations, props, 'create_monitor', {
      title: createdMonitor.title,
      instruction: createdMonitor.instruction,
      category: createdMonitor.category,
      frequency: createdMonitor.schedule.frequency,
      time: createdMonitor.schedule.time,
      severity: createdMonitor.severity,
      notificationsEnabled: createdMonitor.notificationsEnabled,
      startActive: true
    });

    expect(payload).toMatchObject({
      result: {
        structuredContent: { monitor: createdMonitor }
      }
    });
    expect(createMonitor).toHaveBeenCalledOnce();
  });
});
