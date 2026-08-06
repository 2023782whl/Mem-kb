import { env } from "./config/env.js";
import { migrateOnly } from "./db/setup.js";
import { buildApp } from "./http/app.js";

await migrateOnly();
const app = await buildApp();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "Shutting down Mem-kb API");
  await app.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`Mem-kb API listening at http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
