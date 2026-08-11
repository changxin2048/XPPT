import esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["src/ui-main.js"],
  bundle: true,
  outfile: "ui-bundle.js",
  format: "iife",
  platform: "browser",
  target: ["es2018"],
  minify: true,
  legalComments: "none",
  logLevel: "info",
});

console.log("ui-bundle.js 构建完成");
