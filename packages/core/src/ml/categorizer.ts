/**
 * Rule-based transaction categorizer.
 *
 * Step 1: normalizePayee() — converts raw bank description strings into
 *   a clean payee name (e.g. "SQ *BLUE BOTTLE COFFEE SF CA" → "Blue Bottle Coffee").
 *
 * Step 2: applyRules() — evaluates user-defined rules (loaded from the
 *   categorization_rules DB table) and returns the first matching category ID.
 *
 * Rules are ordered by priority DESC so user-created rules (priority 10)
 * override auto-generated rules (priority 0).
 */

export interface RuleCondition {
  field: 'payee' | 'description';
  op: 'contains' | 'equals' | 'starts_with' | 'regex';
  value: string;
}

export interface CategorizationRule {
  id: string;
  priority: number;
  conditions: RuleCondition[];
  category_id: string;
  is_auto: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Payee normalization
// ---------------------------------------------------------------------------

// Brand-specific substitutions applied before generic stripping.
// Ordered: most-specific patterns first.
const BRAND_SUBSTITUTIONS: Array<[RegExp, string]> = [
  // Amazon variants
  [/^AMAZON\.COM\b/i, 'Amazon'],
  [/^AMAZON PRIME\b/i, 'Amazon Prime'],
  [/^AMZN\b/i, 'Amazon'],
  // Grocery
  [/^WHOLEFDS\b/i, 'Whole Foods'],
  [/^WM\s+SUPERCENTER\b/i, 'Walmart'],
  [/^WAL-MART\b/i, 'Walmart'],
  [/^TARGET\s*(STORE\s*)?\d*/i, 'Target'],
  [/^COSTCO\s+WHSE\b/i, 'Costco'],
  [/^KROGER\b/i, 'Kroger'],
  [/^PUBLIX\b/i, 'Publix'],
  [/^SAFEWAY\b/i, 'Safeway'],
  [/^TRADER\s+JOE'?S\b/i, "Trader Joe's"],
  [/^ALDI\b/i, 'Aldi'],
  // Pharmacy / drugstore
  [/^CVS[\s/]*(PHARMACY|PHARM)?\b/i, 'CVS'],
  [/^WALGREENS\b/i, 'Walgreens'],
  // Streaming & subscriptions
  [/^NETFLIX\.COM\b/i, 'Netflix'],
  [/^NETFLIX\b/i, 'Netflix'],
  [/^SPOTIFY\s+(AB|USA|PREMIUM)?\b/i, 'Spotify'],
  [/^HULU\b/i, 'Hulu'],
  [/^DISNEY\s*\+/i, 'Disney+'],
  [/^DISNEY\s*PLUS\b/i, 'Disney+'],
  [/^HBO\s*MAX\b/i, 'Max'],
  [/^YOUTUBE\s+PREMIUM\b/i, 'YouTube Premium'],
  // Apple / Google
  [/^APPLE\.COM\/BILL\b/i, 'Apple'],
  [/^APPLE\.COM\b/i, 'Apple'],
  [/^GOOGLE\s*\*\s*GOOGLE\s+STORAGE\b/i, 'Google One'],
  [/^GOOGLE\s*\*\s*YOUTUBE\b/i, 'YouTube'],
  [/^GOOGLE\s*\*\s*/i, 'Google'],
  [/^GOOGLE\s+PLAY\b/i, 'Google Play'],
  // Coffee
  [/^STARBUCKS\b/i, 'Starbucks'],
  [/^DUNKIN['']?\b/i, "Dunkin'"],
  // Fast food
  [/^MCDONALD'?S?\b/i, "McDonald's"],
  [/^CHICK-FIL-A\b/i, 'Chick-fil-A'],
  [/^CHIPOTLE\b/i, 'Chipotle'],
  [/^SUBWAY\s+(RESTAURANTS?)?\b/i, 'Subway'],
  [/^TACO\s+BELL\b/i, 'Taco Bell'],
  [/^BURGER\s+KING\b/i, 'Burger King'],
  [/^WENDY'?S?\b/i, "Wendy's"],
  [/^DOMINO'?S?\b/i, "Domino's"],
  [/^PANERA\b/i, 'Panera Bread'],
  // Delivery
  [/^DOORDASH\b/i, 'DoorDash'],
  [/^UBER\s*\*\s*EATS?\b/i, 'Uber Eats'],
  [/^GRUBHUB\b/i, 'Grubhub'],
  [/^INSTACART\b/i, 'Instacart'],
  // Ride share / transit
  [/^UBER\b/i, 'Uber'],
  [/^LYFT\b/i, 'Lyft'],
  // Home / utilities
  [/^COMCAST\b/i, 'Comcast'],
  [/^XFINITY\b/i, 'Xfinity'],
  [/^AT&T\b/i, 'AT&T'],
  [/^VERIZON\b/i, 'Verizon'],
  [/^T-MOBILE\b/i, 'T-Mobile'],
  // Gas
  [/^SHELL\s+(OIL\s+)?(SERVICE\s+)?[\d#]/i, 'Shell'],
  [/^CHEVRON\b/i, 'Chevron'],
  [/^EXXON(MOBIL)?\b/i, 'ExxonMobil'],
  [/^BP\s*[\d#]/i, 'BP'],
  // P2P / payment
  [/^VENMO\b/i, 'Venmo'],
  [/^PAYPAL\b/i, 'PayPal'],
  [/^CASH\s+APP\b/i, 'Cash App'],
  [/^ZELLE\b/i, 'Zelle'],
];

// Prefixes from POS terminals — strip and keep the rest
const POS_PREFIXES: RegExp[] = [
  /^SQ\s*\*\s*/i,   // Square
  /^TST\s*\*\s*/i,  // Toast
  /^SP\s*\*\s*/i,   // Stripe
  /^PP\s*\*\s*/i,   // PayPal Here
];

// Trailing noise: store numbers, location codes, order IDs
const TRAILING_NOISE: RegExp[] = [
  /\s+#\s*\d+.*$/,             // #123 or # 123
  /\s+STORE\s+\d+.*$/i,
  /\s+[A-Z]{2}\s+\d{5}.*$/,   // state + zip
  /\s{2,}.*$/,                  // double space = start of noise
];

export function normalizePayee(description: string): string {
  let s = description.trim();

  // Apply brand substitutions first
  for (const [pattern, name] of BRAND_SUBSTITUTIONS) {
    if (pattern.test(s)) {
      return name;
    }
  }

  // Strip POS prefixes
  for (const prefix of POS_PREFIXES) {
    const stripped = s.replace(prefix, '').trim();
    if (stripped && stripped !== s) {
      s = stripped;
      break;
    }
  }

  // Strip trailing noise
  for (const noise of TRAILING_NOISE) {
    s = s.replace(noise, '').trim();
  }

  // Normalize whitespace and title-case if all-caps
  s = s.replace(/\s+/g, ' ').trim();
  if (s === s.toUpperCase() && s.length > 1) {
    s = s
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return s || description.trim();
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function evalCondition(cond: RuleCondition, payee: string, description: string): boolean {
  const subject = cond.field === 'payee' ? payee : description;
  const lowerSubject = subject.toLowerCase();
  const lowerValue = cond.value.toLowerCase();

  switch (cond.op) {
    case 'contains':    return lowerSubject.includes(lowerValue);
    case 'equals':      return lowerSubject === lowerValue;
    case 'starts_with': return lowerSubject.startsWith(lowerValue);
    case 'regex':       return new RegExp(cond.value, 'i').test(subject);
  }
}

/**
 * Run rules in order (highest priority first) and return the first match's
 * category_id. Returns null if no rule matches.
 */
export function applyRules(
  rules: CategorizationRule[],
  payee: string,
  description: string
): string | null {
  for (const rule of rules) {
    if (rule.conditions.length > 0 && rule.conditions.every((c) => evalCondition(c, payee, description))) {
      return rule.category_id;
    }
  }
  return null;
}
