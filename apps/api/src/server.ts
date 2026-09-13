import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ config, logger: true });
await app.listen({ host: config.host, port: config.port });
