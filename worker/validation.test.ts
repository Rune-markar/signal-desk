import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/domain/seed';
import {
  localMigrationStateSchema,
  MAX_MIGRATION_RECORDS_PER_REQUEST,
  migrationInputSchema,
  notificationBatchPatchSchema
} from './validation';

function migrationWithMonitorCount(count: number) {
  const base = createInitialState(new Date('2026-08-22T06:00:00.000Z'));
  const monitor = base.monitors[0]!;
  return {
    state: {
      ...base,
      preferences: { ...base.preferences, demoMode: false },
      monitors: Array.from({ length: count }, (_, index) => ({
        ...monitor,
        id: `local-${index}`,
        origin: 'native' as const
      })),
      runs: [],
      notifications: []
    }
  };
}

describe('migrationInputSchema', () => {
  it('caps each idempotent migration chunk for the D1 per-invocation query budget', () => {
    expect(migrationInputSchema.safeParse(
      migrationWithMonitorCount(MAX_MIGRATION_RECORDS_PER_REQUEST)
    ).success).toBe(true);
    expect(migrationInputSchema.safeParse(
      migrationWithMonitorCount(MAX_MIGRATION_RECORDS_PER_REQUEST + 1)
    ).success).toBe(false);
  });

  it.each([
    'http://example.com/status',
    'https://localhost/status',
    'https://192.168.1.10/status'
  ])('does not import an unsafe source URL: %s', (sourceUrl) => {
    const input = migrationWithMonitorCount(1);
    input.state.monitors[0]!.sourceUrl = sourceUrl;
    expect(migrationInputSchema.safeParse(input).success).toBe(false);
  });

  it('lets the client load a legacy HTTP monitor for repair but validates the rest of the file', () => {
    const input = migrationWithMonitorCount(1).state;
    input.monitors[0]!.sourceUrl = 'http://legacy.example.com/status';
    expect(localMigrationStateSchema.safeParse(input).success).toBe(true);

    input.preferences.timezone = 'Mars/Olympus';
    expect(localMigrationStateSchema.safeParse(input).success).toBe(false);
  });
});

describe('notificationBatchPatchSchema', () => {
  it('keeps timestamp, owner and notification IDs within D1s 100 bind limit', () => {
    const payload = (count: number) => ({
      status: 'read' as const,
      notificationIds: Array.from({ length: count }, (_, index) => `notification-${index}`)
    });
    expect(notificationBatchPatchSchema.safeParse(payload(98)).success).toBe(true);
    expect(notificationBatchPatchSchema.safeParse(payload(99)).success).toBe(false);
  });
});
