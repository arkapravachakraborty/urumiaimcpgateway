import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  splitting: false,
  bundle: true,
  outDir: "./dist",
  clean: true,
  minify: false,
  sourcemap: true,
});
