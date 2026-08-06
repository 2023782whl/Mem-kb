import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyMime, validateStoredSignature } from "../src/services/storage.js";

const files: string[] = [];

function fixture(name: string, content: Buffer | string) {
  const file = path.join(os.tmpdir(), `aiteam-${Date.now()}-${name}`);
  fs.writeFileSync(file, content);
  files.push(file);
  return file;
}

afterEach(() => files.splice(0).forEach((file) => fs.rmSync(file, { force: true })));

describe("upload allowlist", () => {
  it("accepts supported extension and MIME pairs", () => {
    expect(classifyMime("application/pdf", "manual.pdf")).toBe("document");
    expect(classifyMime("application/msword", "manual.doc")).toBe("document");
    expect(classifyMime("application/vnd.ms-powerpoint", "deck.ppt")).toBe("document");
    expect(classifyMime("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx")).toBe("document");
    expect(classifyMime("application/x-xmind", "map.xmind")).toBe("document");
    expect(classifyMime("image/png", "product.png")).toBe("image");
    expect(classifyMime("image/tiff", "scan.tiff")).toBe("image");
    expect(classifyMime("image/heic", "photo.heic")).toBe("image");
  });

  it("rejects unknown or mismatched formats", () => {
    expect(classifyMime("application/x-msdownload", "payload.exe")).toBeNull();
    expect(classifyMime("image/png", "renamed.pdf")).toBeNull();
    expect(classifyMime("application/pdf", "renamed.png")).toBeNull();
  });
});

describe("file signature validation", () => {
  it("recognizes valid PDF and PNG signatures", () => {
    expect(validateStoredSignature(fixture("valid.pdf", "%PDF-1.7\n"), "pdf")).toBe(true);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    expect(validateStoredSignature(fixture("valid.png", png), "png")).toBe(true);
  });

  it("recognizes ZIP Office, legacy Office, TIFF and HEIC signatures", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic")]);
    expect(validateStoredSignature(fixture("valid.docx", zip), "docx")).toBe(true);
    expect(validateStoredSignature(fixture("valid.xmind", zip), "xmind")).toBe(true);
    expect(validateStoredSignature(fixture("valid.doc", ole), "doc")).toBe(true);
    expect(validateStoredSignature(fixture("valid.ppt", ole), "ppt")).toBe(true);
    expect(validateStoredSignature(fixture("valid.tiff", tiff), "tiff")).toBe(true);
    expect(validateStoredSignature(fixture("valid.heic", heic), "heic")).toBe(true);
  });

  it("rejects renamed executable content", () => {
    expect(validateStoredSignature(fixture("fake.pdf", "MZ executable"), "pdf")).toBe(false);
    expect(validateStoredSignature(fixture("binary.txt", Buffer.from([65, 0, 66])), "txt")).toBe(false);
  });
});
