/**
 * LLM-Guided Text Chunker
 * Ported from production Ruby implementation (llm_text_chunker.rb, 167 LOC)
 *
 * Algorithm:
 *   1. Pre-split into 128-word candidates via recursive chunker
 *   2. Sliding window of 3+ candidates
 *   3. Ask Claude Haiku: "Where does the FIRST topic shift occur?"
 *   4. Max 3 retries per window on unparseable responses
 *   5. Merge candidates between split points
 */

import { chunkText as recursiveChunk, type TextChunk } from './recursive.ts';

const CANDIDATE_SIZE = 128; // words per pre-split candidate
const MAX_RETRIES = 3;
const WINDOW_SIZE = 5; // candidates per window

export interface LlmChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  askLlm?: (prompt: string) => Promise<string>;
}

export async function chunkTextLlm(
  text: string,
  opts: LlmChunkOptions,
): Promise<TextChunk[]> {
  const chunkSize = opts.chunkSize || 300;
  const chunkOverlap = opts.chunkOverlap || 50;
  const askLlm = opts.askLlm;

  if (!askLlm) {
    return recursiveChunk(text, { chunkSize, chunkOverlap });
  }

  try {
    // Step 1: Pre-split into small candidates
    const candidates = recursiveChunk(text, {
      chunkSize: CANDIDATE_SIZE,
      chunkOverlap: 0,
    });

    if (candidates.length <= 2) {
      return recursiveChunk(text, { chunkSize, chunkOverlap });
    }

    // Step 2: Find split points via LLM
    const splitPoints = await findSplitPoints(candidates, askLlm);

    // Step 3: Merge candidates between split points
    const merged = mergeAtSplits(candidates, splitPoints);

    return merged.map((t, i) => ({ text: t.trim(), index: i }));
  } catch {
    return recursiveChunk(text, { chunkSize, chunkOverlap });
  }
}

async function findSplitPoints(
  candidates: TextChunk[],
  askLlm: (prompt: string) => Promise<string>,
): Promise<number[]> {
  const splitPoints: number[] = [];
  let pos = 0;

  while (pos < candidates.length - 1) {
    const windowEnd = Math.min(pos + WINDOW_SIZE, candidates.length);
    const window = candidates.slice(pos, windowEnd);

    if (window.length < 2) break;

    const splitAt = await askForSplit(window, pos, askLlm);

    if (splitAt !== null && splitAt > pos) {
      splitPoints.push(splitAt);
      pos = splitAt;
    } else {
      // No split found in this window, advance by 1
      pos++;
    }
  }

  return splitPoints;
}

async function askForSplit(
  window: TextChunk[],
  offset: number,
  askLlm: (prompt: string) => Promise<string>,
): Promise<number | null> {
  // Format candidates as numbered items
  const numbered = window
    .map((c, i) => `[${offset + i}] ${c.text.slice(0, 200)}${c.text.length > 200 ? '...' : ''}`)
    .join('\n\n');

  const prompt = `You are analyzing a document that has been split into numbered segments. Your job is to find where the FIRST major topic shift occurs.

Here are the segments:

${numbered}

If there is a clear topic shift between any two adjacent segments, respond with ONLY the number of the segment where the NEW topic begins. For example, if the topic shifts between [${offset + 1}] and [${offset + 2}], respond with: ${offset + 2}

If there is no clear topic shift, respond with: NONE

Respond with only a number or NONE. Nothing else.`;

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const response = await askLlm(prompt);
      const parsed = parseSplitResponse(response, offset, offset + window.length - 1);
      return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

function parseSplitResponse(
  response: string,
  minId: number,
  maxId: number,
): number | null {
  const trimmed = response.trim().toUpperCase();
  if (trimmed === 'NONE') return null;

  const num = parseInt(trimmed, 10);
  if (isNaN(num)) return null;

  // Clamp to valid range, ensure forward progress
  const clamped = Math.max(num, minId + 1);
  if (clamped > maxId) return null;

  return clamped;
}

function mergeAtSplits(candidates: TextChunk[], splitPoints: number[]): string[] {
  if (splitPoints.length === 0) {
    return [candidates.map(c => c.text).join(' ')];
  }

  const result: string[] = [];
  let start = 0;

  for (const split of splitPoints) {
    const group = candidates.slice(start, split);
    if (group.length > 0) {
      result.push(group.map(c => c.text).join(' '));
    }
    start = split;
  }

  // Last group
  const remaining = candidates.slice(start);
  if (remaining.length > 0) {
    result.push(remaining.map(c => c.text).join(' '));
  }

  return result.filter(t => t.trim().length > 0);
}
