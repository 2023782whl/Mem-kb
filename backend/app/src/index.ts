import { env } from "./config/env.js";
import { buildApp } from "./http/app.js";

const app = await buildApp();

try {
  await app.listen({ host: env.host, port: env.port });
  app.log.info(`Mem-kb API listening at http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
