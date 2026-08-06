import path from "node:path";
import type { FastifyServerOptions } from "fastify";
import { env } from "../config/env.js";

export function loggerOptions(): FastifyServerOptions["logger"] {
  if (env.runtime !== "production") return { level: env.logs.level };
  return {
    level: env.logs.level,
    transport: {
      targets: [
      { target: "pino/file", level: env.logs.level, options: { destination: 1 } },
      {
        target: "pino-roll",
        level: env.logs.level,
        options: {
          file: path.resolve(env.logs.dir, "aiteam-api.log"),
          frequency: "daily",
          size: "100m",
          mkdir: true,
          limit: { count: 14 }
        }
      }
      ]
    }
  };
}
