import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { resolveLoginEmail } from "../src/modules/auth/routes.js";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../src/utils/crypto.js";

describe("credential primitives", () => {
  it("hashes and verifies passwords without storing plaintext", () => {
    const stored = hashPassword("correct horse battery staple", "fixed-test-salt");
    expect(stored).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed password hashes", () => {
    expect(verifyPassword("password", "sha1:bad:value")).toBe(false);
    expect(verifyPassword("password", "scrypt:missing")).toBe(false);
  });

  it("generates high-entropy URL-safe session tokens", () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first).not.toBe(second);
    expect(sha256(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts the local admin alias without breaking email login", () => {
    expect(resolveLoginEmail(" admin ")).toBe("admin@mem-kb.local");
    expect(resolveLoginEmail("EDITOR@EXAMPLE.COM")).toBe("editor@example.com");
  });

  it("encrypts channel credentials with authenticated encryption", () => {
    const encrypted = encryptSecret("wechat-bot-token", "test-secret");
    expect(encrypted).not.toContain("wechat-bot-token");
    expect(decryptSecret(encrypted, "test-secret")).toBe("wechat-bot-token");
    expect(() => decryptSecret(`${encrypted}x`, "test-secret")).toThrow();
  });
});
