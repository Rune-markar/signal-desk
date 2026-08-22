import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/domain/seed';
import type { AppState } from '../src/domain/model';
import {
  deleteMonitorRecord,
  migrateLocalState,
  MonitorMutationBusyError,
  updateMonitorRecord,
  updatePreferencesRecord,
  type MonitorRow
} from './db';

interface CapturedStatement {
  sql: string;
  values: unknown[];
}

function recordingDatabase() {
  const batches: CapturedStatement[][] = [];
  const db = {
    prepare(sql: string) {
      const captured: CapturedStatement = { sql, values: [] };
      const statement = {
        captured,
        bind(...values: unknown[]) {
          captured.values = values;
          return statement;
        },
        async first() {
          return {
            timezone: 'Asia/Tokyo',
            quiet_hours_enabled: 1,
            quiet_from: '22:00',
            quiet_to: '07:00',
            push_enabled: 0,
            demo_mode: 0
          };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ captured: CapturedStatement }>) {
      batches.push(statements.map((statement) => statement.captured));
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  return { db: db as unknown as D1Database, batches };
}

describe('migrateLocalState', () => {
  it('imports real records without changing server preferences or existing monitor schedules', async () => {
    const now = new Date('2026-08-22T06:00:00.000Z');
    const demo = createInitialState(now);
    const state: AppState = {
      ...demo,
      preferences: {
        timezone: 'UTC',
        quietHoursEnabled: false,
        quietFrom: '00:00',
        quietTo: '00:01',
        pushEnabled: true,
        demoMode: false
      },
      monitors: [
        ...demo.monitors,
        {
          ...demo.monitors[0]!,
          id: 'local-monitor',
          origin: 'native',
          schedule: { frequency: 'daily', time: '09:00', timezone: 'UTC' }
        }
      ],
      runs: [
        ...demo.runs,
        {
          ...demo.runs[0]!,
          id: 'local-run',
          monitorId: 'local-monitor',
          isDemo: false,
          status: 'clear'
        }
      ],
      notifications: [
        ...demo.notifications,
        {
          ...demo.notifications[0]!,
          id: 'local-notification',
          monitorId: 'local-monitor',
          dedupeKey: 'local-notification',
          isDemo: false
        }
      ]
    };
    const { db, batches } = recordingDatabase();

    const imported = await migrateLocalState(db, 'owner', state, now);

    expect(imported).toEqual({ monitors: 1, runs: 1, notifications: 1 });
    expect(batches).toHaveLength(2);
    const migrationSql = batches[1]!.map((statement) => statement.sql).join('\n');
    expect(batches[1]).toHaveLength(3);
    expect(migrationSql).not.toMatch(/UPDATE\s+preferences/i);
    expect(migrationSql).not.toMatch(/UPDATE\s+monitors/i);
    expect(migrationSql).toMatch(/INSERT OR IGNORE INTO monitors/i);
    expect(migrationSql).toMatch(/INSERT OR IGNORE INTO runs/i);
    expect(migrationSql).toMatch(/INSERT OR IGNORE INTO notifications/i);
    expect(batches[1]![0]!.values).toContain('Asia/Tokyo');
  });
});

describe('monitor mutation leases', () => {
  it('rejects edits while a monitor execution has an active lease', async () => {
    const db = {
      prepare() {
        const statement = {
          bind() { return statement; },
          async first() {
            return { lease_until: '2026-08-22T06:10:00.000Z' };
          }
        };
        return statement;
      }
    } as unknown as D1Database;

    await expect(updateMonitorRecord(
      db,
      'owner',
      'monitor-1',
      { title: '変更後' },
      new Date('2026-08-22T06:00:00.000Z')
    )).rejects.toBeInstanceOf(MonitorMutationBusyError);
  });

  it('rejects deletion when a lease is acquired before the conditional delete', async () => {
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async run() { return { meta: { changes: 0 } }; },
          async first() {
            return sql.includes('SELECT lease_until')
              ? { lease_until: '2026-08-22T06:10:00.000Z' }
              : null;
          }
        };
        return statement;
      }
    } as unknown as D1Database;

    await expect(deleteMonitorRecord(
      db,
      'owner',
      'monitor-1',
      new Date('2026-08-22T06:00:00.000Z')
    )).rejects.toBeInstanceOf(MonitorMutationBusyError);
  });

  it('rejects a timezone change atomically when any monitor has an active lease', async () => {
    const batches: CapturedStatement[][] = [];
    let batchIndex = 0;
    const activeMonitor: MonitorRow = {
      user_id: 'owner',
      id: 'monitor-1',
      title: '監視',
      instruction: '条件',
      category: 'news',
      source_url: null,
      status: 'active',
      schedule_frequency: 'daily',
      schedule_time: '09:00',
      schedule_timezone: 'Asia/Tokyo',
      severity: 'warning',
      notifications_enabled: 1,
      origin: 'native',
      last_run_at: null,
      last_success_at: null,
      next_run_at: '2026-08-23T00:00:00.000Z',
      last_outcome: 'never',
      last_summary: '',
      consecutive_failures: 0,
      error_message: null,
      lease_until: '2026-08-22T06:10:00.000Z',
      lease_token: 'lease-token',
      created_at: '2026-08-22T05:00:00.000Z',
      updated_at: '2026-08-22T06:00:00.000Z'
    };
    const db = {
      prepare(sql: string) {
        const captured: CapturedStatement = { sql, values: [] };
        const statement = {
          captured,
          bind(...values: unknown[]) {
            captured.values = values;
            return statement;
          },
          async first() {
            if (sql.includes('FROM preferences')) {
              return {
                timezone: 'Asia/Tokyo',
                quiet_hours_enabled: 1,
                quiet_from: '22:00',
                quiet_to: '07:00',
                push_enabled: 0,
                demo_mode: 0
              };
            }
            return null;
          },
          async all() {
            return { results: sql.includes('SELECT * FROM monitors') ? [activeMonitor] : [] };
          }
        };
        return statement;
      },
      async batch(statements: Array<{ captured: CapturedStatement }>) {
        batches.push(statements.map((statement) => statement.captured));
        batchIndex += 1;
        return statements.map(() => ({ meta: { changes: batchIndex === 1 ? 1 : 0 } }));
      }
    } as unknown as D1Database;

    await expect(updatePreferencesRecord(
      db,
      'owner',
      { timezone: 'UTC' },
      new Date('2026-08-22T06:00:00.000Z')
    )).rejects.toBeInstanceOf(MonitorMutationBusyError);

    const guardedBatch = batches[1]!;
    expect(guardedBatch).toHaveLength(2);
    expect(guardedBatch[0]!.sql).toMatch(/NOT EXISTS[\s\S]*lease_until/i);
    expect(guardedBatch[1]!.sql).toMatch(/json_each/i);
    expect(guardedBatch[1]!.sql).toMatch(/preferences[\s\S]*updated_at/i);
  });
});
