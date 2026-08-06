import type { BrainEngine } from '../engine.ts';
import type { SearchResult, SearchOpts } from '../types.ts';

export async function vectorSearch(
  engine: BrainEngine,
  embedding: Float32Array,
  opts?: SearchOpts,
): Promise<SearchResult[]> {
  return engine.searchVector(embedding, opts);
}
