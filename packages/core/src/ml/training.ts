/**
 * Helpers for submitting anonymized training examples to the backend.
 *
 * Call submitTrainingBatch() after a user manually categorizes a transaction
 * so the ML model can learn from confirmed labels.
 *
 * The backend collects these examples and periodically forwards them to the
 * ML sidecar for training. No financial data is sent — only the feature vector
 * produced by extractFeatures() and the category label.
 */

import { extractFeatures } from './inference';

export interface TrainingExample {
  features: number[];
  label: string;
}

export interface TrainingBatch {
  model_type: 'categorizer' | 'anomaly';
  examples: TrainingExample[];
}

/**
 * Build a training example from a transaction's fields.
 * The feature extraction is identical to what the categorizer uses for inference,
 * so confirmed labels provide directly comparable signal.
 */
export function buildTrainingExample(
  description: string,
  merchantName: string | null,
  amount: number,
  date: string,
  categoryId: string
): TrainingExample {
  return {
    features: Array.from(extractFeatures(description, merchantName, amount, date)),
    label: categoryId,
  };
}

/**
 * Submit a batch of training examples to the backend.
 * Silently no-ops on network errors — a failed submission is non-critical
 * since the model will still run inference with the currently loaded weights.
 */
export async function submitTrainingBatch(
  apiBaseUrl: string,
  authToken: string,
  batch: TrainingBatch
): Promise<void> {
  await fetch(`${apiBaseUrl}/api/v1/ml/training-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(batch),
  });
}
