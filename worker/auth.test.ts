import { describe, expect, it } from 'vitest';
import {
  createSecureToken,
  isLoginSecretConfigured,
  isSameOriginRequest
} from './auth';

describe('login configuration', () => {
  it('requires a non-trivial server-side login secret', () => {
    expect(isLoginSecretConfigured(undefined)).toBe(false);
    expect(isLoginSecretConfigured('too-short')).toBe(false);
    expect(isLoginSecretConfigured('replace-with-a-random-passphrase-at-least-16-characters')).toBe(false);
    expect(isLoginSecretConfigured('this-is-a-placeholder-secret')).toBe(false);
    expect(isLoginSecretConfigured('a-long-passphrase-for-signal-desk')).toBe(true);
  });

  it('creates distinct base64url tokens without Math.random', () => {
    const first = createSecureToken();
    const second = createSecureToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).toHaveLength(43);
    expect(second).not.toBe(first);
  });
});

describe('same-origin mutation guard', () => {
  it('allows safe reads without an Origin header', () => {
    expect(isSameOriginRequest(new Request('https://signal.example/api/state'))).toBe(true);
  });

  it('allows same-origin writes', () => {
    expect(isSameOriginRequest(new Request('https://signal.example/api/monitors', {
      method: 'POST',
      headers: {
        Origin: 'https://signal.example',
        'Sec-Fetch-Site': 'same-origin'
      }
    }))).toBe(true);
  });

  it('rejects missing and cross-origin mutation context', () => {
    expect(isSameOriginRequest(new Request('https://signal.example/api/monitors', {
      method: 'POST'
    }))).toBe(false);
    expect(isSameOriginRequest(new Request('https://signal.example/api/monitors', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site'
      }
    }))).toBe(false);
  });
});
