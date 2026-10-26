import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  dts: true,
  splitting: false,
  bundle: true,
  outDir: "./dist",
  clean: true,
  sourcemap: true,
});
