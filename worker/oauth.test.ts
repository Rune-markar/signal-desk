import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './oauth-csp';

describe('OAuth content security policy', () => {
  it('allows the exact validated loopback callback origin', () => {
    const policy = buildContentSecurityPolicy(
      'http://127.0.0.1:52803/callback/1O6TymTBwyRo?source=codex'
    );

    expect(policy).toContain("form-action 'self' http://127.0.0.1:52803");
    expect(policy).not.toContain('/callback/1O6TymTBwyRo');
  });

  it('allows an HTTPS callback origin without weakening other directives', () => {
    const policy = buildContentSecurityPolicy(
      'https://chatgpt.com/connector/oauth/signal-desk'
    );

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'self' https://chatgpt.com");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('does not add unsupported redirect schemes', () => {
    const policy = buildContentSecurityPolicy('custom-app://callback/complete');

    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain('custom-app:');
  });
});
