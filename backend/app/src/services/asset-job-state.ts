export interface AssetAttempt {
  attempt: number;
  maxAttempts: number;
  processingId?: string;
}

export function normalizeAssetAttempt(input: Partial<AssetAttempt> = {}): AssetAttempt {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts || 1));
  const attempt = Math.min(maxAttempts, Math.max(1, Math.floor(input.attempt || 1)));
  return { attempt, maxAttempts, processingId: input.processingId };
}

export function assetFailureState(input: AssetAttempt) {
  const retrying = input.attempt < input.maxAttempts;
  return {
    retrying,
    assetStatus: retrying ? "queued" as const : "failed" as const,
    jobStatus: retrying ? "queued" as const : "failed" as const
  };
}
