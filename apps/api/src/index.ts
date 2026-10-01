/**
 * Vercel (Services) entry: the default export is the Express app. Running this file directly
 * (`node dist/index.js`, i.e. `pnpm --filter @blog/api start`) also starts an HTTP server.
 */
import { pathToFileURL } from "node:url";
import { createApp } from "./app";
import { loadConfig } from "./config";

const app = createApp();
export default app;

const entry = process.argv[1];
if (!process.env.VERCEL && entry && import.meta.url === pathToFileURL(entry).href) {
  const { port } = loadConfig();
  const server = app.listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
