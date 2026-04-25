import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../test/makeTestDb';
import type { SqliteDriver } from '../db/client';
import { upsertAccount, getRecurringPatterns, getMissedRecurringCharges } from '../db/queries';
import { detectRecurringPatterns, median, coefficientOfVariation, daysBetween, addDays } from './recurring';

let db: SqliteDriver;

beforeEach(async () => {
  const testDb = await makeTestDb();
  db = testDb.driver;
  // Seed a single account for all tests
  await upsertAccount(db, {
    id: 'acc-1',
    name: 'Test Bank',
    institution: 'Test',
    type: 'checking',
    currency: 'USD',
    current_balance: 0,
    available_balance: null,
    last_synced_at: null,
    connection_type: 'manual',
    sync_token_ref: null,
    is_active: true,
  });
});

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

describe('median', () => {
  it('returns the middle value for odd-length arrays', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('returns the average of two middle values for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles a single value', () => {
    expect(median([42])).toBe(42);
  });

  it('returns 0 for empty arrays', () => {
    expect(median([])).toBe(0);
  });
});

describe('coefficientOfVariation', () => {
  it('returns 0 for a single value', () => {
    expect(coefficientOfVariation([100])).toBe(0);
  });

  it('returns 0 for identical values', () => {
    expect(coefficientOfVariation([50, 50, 50])).toBeCloseTo(0);
  });

  it('returns ~2 % for near-identical values', () => {
    expect(coefficientOfVariation([99, 100, 101])).toBeLessThan(2);
  });

  it('returns a high value for highly variable amounts', () => {
    expect(coefficientOfVariation([10, 50, 90])).toBeGreaterThan(50);
  });
});

describe('daysBetween', () => {
  it('computes positive day differences', () => {
    expect(daysBetween('2024-01-01', '2024-01-31')).toBe(30);
  });

  it('returns 0 for same date', () => {
    expect(daysBetween('2024-03-15', '2024-03-15')).toBe(0);
  });
});

describe('addDays', () => {
  it('advances a date by N days', () => {
    expect(addDays('2024-01-01', 30)).toBe('2024-01-31');
  });

  it('handles month boundaries', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
  });
});

// ---------------------------------------------------------------------------
// detectRecurringPatterns
// ---------------------------------------------------------------------------

async function insertTx(
  id: string,
  merchant: string,
  date: string,
  amount = -9.99,
  pending = 0,
  category_id: string | null = null
) {
  await db.execute(
    `INSERT INTO transactions
       (id, account_id, amount, currency, description, merchant_name, date, pending, category_id)
     VALUES (?, 'acc-1', ?, 'USD', ?, ?, ?, ?, ?)`,
    [id, amount, merchant, merchant, date, pending, category_id]
  );
}

describe('detectRecurringPatterns', () => {
  it('ignores merchants with fewer than 2 transactions', async () => {
    await insertTx('t1', 'Netflix', '2024-01-01');
    await detectRecurringPatterns(db);
    expect(await getRecurringPatterns(db)).toHaveLength(0);
  });

  it('ignores pending transactions', async () => {
    await insertTx('t1', 'Netflix', '2024-01-01', -9.99, 1);
    await insertTx('t2', 'Netflix', '2024-02-01', -9.99, 1);
    await detectRecurringPatterns(db);
    expect(await getRecurringPatterns(db)).toHaveLength(0);
  });

  it('detects a monthly subscription', async () => {
    await insertTx('t1', 'Netflix', '2024-01-01');
    await insertTx('t2', 'Netflix', '2024-02-01');
    await insertTx('t3', 'Netflix', '2024-03-01');
    await detectRecurringPatterns(db);
    const patterns = await getRecurringPatterns(db);
    expect(patterns).toHaveLength(1);
    const p = patterns[0];
    expect(p.merchant_name).toBe('Netflix');
    expect(p.is_subscription).toBe(true);
    expect(p.frequency_days).toBeGreaterThanOrEqual(27);
    expect(p.frequency_days).toBeLessThanOrEqual(33);
    expect(p.last_seen_at).toBe('2024-03-01');
    expect(p.typical_amount).toBeCloseTo(9.99);
  });

  it('detects a weekly subscription', async () => {
    await insertTx('t1', 'Gym', '2024-01-01');
    await insertTx('t2', 'Gym', '2024-01-08');
    await insertTx('t3', 'Gym', '2024-01-15');
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.is_subscription).toBe(true);
    expect(p.frequency_days).toBe(7);
  });

  it('detects a biweekly subscription', async () => {
    await insertTx('t1', 'Hulu', '2024-01-01');
    await insertTx('t2', 'Hulu', '2024-01-15');
    await insertTx('t3', 'Hulu', '2024-01-29');
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.is_subscription).toBe(true);
    expect(p.frequency_days).toBe(14);
  });

  it('does NOT flag subscription when amount variance is high', async () => {
    await insertTx('t1', 'Electric Co', '2024-01-01', -50);
    await insertTx('t2', 'Electric Co', '2024-02-01', -90);
    await insertTx('t3', 'Electric Co', '2024-03-01', -120);
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.is_subscription).toBe(false);
  });

  it('does NOT flag subscription for irregular intervals', async () => {
    await insertTx('t1', 'Dentist', '2024-01-01');
    await insertTx('t2', 'Dentist', '2024-04-01');
    await insertTx('t3', 'Dentist', '2024-10-01');
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.is_subscription).toBe(false);
  });

  it('computes next_expected_at as last_seen_at + frequency_days', async () => {
    await insertTx('t1', 'Spotify', '2024-01-01');
    await insertTx('t2', 'Spotify', '2024-02-01');
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.next_expected_at).toBe(addDays(p.last_seen_at!, p.frequency_days));
  });

  it('updates an existing pattern on re-detection', async () => {
    await insertTx('t1', 'Spotify', '2024-01-01');
    await insertTx('t2', 'Spotify', '2024-02-01');
    await detectRecurringPatterns(db);
    // New transaction arrives
    await insertTx('t3', 'Spotify', '2024-03-01');
    await detectRecurringPatterns(db);
    const patterns = await getRecurringPatterns(db);
    // Still one pattern, not two
    expect(patterns).toHaveLength(1);
    expect(patterns[0].last_seen_at).toBe('2024-03-01');
  });

  it('picks up category_id from most recent categorised transaction', async () => {
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-ent', 'Entertainment')`);
    await insertTx('t1', 'Disney+', '2024-01-01', -13.99, 0, null);
    await insertTx('t2', 'Disney+', '2024-02-01', -13.99, 0, 'cat-ent');
    await detectRecurringPatterns(db);
    const [p] = await getRecurringPatterns(db);
    expect(p.category_id).toBe('cat-ent');
  });

  it('handles multiple merchants independently', async () => {
    await insertTx('t1', 'Netflix', '2024-01-01');
    await insertTx('t2', 'Netflix', '2024-02-01');
    await insertTx('t3', 'Spotify', '2024-01-15');
    await insertTx('t4', 'Spotify', '2024-02-15');
    await detectRecurringPatterns(db);
    const patterns = await getRecurringPatterns(db);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.merchant_name).sort()).toEqual(['Netflix', 'Spotify']);
  });
});

// ---------------------------------------------------------------------------
// getMissedRecurringCharges
// ---------------------------------------------------------------------------

describe('getMissedRecurringCharges', () => {
  async function seedPattern(merchantName: string, nextExpectedAt: string, frequencyDays = 30) {
    await db.execute(
      `INSERT INTO recurring_patterns
         (id, merchant_name, frequency_days, last_seen_at, next_expected_at, is_subscription)
       VALUES (?, ?, ?, date(?, '-' || ? || ' days'), ?, 1)`,
      [
        `rp-${merchantName}`,
        merchantName,
        frequencyDays,
        nextExpectedAt,
        frequencyDays,
        nextExpectedAt,
      ]
    );
  }

  it('returns empty when no patterns are overdue', async () => {
    await seedPattern('Netflix', '2099-01-01');
    const missed = await getMissedRecurringCharges(db, '2024-06-01');
    expect(missed).toHaveLength(0);
  });

  it('returns a pattern when next_expected_at is past with no transaction', async () => {
    await seedPattern('Netflix', '2024-05-01');
    const missed = await getMissedRecurringCharges(db, '2024-06-01');
    expect(missed).toHaveLength(1);
    expect(missed[0].merchant_name).toBe('Netflix');
  });

  it('does NOT flag a pattern when a transaction arrived in the window', async () => {
    await seedPattern('Spotify', '2024-05-01');
    await insertTx('tx-sp', 'Spotify', '2024-05-01');
    const missed = await getMissedRecurringCharges(db, '2024-06-01');
    expect(missed).toHaveLength(0);
  });

  it('uses the half-window tolerance so a slightly late charge is not missed', async () => {
    await seedPattern('Hulu', '2024-05-01', 30);
    // Arrived 12 days late — within the 15-day half-window
    await insertTx('tx-hulu', 'Hulu', '2024-05-13');
    const missed = await getMissedRecurringCharges(db, '2024-06-01');
    expect(missed).toHaveLength(0);
  });

  it('does flag a pattern when the charge arrived outside the window', async () => {
    await seedPattern('Hulu', '2024-05-01', 30);
    // Arrived 20 days after expected — outside the 15-day half-window
    await insertTx('tx-hulu-late', 'Hulu', '2024-05-21');
    const missed = await getMissedRecurringCharges(db, '2024-06-01');
    expect(missed).toHaveLength(1);
  });
});
