import esbuild from "esbuild";
import fs from "node:fs";

// 1) 打包 UI 逻辑为 IIFE，并内联进 ui.html —— 与 FigmaToCode 的 single-file 方案一致，
//    避免在 Figma Custom UI 沙箱 iframe 中加载外部脚本失败导致 UI 逻辑不执行。
const res = esbuild.buildSync({
  entryPoints: ["src/ui-main.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2018"],
  minify: true,
  legalComments: "none",
  write: false,
  logLevel: "info",
});

let js = res.outputFiles[0].text;
// 防止内联时 </script> 意外闭合脚本标签
js = js.replace(/<\/script/g, "<\\/script");

let html = fs.readFileSync("src/ui.html", "utf8");
html = html.replace("<!--%%UI_BUNDLE%%-->", "<script>\n" + js + "\n</script>");

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/ui.html", html);
console.log("dist/ui.html 构建完成 (" + (Buffer.byteLength(html) / 1024).toFixed(1) + " KB)");
