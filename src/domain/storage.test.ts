import { describe, expect, it } from 'vitest';
import { createInitialState } from './seed';
import { loadState, saveState, STORAGE_KEY } from './storage';

describe('storage', () => {
  it('round-trips the current schema', () => {
    const storage = window.localStorage;
    storage.clear();
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    expect(saveState(storage, state)).toBe(true);
    expect(loadState(storage)).toEqual(state);
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
});
