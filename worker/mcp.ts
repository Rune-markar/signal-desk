import { McpServer } from '@modelcontextprotocol/server';
import { getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';
import type {
  AlertNotification,
  AppState,
  Monitor,
  MonitorCategory,
  MonitorFrequency,
  MonitorInput,
  MonitorSeverity,
  MonitorStatus
} from '../src/domain/model';
import { isSafePublicHttpsUrl } from '../src/domain/publicUrl';

export const MCP_SCOPES = {
  read: 'monitors:read',
  write: 'monitors:write',
  run: 'monitors:run'
} as const;

export const MCP_SUPPORTED_SCOPES = [
  MCP_SCOPES.read,
  MCP_SCOPES.write,
  MCP_SCOPES.run,
  'offline_access'
] as const;

const MCP_ACCESS_TOKEN_CONTEXT = 'signal-desk-access-token-v1' as const;

export interface SignalDeskMcpAccessTokenProps extends Record<string, unknown> {
  context: typeof MCP_ACCESS_TOKEN_CONTEXT;
  userId: string;
  clientId: string;
  scopes: (typeof MCP_SUPPORTED_SCOPES)[number][];
}

const accessTokenPropsSchema = z.object({
  context: z.literal(MCP_ACCESS_TOKEN_CONTEXT),
  userId: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.enum(MCP_SUPPORTED_SCOPES))
}).strict();

/**
 * Builds the encrypted props for one access token. `requestedScope` is the
 * provider-computed effective scope for this token, not the wider grant scope.
 */
export function createMcpAccessTokenProps(input: {
  userId: string;
  clientId: string;
  requestedScope: readonly string[];
}): SignalDeskMcpAccessTokenProps {
  const identity = z.object({
    userId: z.string().min(1),
    clientId: z.string().min(1)
  }).parse(input);
  const scopes = [...new Set(input.requestedScope.filter(
    (scope): scope is (typeof MCP_SUPPORTED_SCOPES)[number] => MCP_SUPPORTED_SCOPES.includes(
      scope as (typeof MCP_SUPPORTED_SCOPES)[number]
    )
  ))];
  return {
    context: MCP_ACCESS_TOKEN_CONTEXT,
    userId: identity.userId,
    clientId: identity.clientId,
    scopes
  };
}

type MonitorPatch = Partial<Omit<MonitorInput, 'origin'>> & {
  status?: MonitorStatus;
};

export interface SignalDeskMcpOperations {
  loadState(userId: string): Promise<AppState>;
  createMonitor(userId: string, input: MonitorInput): Promise<Monitor>;
  updateMonitor(userId: string, monitorId: string, patch: MonitorPatch): Promise<AppState>;
  deleteMonitor(userId: string, monitorId: string): Promise<AppState>;
  runMonitor(userId: string, monitorId: string): Promise<AppState>;
}

const categorySchema = z.enum(['market', 'news', 'website', 'report']);
const severitySchema = z.enum(['info', 'warning', 'critical']);
const frequencySchema = z.enum(['hourly', 'daily', 'weekdays', 'weekly']);
const statusSchema = z.enum(['active', 'paused', 'error']);
const outcomeSchema = z.enum(['matched', 'clear', 'failed', 'never']);
const httpsUrlSchema = z.string().trim().max(2048).refine((value) => {
  return isSafePublicHttpsUrl(value);
}, '公開ネットワーク上のHTTPS URLを指定してください');

const monitorSchema = z.object({
  id: z.string(),
  title: z.string(),
  instruction: z.string(),
  category: categorySchema,
  sourceUrl: z.string().optional(),
  status: statusSchema,
  schedule: z.object({
    frequency: frequencySchema,
    time: z.string(),
    timezone: z.string()
  }),
  severity: severitySchema,
  notificationsEnabled: z.boolean(),
  origin: z.enum(['native', 'chatgpt-manual', 'demo']),
  lastRunAt: z.string().optional(),
  lastSuccessAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  lastOutcome: outcomeSchema,
  lastSummary: z.string(),
  consecutiveFailures: z.number().int().nonnegative(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const notificationSchema = z.object({
  id: z.string(),
  monitorId: z.string(),
  monitorTitle: z.string(),
  runId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  severity: severitySchema,
  status: z.enum(['unread', 'read', 'snoozed']),
  detectedAt: z.string(),
  readAt: z.string().optional(),
  snoozedUntil: z.string().optional(),
  sourceUrl: z.string().optional(),
  dedupeKey: z.string(),
  isDemo: z.boolean()
});

function securityMeta(scopes: string[], invoking: string, invoked: string) {
  return {
    securitySchemes: [{ type: 'oauth2', scopes }],
    'openai/toolInvocation/invoking': invoking,
    'openai/toolInvocation/invoked': invoked
  };
}

function principal(requiredScope: string): { userId: string } {
  const parsed = accessTokenPropsSchema.safeParse(getMcpAuthContext()?.props);
  if (!parsed.success) {
    throw new Error('Signal Deskへの認証が必要です。');
  }
  if (!parsed.data.scopes.includes(requiredScope as (typeof MCP_SUPPORTED_SCOPES)[number])) {
    throw new Error(`必要な権限がありません: ${requiredScope}`);
  }
  return { userId: parsed.data.userId };
}

function textResult<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : '操作に失敗しました。';
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }]
  };
}

function findMonitor(state: AppState, monitorId: string): Monitor {
  const monitor = state.monitors.find((item) => item.id === monitorId);
  if (!monitor) throw new Error('対象の監視項目が見つかりません。');
  return monitor;
}

export function createSignalDeskMcpServer(operations: SignalDeskMcpOperations): McpServer {
  const server = new McpServer({ name: 'Signal Desk', version: '1.0.0' });

  server.registerTool(
    'list_monitors',
    {
      title: '監視項目を一覧表示',
      description: 'Signal Deskに登録済みの監視項目を、状態やカテゴリで絞り込んで返します。',
      inputSchema: z.object({
        status: statusSchema.optional(),
        category: categorySchema.optional()
      }),
      outputSchema: z.object({ monitors: z.array(monitorSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.read], '監視項目を取得中', '監視項目を取得しました')
    },
    async ({ status, category }) => {
      try {
        const { userId } = principal(MCP_SCOPES.read);
        const state = await operations.loadState(userId);
        const monitors = state.monitors.filter(
          (monitor) => (!status || monitor.status === status) && (!category || monitor.category === category)
        );
        return textResult({ monitors });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_notifications',
    {
      title: '通知を取得',
      description: 'Signal Deskの通知を新しい順で返します。未読だけに絞り込めます。',
      inputSchema: z.object({
        status: z.enum(['unread', 'read', 'snoozed']).optional(),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      outputSchema: z.object({ notifications: z.array(notificationSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.read], '通知を取得中', '通知を取得しました')
    },
    async ({ status, limit }) => {
      try {
        const { userId } = principal(MCP_SCOPES.read);
        const state = await operations.loadState(userId);
        const notifications = state.notifications
          .filter((notification) => !status || notification.status === status)
          .slice(0, limit);
        return textResult({ notifications });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'create_monitor',
    {
      title: '監視項目を作成',
      description: 'Signal Deskを正本として、新しい監視項目と実行予定を登録します。',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(80),
        instruction: z.string().trim().min(1).max(500),
        category: categorySchema,
        sourceUrl: httpsUrlSchema.optional(),
        frequency: frequencySchema,
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        severity: severitySchema,
        notificationsEnabled: z.boolean().default(true),
        startActive: z.boolean().default(true)
      }),
      outputSchema: z.object({ monitor: monitorSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.write], '監視項目を作成中', '監視項目を作成しました')
    },
    async (input) => {
      try {
        const { userId } = principal(MCP_SCOPES.write);
        const monitor = await operations.createMonitor(userId, {
          ...input,
          origin: 'native'
        });
        return textResult({ monitor });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'update_monitor',
    {
      title: '監視項目を更新',
      description: '指定した監視項目の名称、条件、取得元、予定、重要度、通知設定を更新します。',
      inputSchema: z.object({
        monitorId: z.string().min(1),
        title: z.string().trim().min(1).max(80).optional(),
        instruction: z.string().trim().min(1).max(500).optional(),
        category: categorySchema.optional(),
        sourceUrl: z.union([httpsUrlSchema, z.literal('')]).optional(),
        frequency: frequencySchema.optional(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        severity: severitySchema.optional(),
        notificationsEnabled: z.boolean().optional()
      }),
      outputSchema: z.object({ monitor: monitorSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.write], '監視項目を更新中', '監視項目を更新しました')
    },
    async ({ monitorId, ...patch }) => {
      try {
        const { userId } = principal(MCP_SCOPES.write);
        const state = await operations.updateMonitor(userId, monitorId, patch);
        return textResult({ monitor: findMonitor(state, monitorId) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'pause_monitor',
    {
      title: '監視を停止・再開',
      description: '指定した監視項目を停止、または再開します。',
      inputSchema: z.object({
        monitorId: z.string().min(1),
        paused: z.boolean()
      }),
      outputSchema: z.object({ monitor: monitorSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.write], '監視状態を更新中', '監視状態を更新しました')
    },
    async ({ monitorId, paused }) => {
      try {
        const { userId } = principal(MCP_SCOPES.write);
        const state = await operations.updateMonitor(userId, monitorId, {
          status: paused ? 'paused' : 'active'
        });
        return textResult({ monitor: findMonitor(state, monitorId) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'run_monitor',
    {
      title: '監視を今すぐ実行',
      description: '指定した監視項目を直ちに実行し、結果と通知をSignal Deskへ保存します。',
      inputSchema: z.object({ monitorId: z.string().min(1) }),
      outputSchema: z.object({ monitor: monitorSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: securityMeta([MCP_SCOPES.run], '監視を実行中', '監視を実行しました')
    },
    async ({ monitorId }) => {
      try {
        const { userId } = principal(MCP_SCOPES.run);
        const state = await operations.runMonitor(userId, monitorId);
        return textResult({ monitor: findMonitor(state, monitorId) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'delete_monitor',
    {
      title: '監視項目を削除',
      description: '指定した監視項目をSignal Deskから削除します。実行履歴と通知は監査用に残します。',
      inputSchema: z.object({ monitorId: z.string().min(1) }),
      outputSchema: z.object({ deletedMonitorId: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: securityMeta([MCP_SCOPES.write], '監視項目を削除中', '監視項目を削除しました')
    },
    async ({ monitorId }) => {
      try {
        const { userId } = principal(MCP_SCOPES.write);
        await operations.deleteMonitor(userId, monitorId);
        return textResult({ deletedMonitorId: monitorId });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

export type {
  AlertNotification,
  Monitor,
  MonitorCategory,
  MonitorFrequency,
  MonitorSeverity,
  MonitorStatus
};
