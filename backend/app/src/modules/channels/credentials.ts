import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";

export function encryptChannelCredential(value: string) {
  return encryptSecret(value, env.channels.secret);
}

export function decryptChannelCredential(value: string) {
  try {
    return decryptSecret(value, env.channels.secret);
  } catch (error) {
    if (env.channels.secret === env.authSecret) throw error;
    return decryptSecret(value, env.authSecret);
  }
}
