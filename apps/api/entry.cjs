// Vercel service entrypoint: must exist at deploy time, so it forwards to the bundle produced by `pnpm build` (tsup).
module.exports = require("./dist/index.cjs");
