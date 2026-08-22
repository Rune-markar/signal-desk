import { describe, expect, it } from 'vitest';
import { handleApiRequest } from './api';

describe('POST /api/auth/logout', () => {
  it('removes the current device push subscription before destroying the session', async () => {
    const executed: string[] = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async first() {
            if (sql.includes('SELECT user_id') && sql.includes('FROM sessions')) {
              return { user_id: 'owner' };
            }
            if (sql.includes('COUNT(*)') && sql.includes('push_subscriptions')) {
              return { total: 0 };
            }
            return null;
          },
          async run() {
            executed.push(sql);
            return { meta: { changes: 1 } };
          }
        };
        return statement;
      }
    } as unknown as D1Database;
    const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/device';
    const response = await handleApiRequest(
      new Request('https://signal.example/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'signal_desk_session=test-session-token',
          Origin: 'https://signal.example',
          'Sec-Fetch-Site': 'same-origin'
        },
        body: JSON.stringify({ pushEndpoint: endpoint })
      }),
      { db, loginSecret: 'a-long-passphrase-for-signal-desk', userId: 'owner' }
    );

    expect(response?.status).toBe(200);
    expect(executed.findIndex((sql) => sql.includes('DELETE FROM push_subscriptions'))).toBeGreaterThanOrEqual(0);
    expect(executed.findIndex((sql) => sql.includes('DELETE FROM sessions'))).toBeGreaterThan(
      executed.findIndex((sql) => sql.includes('DELETE FROM push_subscriptions'))
    );
  });
});
