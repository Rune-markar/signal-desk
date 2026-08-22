import { describe, expect, it } from 'vitest';
import webPush from 'web-push';
import { isSafePushEndpoint, isVapidConfigured } from './push';

describe('isSafePushEndpoint', () => {
  it('accepts a public HTTPS push service endpoint', () => {
    expect(isSafePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example')).toBe(true);
    expect(isSafePushEndpoint('https://[2606:4700:4700::1111]/push')).toBe(true);
  });

  it.each([
    'http://push.example.com/subscription',
    'https://user:secret@push.example.com/subscription',
    'https://localhost/subscription',
    'https://push.local/subscription',
    'https://127.0.0.1/subscription',
    'https://169.254.169.254/subscription',
    'https://192.168.1.5/subscription',
    'https://[::1]/subscription',
    'https://[2001:db8::1]/subscription',
    'https://[fec0::1]/subscription',
    'https://[64:ff9b:1::1]/subscription',
    'https://[2001:10::1]/subscription',
    'https://[2001:20::1]/subscription',
    'https://[3fff::1]/subscription'
  ])('rejects an unsafe endpoint: %s', (endpoint) => {
    expect(isSafePushEndpoint(endpoint)).toBe(false);
  });
});

describe('isVapidConfigured', () => {
  it('accepts a generated VAPID key pair and valid subject', () => {
    const keys = webPush.generateVAPIDKeys();
    expect(isVapidConfigured({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:admin@example.com'
    })).toBe(true);
  });

  it('rejects individually valid keys that are not the same VAPID pair', () => {
    const first = webPush.generateVAPIDKeys();
    const second = webPush.generateVAPIDKeys();
    expect(isVapidConfigured({
      VAPID_PUBLIC_KEY: first.publicKey,
      VAPID_PRIVATE_KEY: second.privateKey,
      VAPID_SUBJECT: 'mailto:admin@example.com'
    })).toBe(false);
  });

  it('requires canonical URL-safe Base64 without padding', () => {
    const keys = webPush.generateVAPIDKeys();
    expect(isVapidConfigured({
      VAPID_PUBLIC_KEY: Buffer.from(keys.publicKey, 'base64url').toString('base64'),
      VAPID_PRIVATE_KEY: Buffer.from(keys.privateKey, 'base64url').toString('base64'),
      VAPID_SUBJECT: 'mailto:admin@example.com'
    })).toBe(false);
  });

  it('rejects placeholders and missing values', () => {
    expect(isVapidConfigured({
      VAPID_PUBLIC_KEY: 'placeholder',
      VAPID_PRIVATE_KEY: 'placeholder',
      VAPID_SUBJECT: 'mailto:admin@example.com'
    })).toBe(false);
    expect(isVapidConfigured({})).toBe(false);
  });
});
