import { describe, expect, it } from 'vitest';
import { createInitialState } from './seed';
import {
  isMigrationFileState,
  loadState,
  saveState,
  SERVER_CACHE_KEY,
  STORAGE_KEY
} from './storage';

describe('storage', () => {
  it('round-trips the current schema', () => {
    const storage = window.localStorage;
    storage.clear();
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    expect(saveState(storage, state)).toBe(true);
    expect(loadState(storage)).toEqual(state);
  });

  it('keeps the server cache separate from the local state key', () => {
    const storage = window.localStorage;
    storage.clear();
    const local = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const server = { ...local, monitors: [] };

    expect(saveState(storage, local, STORAGE_KEY)).toBe(true);
    expect(saveState(storage, server, SERVER_CACHE_KEY)).toBe(true);
    expect(loadState(storage, STORAGE_KEY)).toEqual(local);
    expect(loadState(storage, SERVER_CACHE_KEY)).toEqual(server);
  });

  it('ignores corrupt and unsupported data', () => {
    const storage = window.localStorage;
    storage.setItem(STORAGE_KEY, '{broken');
    expect(loadState(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(loadState(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      monitors: [{}],
      runs: [],
      notifications: [],
      preferences: {}
    }));
    expect(loadState(storage)).toBeNull();
  });

  it('does not overwrite a valid snapshot with invalid state', () => {
    const storage = window.localStorage;
    storage.clear();
    const valid = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    expect(saveState(storage, valid)).toBe(true);
    const snapshot = storage.getItem(STORAGE_KEY);
    const invalid = {
      ...valid,
      preferences: { ...valid.preferences, quietFrom: '' }
    };

    expect(saveState(storage, invalid)).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(snapshot);
    expect(loadState(storage)).toEqual(valid);
  });

  it('strictly validates portable migration files while allowing legacy HTTP repair', () => {
    const valid = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    expect(isMigrationFileState(valid)).toBe(true);

    const legacyHttp = structuredClone(valid);
    legacyHttp.monitors[0]!.sourceUrl = 'http://legacy.example.com/status';
    expect(isMigrationFileState(legacyHttp)).toBe(true);
  });

  it.each([
    ['invalid timezone', (state: ReturnType<typeof createInitialState>) => {
      state.preferences.timezone = 'Mars/Olympus';
    }],
    ['invalid date', (state: ReturnType<typeof createInitialState>) => {
      state.monitors[0]!.updatedAt = 'not-a-date';
    }],
    ['overlong title', (state: ReturnType<typeof createInitialState>) => {
      state.monitors[0]!.title = 'x'.repeat(81);
    }],
    ['extraneous key', (state: ReturnType<typeof createInitialState>) => {
      Object.assign(state.monitors[0]!, { unexpected: true });
    }]
  ])('rejects a migration file with %s', (_name, mutate) => {
    const invalid = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    mutate(invalid);
    expect(isMigrationFileState(invalid)).toBe(false);
  });
});
