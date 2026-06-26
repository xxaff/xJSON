import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node-host.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
