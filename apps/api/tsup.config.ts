import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["apps/api/src/server.ts"],
  outDir: "dist/api",
  format: ["esm"],
  target: "node25",
  sourcemap: false,
  clean: true,
  splitting: false,
  dts: false,
  bundle: true,
  noExternal: ["@ipd-summary/contracts"],
  external: ["@fastify/cookie", "@fastify/cors", "@fastify/helmet", "@fastify/multipart", "@fastify/rate-limit", "fastify", "pg", "sanitize-html", "zod"],
});
