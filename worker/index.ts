import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { handleApiRequest } from './api';
import {
  createMonitorRecord,
  deleteMonitorRecord,
  getAppState,
  updateMonitorRecord
} from './db';
import { createApiExtension } from './extensions';
import {
  createMcpAccessTokenProps,
  createSignalDeskMcpServer,
  MCP_SCOPES,
  MCP_SUPPORTED_SCOPES,
  type SignalDeskMcpOperations
} from './mcp';
import { handleAuthorizationRequest, type OAuthWorkerEnv } from './oauth';
import {
  MonitorBusyError,
  MonitorNotFoundError,
  runDueMonitors,
  runMonitor as executeMonitor
} from './runner';
import type { MonitorPatch } from './validation';

function createMcpOperations(env: OAuthWorkerEnv): SignalDeskMcpOperations {
  const requireCurrentOwner = (userId: string): string => {
    if (userId !== env.APP_OWNER_ID) {
      throw new Error('この接続は現在のSignal Desk所有者には使用できません。再接続してください。');
    }
    return userId;
  };
  return {
    loadState: (userId) => getAppState(env.DB, requireCurrentOwner(userId)),
    createMonitor: (userId, input) => createMonitorRecord(env.DB, requireCurrentOwner(userId), input),
    async updateMonitor(userId, monitorId, patch) {
      userId = requireCurrentOwner(userId);
      const normalizedPatch: MonitorPatch = {
        ...patch,
        status: patch.status === 'error' ? undefined : patch.status,
        sourceUrl: patch.sourceUrl === '' ? null : patch.sourceUrl
      };
      const updated = await updateMonitorRecord(env.DB, userId, monitorId, normalizedPatch);
      if (!updated) throw new Error('対象の監視項目が見つかりません。');
      return getAppState(env.DB, userId);
    },
    async deleteMonitor(userId, monitorId) {
      userId = requireCurrentOwner(userId);
      if (!await deleteMonitorRecord(env.DB, userId, monitorId)) {
        throw new Error('対象の監視項目が見つかりません。');
      }
      return getAppState(env.DB, userId);
    },
    async runMonitor(userId, monitorId) {
      userId = requireCurrentOwner(userId);
      try {
        await executeMonitor(env, userId, monitorId, { trigger: 'manual' });
      } catch (error) {
        if (error instanceof MonitorNotFoundError) {
          throw new Error('対象の監視項目が見つかりません。');
        }
        if (error instanceof MonitorBusyError) {
          throw new Error('この監視項目はすでに実行中です。');
        }
        throw error;
      }
      return getAppState(env.DB, userId);
    }
  };
}

const mcpApiHandler = {
  fetch(request: Request, env: OAuthWorkerEnv, ctx: ExecutionContext) {
    const handler = createMcpHandler(
      () => createSignalDeskMcpServer(createMcpOperations(env)),
      {
        route: '/mcp',
        legacy: 'stateless',
        onerror(error) {
          console.error(JSON.stringify({
            event: 'mcp_error',
            error: error.message
          }));
        }
      }
    );
    return handler(request, env, ctx);
  }
};

const defaultHandler = {
  async fetch(request: Request, env: OAuthWorkerEnv) {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') {
      return handleAuthorizationRequest(request, env);
    }

    const apiResponse = await handleApiRequest(
      request,
      {
        db: env.DB,
        loginSecret: env.APP_LOGIN_SECRET,
        userId: env.APP_OWNER_ID
      },
      [createApiExtension(env)]
    );
    if (apiResponse) return apiResponse;

    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', service: 'signal-desk' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (['/', '/index.html', '/signal-desk', '/signal-desk/index.html'].includes(url.pathname)) {
      url.pathname = '/signal-desk/';
      return Response.redirect(url.toString(), 308);
    }

    let assetRequest = request;
    if (url.pathname.startsWith('/signal-desk/')) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetUrl.pathname.slice('/signal-desk'.length) || '/';
      assetRequest = new Request(assetUrl, request);
    }
    const response = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "manifest-src 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "worker-src 'self'"
    ].join('; '));
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};

const oauthProvider = new OAuthProvider<OAuthWorkerEnv>({
  apiRoute: '/mcp',
  apiHandler: mcpApiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  scopesSupported: [...MCP_SUPPORTED_SCOPES],
  resourceMetadata: {
    scopes_supported: [MCP_SCOPES.read, MCP_SCOPES.write, MCP_SCOPES.run],
    bearer_methods_supported: ['header'],
    resource_name: 'Signal Desk MCP'
  },
  clientIdMetadataDocumentEnabled: true,
  allowPlainPKCE: false,
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  clientRegistrationTTL: 90 * 24 * 60 * 60,
  tokenExchangeCallback({ userId, clientId, requestedScope }) {
    return {
      accessTokenProps: createMcpAccessTokenProps({
        userId,
        clientId,
        requestedScope
      })
    };
  }
});

export default {
  fetch(request, env, ctx) {
    return oauthProvider.fetch(request, env as OAuthWorkerEnv, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runDueMonitors(env, { scheduledTime: controller.scheduledTime })
        .then((report) => {
          console.log(JSON.stringify({
            event: 'scheduled_monitors_complete',
            considered: report.considered,
            completed: report.completed,
            failed: report.failed,
            deduplicated: report.deduplicated
          }));
        })
        .catch((error: unknown) => {
          console.error(JSON.stringify({
            event: 'scheduled_monitors_failed',
            error: error instanceof Error ? error.message : 'unknown error'
          }));
        })
    );
  }
} satisfies ExportedHandler<Env>;
