/**
 * On-device ONNX Runtime inference for transaction categorization and anomaly detection.
 *
 * Model weights are fetched from CDN on `model:updated` signal and cached locally.
 * The model never runs on the backend — all inference is on-device.
 *
 * Uses onnxruntime-web (browser) or onnxruntime-react-native (mobile).
 * The concrete InferenceSession import is injected at build time via the
 * platform-specific entry points in apps/web and apps/mobile.
 */

export interface OnnxSession {
  run(feeds: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>>;
}

export interface OnnxTensor {
  data: Float32Array | Int32Array | BigInt64Array;
  dims: number[];
  type: string;
}

export type OnnxSessionFactory = (modelBuffer: ArrayBuffer) => Promise<OnnxSession>;

export interface ModelStore {
  get(modelType: string): Promise<ArrayBuffer | null>;
  set(modelType: string, version: string, data: ArrayBuffer): Promise<void>;
  getVersion(modelType: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

const MERCHANT_FEATURES_DIM = 64;   // Hashed merchant name embedding
const TEXT_FEATURES_DIM = 32;       // Bag-of-words from description
const NUMERIC_FEATURES_DIM = 4;     // amount_log, day_of_week, day_of_month, hour
export const INPUT_DIM = MERCHANT_FEATURES_DIM + TEXT_FEATURES_DIM + NUMERIC_FEATURES_DIM;

function hashStr(s: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h % buckets;
}

function textToBoW(text: string, dim: number): Float32Array {
  const vec = new Float32Array(dim);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    vec[hashStr(word, dim)] = 1;
  }
  return vec;
}

export function extractFeatures(
  description: string,
  merchantName: string | null,
  amount: number,
  date: string
): Float32Array {
  const features = new Float32Array(INPUT_DIM);
  let offset = 0;

  // Merchant name hashed bag-of-words
  const merchantVec = textToBoW(merchantName ?? description, MERCHANT_FEATURES_DIM);
  features.set(merchantVec, offset);
  offset += MERCHANT_FEATURES_DIM;

  // Description BoW
  const textVec = textToBoW(description, TEXT_FEATURES_DIM);
  features.set(textVec, offset);
  offset += TEXT_FEATURES_DIM;

  // Numeric features (normalized)
  const d = new Date(date);
  features[offset + 0] = Math.log1p(Math.abs(amount)) / 15; // log-scaled amount
  features[offset + 1] = d.getDay() / 6;                    // day of week
  features[offset + 2] = d.getDate() / 31;                  // day of month
  features[offset + 3] = amount < 0 ? 0 : 1;                // credit vs debit

  return features;
}

// ---------------------------------------------------------------------------
// Categorizer
// ---------------------------------------------------------------------------

export interface CategorizerResult {
  categoryId: string;
  confidence: number;
  topK: Array<{ categoryId: string; score: number }>;
}

export class TransactionCategorizer {
  private session: OnnxSession | null = null;
  private categoryIds: string[] = [];

  constructor(
    private readonly sessionFactory: OnnxSessionFactory,
    private readonly modelStore: ModelStore,
    private readonly cdnBaseUrl: string
  ) {}

  async load(version?: string): Promise<void> {
    const stored = await this.modelStore.get('categorizer');
    const storedVersion = await this.modelStore.getVersion('categorizer');

    let modelBuffer: ArrayBuffer;

    if (stored && storedVersion === (version ?? storedVersion)) {
      modelBuffer = stored;
    } else if (version) {
      const resp = await fetch(`${this.cdnBaseUrl}/models/categorizer/${version}/model.onnx`);
      if (!resp.ok) throw new Error(`Failed to fetch categorizer model: ${resp.status}`);
      modelBuffer = await resp.arrayBuffer();
      await this.modelStore.set('categorizer', version, modelBuffer);

      // Also fetch category map
      const mapResp = await fetch(`${this.cdnBaseUrl}/models/categorizer/${version}/categories.json`);
      const map = await mapResp.json();
      this.categoryIds = map.category_ids;
    } else {
      throw new Error('No categorizer model in store and no version specified');
    }

    this.session = await this.sessionFactory(modelBuffer);
  }

  async categorize(
    description: string,
    merchantName: string | null,
    amount: number,
    date: string
  ): Promise<CategorizerResult> {
    if (!this.session) throw new Error('Categorizer not loaded');

    const features = extractFeatures(description, merchantName, amount, date);

    const inputTensor: OnnxTensor = {
      data: features,
      dims: [1, INPUT_DIM],
      type: 'float32',
    };

    const output = await this.session.run({ input: inputTensor });
    const scores = output['output'].data as Float32Array;

    // Softmax
    const maxScore = Math.max(...scores);
    const exps = Array.from(scores).map((s) => Math.exp(s - maxScore));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sumExps);

    const topK = probs
      .map((score, i) => ({ categoryId: this.categoryIds[i] ?? `cat_${i}`, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      categoryId: topK[0].categoryId,
      confidence: topK[0].score,
      topK,
    };
  }

  get isLoaded(): boolean {
    return this.session !== null;
  }
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export interface AnomalyResult {
  score: number;            // 0.0–1.0; higher = more anomalous
  isAnomaly: boolean;
  type: 'unusual_amount' | 'new_merchant' | 'frequency' | 'category_shift' | null;
}

export class AnomalyDetector {
  private session: OnnxSession | null = null;

  constructor(
    private readonly sessionFactory: OnnxSessionFactory,
    private readonly modelStore: ModelStore,
    private readonly cdnBaseUrl: string
  ) {}

  async load(version?: string): Promise<void> {
    const stored = await this.modelStore.get('anomaly');
    const storedVersion = await this.modelStore.getVersion('anomaly');

    let modelBuffer: ArrayBuffer;

    if (stored && storedVersion === (version ?? storedVersion)) {
      modelBuffer = stored;
    } else if (version) {
      const resp = await fetch(`${this.cdnBaseUrl}/models/anomaly/${version}/model.onnx`);
      if (!resp.ok) throw new Error(`Failed to fetch anomaly model: ${resp.status}`);
      modelBuffer = await resp.arrayBuffer();
      await this.modelStore.set('anomaly', version, modelBuffer);
    } else {
      throw new Error('No anomaly model in store and no version specified');
    }

    this.session = await this.sessionFactory(modelBuffer);
  }

  async score(
    description: string,
    merchantName: string | null,
    amount: number,
    date: string
  ): Promise<AnomalyResult> {
    if (!this.session) throw new Error('Anomaly detector not loaded');

    const features = extractFeatures(description, merchantName, amount, date);
    const inputTensor: OnnxTensor = {
      data: features,
      dims: [1, INPUT_DIM],
      type: 'float32',
    };

    const output = await this.session.run({ input: inputTensor });
    const scores = output['output'].data as Float32Array;
    const anomalyScore = scores[0];
    const typeIndex = scores.indexOf(Math.max(...Array.from(scores).slice(1)));

    const types = ['unusual_amount', 'new_merchant', 'frequency', 'category_shift'] as const;

    return {
      score: anomalyScore,
      isAnomaly: anomalyScore > 0.7,
      type: anomalyScore > 0.7 ? (types[typeIndex - 1] ?? null) : null,
    };
  }

  get isLoaded(): boolean {
    return this.session !== null;
  }
}
