/**
 * TransactionsScreen tests — focused on the makeDefaultFilters fix.
 *
 * makeDefaultFilters was previously a module-level constant evaluated once at
 * load time, causing stale date ranges if the app stayed open across day/month
 * boundaries. It is now a function that reads new Date() on each call.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

// Prevent native mobile modules from loading in jsdom
vi.mock('../context/DbContext', () => ({ useDb: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('@fresh/core/channels', () => ({ useFinanceSocket: vi.fn(() => ({ ackSync: vi.fn() })) }));
vi.mock('../db/driver', () => ({
  NativeSqliteDriver: { create: vi.fn(), getDeviceKey: vi.fn().mockResolvedValue('key') },
}));

import { makeDefaultFilters } from './TransactionsScreen';

describe('makeDefaultFilters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns dates relative to the current date, not a stale load-time snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00'));

    const filters = makeDefaultFilters();

    const now = new Date('2026-01-15T10:00:00');
    expect(filters.startDate).toBe(format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'));
    expect(filters.endDate).toBe(format(endOfMonth(now), 'yyyy-MM-dd'));
  });

  it('produces different dates when called on different months', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-01-15T10:00:00'));
    const jan = makeDefaultFilters();

    vi.setSystemTime(new Date('2026-02-15T10:00:00'));
    const feb = makeDefaultFilters();

    expect(jan.endDate).not.toBe(feb.endDate);
    expect(jan.startDate).not.toBe(feb.startDate);
  });

  it('returns null accountId and empty search', () => {
    const filters = makeDefaultFilters();
    expect(filters.accountId).toBeNull();
    expect(filters.search).toBe('');
  });

  it('endDate is always the end of the current month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T10:00:00'));

    const filters = makeDefaultFilters();

    expect(filters.endDate).toBe('2026-03-31');
  });

  it('startDate is always the start of the month 2 months ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T10:00:00'));

    const filters = makeDefaultFilters();

    expect(filters.startDate).toBe('2026-01-01');
  });
});
