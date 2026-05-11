/**
 * Anonymized training data submission to the backend.
 *
 * Devices extract feature vectors from transactions that the user has manually
 * categorized, then submit them to the backend for sidecar training. No raw
 * transaction data or PII is sent — only numeric feature vectors and category labels.
 */

// ---------------------------------------------------------------------------
// Feature extraction (100-dim: 64 merchant hash + 32 BoW + 4 numeric)
// ---------------------------------------------------------------------------

const MERCHANT_FEATURES_DIM = 64;
const TEXT_FEATURES_DIM = 32;
const NUMERIC_FEATURES_DIM = 4;
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

  const merchantVec = textToBoW(merchantName ?? description, MERCHANT_FEATURES_DIM);
  features.set(merchantVec, offset);
  offset += MERCHANT_FEATURES_DIM;

  const textVec = textToBoW(description, TEXT_FEATURES_DIM);
  features.set(textVec, offset);
  offset += TEXT_FEATURES_DIM;

  const d = new Date(date);
  features[offset + 0] = Math.log1p(Math.abs(amount)) / 15;
  features[offset + 1] = d.getDay() / 6;
  features[offset + 2] = d.getDate() / 31;
  features[offset + 3] = amount < 0 ? 0 : 1;

  return features;
}

// ---------------------------------------------------------------------------
// Backend submission
// ---------------------------------------------------------------------------

export interface TrainingExample {
  features: number[];
  label: string;
}

export async function submitTrainingData(
  apiBase: string,
  token: string,
  modelType: 'categorizer' | 'anomaly',
  examples: TrainingExample[]
): Promise<void> {
  const resp = await fetch(`${apiBase}/api/v1/ml/training-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model_type: modelType, examples }),
  });

  if (!resp.ok) {
    throw new Error(`Training data submission failed: ${resp.status}`);
  }
}
