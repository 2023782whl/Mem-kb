import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { env } from "../config/env.js";

export interface StorageProvider {
  readonly kind: "local" | "oss";
  persist(storageKey: string, localPath: string): Promise<void>;
  ensureLocal(storageKey: string, localPath: string): Promise<string>;
  remove(storageKey: string, localPath: string): Promise<void>;
}

class LocalStorageProvider implements StorageProvider {
  readonly kind = "local" as const;
  async persist(_storageKey: string, _localPath: string) {}
  async ensureLocal(_storageKey: string, localPath: string) {
    if (!fs.existsSync(localPath)) throw new Error("本地文件不存在");
    return localPath;
  }
  async remove(_storageKey: string, localPath: string) {
    await fsPromises.rm(localPath, { force: true });
  }
}

class OssStorageProvider implements StorageProvider {
  readonly kind = "oss" as const;
  private client: OSS;
  constructor() {
    const accessKeyId = process.env[env.oss.accessKeyIdEnv];
    const accessKeySecret = process.env[env.oss.accessKeySecretEnv];
    if (!env.oss.endpoint || !env.oss.bucket || !accessKeyId || !accessKeySecret) {
      throw new Error("STORAGE_DRIVER=oss 时必须配置 OSS endpoint、bucket 与访问密钥");
    }
    this.client = new OSS({ endpoint: env.oss.endpoint, bucket: env.oss.bucket, accessKeyId, accessKeySecret });
  }
  private remoteKey(storageKey: string) {
    return [env.oss.prefix, storageKey].filter(Boolean).join("/").replace(/^\/+/, "");
  }
  async persist(storageKey: string, localPath: string) {
    await this.client.put(this.remoteKey(storageKey), localPath);
  }
  async ensureLocal(storageKey: string, localPath: string) {
    if (fs.existsSync(localPath)) return localPath;
    await fsPromises.mkdir(path.dirname(localPath), { recursive: true });
    await this.client.get(this.remoteKey(storageKey), localPath);
    return localPath;
  }
  async remove(storageKey: string, localPath: string) {
    await Promise.all([
      this.client.delete(this.remoteKey(storageKey)).catch((error: unknown) => {
        if ((error as { status?: number }).status !== 404) throw error;
      }),
      fsPromises.rm(localPath, { force: true })
    ]);
  }
}

export const storageProvider: StorageProvider = env.storageDriver === "oss" ? new OssStorageProvider() : new LocalStorageProvider();
