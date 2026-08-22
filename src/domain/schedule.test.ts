import { describe, expect, it } from 'vitest';
import { getNextRunAt, scheduleLabel } from './schedule';

describe('schedule', () => {
  it('schedules hourly monitors one hour after the current run', () => {
    const from = new Date('2026-08-22T01:15:00.000Z');
    expect(getNextRunAt(from, 'hourly', '09:00')).toBe('2026-08-22T02:15:00.000Z');
  });

  it('skips weekends for weekday monitors', () => {
    const saturdayMorning = new Date('2026-08-22T08:00:00.000Z');
    expect(getNextRunAt(saturdayMorning, 'weekdays', '09:00', 'Asia/Tokyo')).toBe(
      '2026-08-24T00:00:00.000Z'
    );
  });

  it('calculates wall-clock schedules in the selected timezone', () => {
    const from = new Date('2026-08-21T23:30:00.000Z');
    expect(getNextRunAt(from, 'daily', '09:00', 'Asia/Tokyo')).toBe(
      '2026-08-22T00:00:00.000Z'
    );
    expect(getNextRunAt(from, 'daily', '09:00', 'America/New_York')).toBe(
      '2026-08-22T13:00:00.000Z'
    );
  });

  it('provides human-readable labels', () => {
    expect(scheduleLabel('daily', '08:30')).toBe('毎日 08:30');
    expect(scheduleLabel('weekly', '10:00')).toBe('毎週月曜 10:00');
  });
});
