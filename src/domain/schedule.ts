import { Temporal } from '@js-temporal/polyfill';
import type { MonitorFrequency } from './model';

const HOUR = 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_SCHEDULE_TIME = '09:00';

export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeScheduleTime(value: string): string {
  return isClockTime(value) ? value : DEFAULT_SCHEDULE_TIME;
}

function zonedDateTime(from: Date, timezone: string): Temporal.ZonedDateTime {
  const instant = Temporal.Instant.fromEpochMilliseconds(from.getTime());
  try {
    return instant.toZonedDateTimeISO(timezone);
  } catch {
    return instant.toZonedDateTimeISO(DEFAULT_TIMEZONE);
  }
}

export function getNextRunAt(
  from: Date,
  frequency: MonitorFrequency,
  time: string,
  timezone = DEFAULT_TIMEZONE
): string {
  if (frequency === 'hourly') {
    return new Date(from.getTime() + HOUR).toISOString();
  }

  const [hours = 9, minutes = 0] = normalizeScheduleTime(time).split(':').map(Number);
  const current = zonedDateTime(from, timezone);
  let next = current.with(
    {
      hour: Number.isFinite(hours) ? hours : 9,
      minute: Number.isFinite(minutes) ? minutes : 0,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0
    },
    { disambiguation: 'compatible' }
  );
  if (Temporal.ZonedDateTime.compare(next, current) <= 0) {
    next = next.add({ days: 1 });
  }

  if (frequency === 'weekdays') {
    while (next.dayOfWeek > 5) {
      next = next.add({ days: 1 });
    }
  }

  if (frequency === 'weekly') {
    while (next.dayOfWeek !== 1) {
      next = next.add({ days: 1 });
    }
  }

  return next.toInstant().toString({ smallestUnit: 'millisecond' });
}

export function scheduleLabel(frequency: MonitorFrequency, time: string): string {
  switch (frequency) {
    case 'hourly':
      return '1時間ごと';
    case 'daily':
      return `毎日 ${time}`;
    case 'weekdays':
      return `平日 ${time}`;
    case 'weekly':
      return `毎週月曜 ${time}`;
  }
}
