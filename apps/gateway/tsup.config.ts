import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  splitting: false,
  bundle: true,
  noExternal: [/^@repo\/(?!db$)/],
  outDir: "./dist",
  clean: true,
  minify: false,
  sourcemap: true,
});
