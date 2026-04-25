/**
 * On-device recurring-transaction detection.
 *
 * Run after each sync batch to find merchants with a regular charge pattern,
 * classify subscriptions, and keep `recurring_patterns` up to date.
 *
 * Detection criteria
 * ------------------
 *  - Merchant must have ≥ 2 non-pending transactions.
 *  - `frequency_days` = median of consecutive-date intervals.
 *  - `typical_amount`  = median of absolute amounts.
 *  - `amount_variance` = coefficient of variation (stddev/mean × 100).
 *  - `is_subscription` = interval within ±3 days of 7, 14, or 30 AND variance < 5 %.
 */

import { upsertRecurringPattern } from '../db/queries';
import type { SqliteDriver } from '../db/client';

// ---------------------------------------------------------------------------
// Math helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / mean) * 100;
}

export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round(
    (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / MS_PER_DAY
  );
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const SUBSCRIPTION_INTERVALS = [7, 14, 30] as const;
const SUBSCRIPTION_TOLERANCE_DAYS = 3;
const SUBSCRIPTION_MAX_VARIANCE_PCT = 5;

interface TxRow {
  merchant_name: string;
  amount: number;
  date: string;
  category_id: string | null;
}

export async function detectRecurringPatterns(db: SqliteDriver): Promise<void> {
  const rows = await db.query<TxRow>(
    `SELECT merchant_name, amount, date, category_id
     FROM transactions
     WHERE merchant_name IS NOT NULL AND pending = 0
     ORDER BY merchant_name ASC, date ASC`
  );

  // Group by merchant
  const byMerchant = new Map<string, TxRow[]>();
  for (const row of rows) {
    const group = byMerchant.get(row.merchant_name) ?? [];
    group.push(row);
    byMerchant.set(row.merchant_name, group);
  }

  for (const [merchantName, txs] of byMerchant) {
    if (txs.length < 2) continue;

    // Intervals between consecutive transactions (skip zero-day duplicates)
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      const gap = daysBetween(txs[i - 1].date, txs[i].date);
      if (gap > 0) intervals.push(gap);
    }
    if (intervals.length === 0) continue;

    const frequencyDays = Math.round(median(intervals));
    if (frequencyDays === 0) continue;

    const amounts = txs.map((t) => Math.abs(t.amount));
    const typicalAmount = median(amounts);
    const amountVariance = coefficientOfVariation(amounts);

    const isSubscription =
      amountVariance < SUBSCRIPTION_MAX_VARIANCE_PCT &&
      SUBSCRIPTION_INTERVALS.some(
        (si) => Math.abs(frequencyDays - si) <= SUBSCRIPTION_TOLERANCE_DAYS
      );

    const lastSeenAt = txs[txs.length - 1].date;
    const nextExpectedAt = addDays(lastSeenAt, frequencyDays);
    // Use category from most recent transaction that has one
    const categoryId =
      [...txs].reverse().find((t) => t.category_id !== null)?.category_id ?? null;

    await upsertRecurringPattern(db, {
      merchant_name: merchantName,
      category_id: categoryId,
      typical_amount: typicalAmount,
      amount_variance: amountVariance,
      frequency_days: frequencyDays,
      last_seen_at: lastSeenAt,
      next_expected_at: nextExpectedAt,
      is_subscription: isSubscription,
    });
  }
}
