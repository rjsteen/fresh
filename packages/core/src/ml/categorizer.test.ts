import { describe, it, expect } from 'vitest';
import { normalizePayee, applyRules } from './categorizer';
import type { CategorizationRule } from './categorizer';

// ---------------------------------------------------------------------------
// normalizePayee
// ---------------------------------------------------------------------------

describe('normalizePayee', () => {
  it('resolves known brand via substitution table', () => {
    expect(normalizePayee('AMAZON.COM*5C7QC7MH0 AM 10/26')).toBe('Amazon');
    expect(normalizePayee('NETFLIX.COM')).toBe('Netflix');
    expect(normalizePayee('WHOLEFDS MKT #123 SF CA')).toBe('Whole Foods');
    expect(normalizePayee('WAL-MART #4567 DALLAS TX')).toBe('Walmart');
    expect(normalizePayee('STARBUCKS STORE 12345')).toBe('Starbucks');
    expect(normalizePayee('SPOTIFY AB')).toBe('Spotify');
    expect(normalizePayee('APPLE.COM/BILL')).toBe('Apple');
    expect(normalizePayee("MCDONALD'S")).toBe("McDonald's");
    expect(normalizePayee('CHICK-FIL-A #00321')).toBe('Chick-fil-A');
  });

  it('strips Square POS prefix', () => {
    expect(normalizePayee('SQ *BLUE BOTTLE COFFEE SF CA')).toBe('Blue Bottle Coffee Sf Ca');
  });

  it('strips Toast POS prefix', () => {
    expect(normalizePayee('TST* THE FRENCH LAUNDRY')).toBe('The French Laundry');
  });

  it('resolves Uber Eats before Uber', () => {
    expect(normalizePayee('UBER *EATS 1234')).toBe('Uber Eats');
    expect(normalizePayee('UBER TRIP HELP.UBER.COM')).toBe('Uber');
  });

  it('resolves Zelle via brand table', () => {
    expect(normalizePayee('ZELLE PAYMENT')).toBe('Zelle');
  });

  it('title-cases unknown descriptions when no substitution matches', () => {
    expect(normalizePayee('ACH TRANSFER')).toBe('Ach Transfer');
    expect(normalizePayee('CHECKCARD DEBIT')).toBe('Checkcard Debit');
  });

  it('trims whitespace', () => {
    expect(normalizePayee('  NETFLIX  ')).toBe('Netflix');
  });
});

// ---------------------------------------------------------------------------
// applyRules
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<CategorizationRule> & Pick<CategorizationRule, 'conditions' | 'category_id'>): CategorizationRule {
  return {
    id: 'rule-1',
    priority: 10,
    is_auto: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('applyRules', () => {
  it('matches contains condition on payee', () => {
    const rules = [makeRule({
      conditions: [{ field: 'payee', op: 'contains', value: 'amazon' }],
      category_id: 'cat-shopping',
    })];
    expect(applyRules(rules, 'Amazon', 'AMAZON.COM*XYZ')).toBe('cat-shopping');
  });

  it('matches equals condition case-insensitively', () => {
    const rules = [makeRule({
      conditions: [{ field: 'payee', op: 'equals', value: 'starbucks' }],
      category_id: 'cat-coffee',
    })];
    expect(applyRules(rules, 'Starbucks', 'STARBUCKS STORE 123')).toBe('cat-coffee');
  });

  it('matches starts_with condition', () => {
    const rules = [makeRule({
      conditions: [{ field: 'description', op: 'starts_with', value: 'sq *' }],
      category_id: 'cat-dining',
    })];
    expect(applyRules(rules, 'Blue Bottle Coffee', 'SQ *BLUE BOTTLE')).toBe('cat-dining');
  });

  it('matches regex condition', () => {
    const rules = [makeRule({
      conditions: [{ field: 'payee', op: 'regex', value: '^uber' }],
      category_id: 'cat-transport',
    })];
    expect(applyRules(rules, 'Uber', 'UBER TRIP')).toBe('cat-transport');
  });

  it('requires all conditions to match (AND semantics)', () => {
    const rules = [makeRule({
      conditions: [
        { field: 'payee', op: 'contains', value: 'uber' },
        { field: 'description', op: 'contains', value: 'eats' },
      ],
      category_id: 'cat-food',
    })];
    expect(applyRules(rules, 'Uber', 'UBER TRIP')).toBeNull();
    expect(applyRules(rules, 'Uber Eats', 'UBER *EATS 123')).toBe('cat-food');
  });

  it('returns the first matching rule (highest priority wins)', () => {
    const rules = [
      makeRule({ id: 'r1', priority: 10, conditions: [{ field: 'payee', op: 'contains', value: 'amazon' }], category_id: 'cat-shopping' }),
      makeRule({ id: 'r2', priority: 0,  conditions: [{ field: 'payee', op: 'contains', value: 'amazon' }], category_id: 'cat-subscriptions' }),
    ];
    expect(applyRules(rules, 'Amazon Prime', 'AMAZON PRIME*XYZ')).toBe('cat-shopping');
  });

  it('returns null when no rule matches', () => {
    const rules = [makeRule({
      conditions: [{ field: 'payee', op: 'equals', value: 'netflix' }],
      category_id: 'cat-streaming',
    })];
    expect(applyRules(rules, 'Spotify', 'SPOTIFY AB')).toBeNull();
  });

  it('returns null for empty rules list', () => {
    expect(applyRules([], 'Amazon', 'AMAZON.COM')).toBeNull();
  });

  it('skips rules with no conditions', () => {
    const rules = [makeRule({ conditions: [], category_id: 'cat-misc' })];
    expect(applyRules(rules, 'Amazon', 'AMAZON.COM')).toBeNull();
  });
});
