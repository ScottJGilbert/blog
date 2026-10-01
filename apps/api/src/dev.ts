import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp({ config });
const server = app.listen(config.port, () => {
  console.log(`[api] dev server http://localhost:${config.port}${config.basePath}  (health: ${config.basePath}/health)`);
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
