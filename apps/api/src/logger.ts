import { pino, type Logger } from "pino";
import type { Config } from "./config";

export type { Logger };

export function createLogger(config: Pick<Config, "logLevel" | "isProd">): Logger {
  return pino({
    level: config.logLevel,
    base: undefined,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        "*.password",
        "*.token",
        "*.secret",
      ],
      censor: "[redacted]",
    },
  });
}
