/**
 * Embedding service using Voyage AI (voyage-3-lite).
 *
 * Voyage AI is Anthropic's recommended embedding provider.
 * Model: voyage-3-lite — fast, cheap (~$0.02/1M tokens), 512-dim vectors.
 *
 * Falls back to a deterministic mock (zero-vector) when VOYAGE_MOCK=true
 * or no VOYAGE_API_KEY is set, so the pipeline never hard-fails during dev.
 *
 * Batching: Voyage API accepts up to 128 texts per request.
 * We chunk requests to stay within that limit.
 */

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';
const EMBEDDING_DIM = 512;
const BATCH_SIZE = 128;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: Float32Array;
  tokenCount: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

function getApiKey(): string | null {
  return process.env.VOYAGE_API_KEY ?? null;
}

function isMockMode(): boolean {
  return process.env.VOYAGE_MOCK === 'true' || !getApiKey();
}

/** Returns a deterministic zero-vector mock (same dim as real embeddings). */
function mockEmbedding(text: string): EmbeddingResult {
  // Use a simple hash so similar texts aren't all zero — helps test retrieval
  const seed = text.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const arr = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    arr[i] = Math.sin(seed * (i + 1)) * 0.1;
  }
  return { embedding: arr, tokenCount: Math.ceil(text.length / 4) };
}

/**
 * Embed a single text string.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  if (isMockMode()) return mockEmbedding(text);
  const results = await embedBatch([text]);
  return results[0];
}

/**
 * Embed a batch of texts. Handles pagination for batches > BATCH_SIZE.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  if (isMockMode()) {
    return texts.map(t => mockEmbedding(t));
  }

  const apiKey = getApiKey()!;
  const results: EmbeddingResult[] = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: batch,
        input_type: 'document', // use 'query' for query-time embedding
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Voyage AI API error ${response.status}: ${errText}`);
    }

    const json = await response.json() as {
      data: { embedding: number[]; index: number }[];
      usage: { total_tokens: number };
    };

    const tokenPerText = Math.ceil(json.usage.total_tokens / batch.length);

    for (const item of json.data) {
      results.push({
        embedding: new Float32Array(item.embedding),
        tokenCount: tokenPerText,
      });
    }
  }

  return results;
}

/**
 * Embed a query string (uses input_type: 'query' for better retrieval).
 */
export async function embedQuery(query: string): Promise<Float32Array> {
  if (isMockMode()) return mockEmbedding(query).embedding;

  const apiKey = getApiKey()!;
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [query],
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Voyage AI API error ${response.status}: ${errText}`);
  }

  const json = await response.json() as { data: { embedding: number[] }[] };
  return new Float32Array(json.data[0].embedding);
}

// ─── Serialization (Float32Array ↔ SQLite BLOB) ───────────────────────────────

/** Serialize a Float32Array to a Buffer for SQLite BLOB storage. */
export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/** Deserialize a SQLite BLOB back to Float32Array. */
export function deserializeEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two Float32Arrays.
 * Returns a value in [-1, 1] — higher = more similar.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
