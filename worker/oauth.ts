import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers
} from '@cloudflare/workers-oauth-provider';
import {
  CSRF_COOKIE_NAME,
  authenticateLoginAttempt,
  createSession,
  getAuthenticatedUser,
  isLoginSecretConfigured,
  isSameOriginRequest,
  makeCsrfCookie,
  verifyCsrfToken
} from './auth';
import { MCP_SUPPORTED_SCOPES } from './mcp';

export interface OAuthWorkerEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

const SCOPE_LABELS: Record<string, string> = {
  'monitors:read': '監視項目と通知を読む',
  'monitors:write': '監視項目を作成・更新・削除する',
  'monitors:run': '監視を実行して結果を保存する',
  offline_access: '接続を維持する'
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function securityHeaders(contentType = 'text/html; charset=utf-8'): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Security-Policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
}

function htmlResponse(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders();
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(body, { status, headers });
}

function renderPage(title: string, content: string): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Signal Desk</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f3f5f3; color: #183236; }
      body { margin: 0; padding: 24px; }
      main { max-width: 620px; margin: 8vh auto; padding: 28px; border-radius: 20px; background: #fff; box-shadow: 0 18px 60px #123f4a1f; }
      h1 { margin-top: 0; font-size: 1.55rem; }
      p, li { line-height: 1.65; }
      .client { padding: 14px 16px; border-radius: 12px; background: #eaf2ef; font-weight: 700; }
      label { display: grid; gap: 8px; margin: 20px 0; font-weight: 700; }
      input { min-height: 44px; padding: 0 12px; border: 1px solid #8ca2a0; border-radius: 10px; font: inherit; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
      button, a.button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 999px; font: inherit; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
      button.primary { color: #fff; background: #123f4a; }
      button.secondary, a.button { color: #123f4a; background: #dce9e5; }
      .note { color: #53696c; font-size: .92rem; }
      .error { padding: 12px; border-radius: 10px; color: #7d1c16; background: #fff0ed; }
    </style>
  </head>
  <body><main>${content}</main></body>
</html>`;
}

function clearCsrfCookie(): string {
  return [
    `${CSRF_COOKIE_NAME}=`,
    'Path=/authorize',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');
}

function oauthErrorResponse(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error;
  if (error.redirectUri) {
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set('error', error.code);
    redirect.searchParams.set('error_description', error.description);
    if (error.state) redirect.searchParams.set('state', error.state);
    if (error.issuer) redirect.searchParams.set('iss', error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }
  return htmlResponse(
    renderPage(
      '接続要求を確認できません',
      `<h1>接続要求を確認できません</h1><p class="error">${escapeHtml(error.description)}</p>`
    ),
    400
  );
}

async function parseAuthorizationRequest(
  request: Request,
  oauth: OAuthHelpers
): Promise<AuthRequest | Response> {
  try {
    return await oauth.parseAuthRequest(request);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

function denyAuthorization(authRequest: AuthRequest): Response {
  const redirect = new URL(authRequest.redirectUri);
  redirect.searchParams.set('error', 'access_denied');
  redirect.searchParams.set('error_description', 'ユーザーが接続を許可しませんでした。');
  redirect.searchParams.set('state', authRequest.state);
  if (authRequest.issuer) redirect.searchParams.set('iss', authRequest.issuer);
  const headers = new Headers({ Location: redirect.toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearCsrfCookie());
  return new Response(null, { status: 302, headers });
}

function requireMcpResource(authRequest: AuthRequest, request: Request): Response | null {
  const expected = `${new URL(request.url).origin}/mcp`;
  const resources = Array.isArray(authRequest.resource)
    ? authRequest.resource
    : authRequest.resource
      ? [authRequest.resource]
      : [];
  if (resources.length === 1 && resources[0] === expected) return null;

  const redirect = new URL(authRequest.redirectUri);
  redirect.searchParams.set('error', 'invalid_target');
  redirect.searchParams.set('error_description', `接続先resourceは ${expected} である必要があります。`);
  redirect.searchParams.set('state', authRequest.state);
  if (authRequest.issuer) redirect.searchParams.set('iss', authRequest.issuer);
  return new Response(null, {
    status: 302,
    headers: { Location: redirect.toString(), 'Cache-Control': 'no-store' }
  });
}

async function authorizationGet(request: Request, env: OAuthWorkerEnv): Promise<Response> {
  const parsed = await parseAuthorizationRequest(request, env.OAUTH_PROVIDER);
  if (parsed instanceof Response) return parsed;
  const resourceError = requireMcpResource(parsed, request);
  if (resourceError) return resourceError;
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client) return htmlResponse(renderPage('不明な接続元', '<h1>不明な接続元です</h1>'), 400);

  const authenticatedUser = await getAuthenticatedUser(request, env.DB);
  const userId = authenticatedUser === env.APP_OWNER_ID ? authenticatedUser : null;
  if (!userId && !isLoginSecretConfigured(env.APP_LOGIN_SECRET)) {
    return htmlResponse(
      renderPage('認証設定が必要です', '<h1>Signal Deskのログイン設定が未完了です</h1>'),
      503
    );
  }
  const csrf = makeCsrfCookie();
  const requestedScopes = parsed.scope.filter((scope) => MCP_SUPPORTED_SCOPES.includes(
    scope as (typeof MCP_SUPPORTED_SCOPES)[number]
  ));
  const scopeItems = requestedScopes
    .map((scope) => `<li>${escapeHtml(SCOPE_LABELS[scope] ?? scope)}</li>`)
    .join('');
  const actionUrl = new URL(request.url);
  const secretField = userId
    ? '<p class="note">Signal Deskへログイン済みです。</p>'
    : `<label>Signal Deskのログイン用パスフレーズ
         <input type="password" name="secret" autocomplete="current-password" required>
       </label>
       <p class="note">パスフレーズはこのWorker内でだけ検証され、MCPクライアントには渡りません。</p>`;

  const body = renderPage(
    'ChatGPTとの接続を確認',
    `<h1>ChatGPTとの接続を確認</h1>
     <p class="client">接続元: ${escapeHtml(client.clientName || parsed.clientId)}</p>
     <p>次の操作をSignal Deskに許可します。</p>
     <ul>${scopeItems || '<li>基本接続</li>'}</ul>
     <form method="post" action="${escapeHtml(actionUrl.pathname + actionUrl.search)}">
       <input type="hidden" name="csrf_token" value="${escapeHtml(csrf.token)}">
       <input type="text" name="username" autocomplete="username" value="owner" readonly hidden>
       ${secretField}
       <div class="actions">
         <button class="primary" type="submit" name="decision" value="approve">許可して接続</button>
         <button class="secondary" type="submit" name="decision" value="deny">キャンセル</button>
       </div>
     </form>`
  );
  return htmlResponse(body, 200, { 'Set-Cookie': csrf.cookie });
}

async function authorizationPost(request: Request, env: OAuthWorkerEnv): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return htmlResponse(renderPage('不正な要求', '<h1>不正な要求です</h1>'), 403);
  }

  const parsed = await parseAuthorizationRequest(request, env.OAUTH_PROVIDER);
  if (parsed instanceof Response) return parsed;
  const resourceError = requireMcpResource(parsed, request);
  if (resourceError) return resourceError;
  const form = await request.formData();
  const csrfToken = form.get('csrf_token');
  if (typeof csrfToken !== 'string' || !(await verifyCsrfToken(request, csrfToken))) {
    return htmlResponse(renderPage('期限切れ', '<h1>確認画面の有効期限が切れました</h1>'), 400, {
      'Set-Cookie': clearCsrfCookie()
    });
  }
  if (form.get('decision') !== 'approve') return denyAuthorization(parsed);

  const authenticatedUser = await getAuthenticatedUser(request, env.DB);
  let userId = authenticatedUser === env.APP_OWNER_ID ? authenticatedUser : null;
  let sessionCookie: string | undefined;
  if (!userId) {
    const secret = form.get('secret');
    if (typeof secret !== 'string') {
      return htmlResponse(renderPage('認証が必要です', '<h1>パスフレーズが必要です</h1>'), 401);
    }
    const attempt = await authenticateLoginAttempt(
      request,
      env.DB,
      secret,
      env.APP_LOGIN_SECRET,
      env.APP_OWNER_ID
    );
    if (attempt.rateLimited) {
      return htmlResponse(
        renderPage('しばらくお待ちください', '<h1>ログイン試行回数が上限に達しました</h1>'),
        429,
        { 'Retry-After': String(attempt.retryAfterSeconds ?? 900) }
      );
    }
    if (!attempt.authenticated) {
      return htmlResponse(renderPage('認証できません', '<h1>パスフレーズが一致しません</h1>'), 401);
    }
    userId = env.APP_OWNER_ID;
    sessionCookie = (await createSession(env.DB, userId)).cookie;
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client) return htmlResponse(renderPage('不明な接続元', '<h1>不明な接続元です</h1>'), 400);
  const grantedScopes = parsed.scope.filter((scope) => MCP_SUPPORTED_SCOPES.includes(
    scope as (typeof MCP_SUPPORTED_SCOPES)[number]
  ));
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId,
    metadata: { clientName: client.clientName || 'MCP client' },
    scope: grantedScopes,
    props: {
      userId,
      clientId: parsed.clientId
    }
  });

  const headers = new Headers({ Location: redirectTo, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearCsrfCookie());
  if (sessionCookie) headers.append('Set-Cookie', sessionCookie);
  return new Response(null, { status: 302, headers });
}

export async function handleAuthorizationRequest(
  request: Request,
  env: OAuthWorkerEnv
): Promise<Response> {
  if (request.method === 'GET') return authorizationGet(request, env);
  if (request.method === 'POST') return authorizationPost(request, env);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET, POST', 'Cache-Control': 'no-store' }
  });
}
