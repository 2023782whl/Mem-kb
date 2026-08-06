import { env } from "../../config/env.js";
import { Bulkhead } from "../../utils/resilience.js";

const admission = new Bulkhead(env.resilience.qaConcurrency, env.resilience.qaQueueLimit);

export function withQaAdmission<T>(operation: () => Promise<T>, signal?: AbortSignal) {
  return admission.run(operation, signal);
}

export function qaAdmissionSnapshot() {
  return admission.snapshot;
}
