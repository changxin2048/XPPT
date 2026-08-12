// 验证：FRAME 容器（白卡片 + 投影）能被正确转换
import fs from "node:fs";
import JSZip from "jszip";
import { createPresentation } from "../src/converter.js";

const frame = {
  name: "容器投影测试",
  width: 800,
  height: 600,
  background: { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 },
  children: [
    {
      type: "FRAME",
      name: "白卡片带投影",
      absX: 100, absY: 80, width: 400, height: 300,
      rotation: 0, opacity: 1,
      cornerRadius: 16,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      strokes: [{ type: "SOLID", color: { r: 0.88, g: 0.9, b: 0.94 }, opacity: 1 }],
      strokeWeight: 2,
      effects: [{ type: "DROP_SHADOW", color: { r: 0.08, g: 0.1, b: 0.2, a: 0.18 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0 }],
      children: [{ type: "TEXT", name: "标题", absX: 120, absY: 110, width: 200, height: 40, rotation: 0, opacity: 1, textAlignHorizontal: "LEFT", textAlignVertical: "TOP", segments: [{ characters: "卡片标题", fontName: { family: "PingFang SC", style: "Semibold" }, fontSize: 28, fontWeight: 600, textDecoration: "NONE", letterSpacing: { value: 0, unit: "PIXELS" }, lineHeight: { value: 36, unit: "PIXELS" }, fill: { type: "SOLID", color: { r: 0.07, g: 0.09, b: 0.13 }, opacity: 1 } }] }],
    },
  ],
};

const pptx = createPresentation([frame], { slideSize: "16x9", scaleMode: "fit", fileName: "container-test" });
const buf = await pptx.write({ outputType: "nodebuffer" });
fs.mkdirSync("test/output", { recursive: true });
fs.writeFileSync("test/output/container-test.pptx", buf);

const zip = await JSZip.loadAsync(buf);
const s = await zip.file("ppt/slides/slide1.xml").async("string");

const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
let m, hasShadow = false, hasStroke = false, hasText = false;
while ((m = spRe.exec(s))) {
  if (/<a:outerShdw/.test(m[1])) hasShadow = true;
  if (/<a:ln w="\d+">/.test(m[1])) hasStroke = true;
  if (/<a:t>卡片标题/.test(m[1])) hasText = true;
}
console.log("容器投影(outerShdw):", hasShadow ? "PASS" : "FAIL");
console.log("容器描边(<a:ln w>):", hasStroke ? "PASS" : "FAIL");
console.log("子文字保留:", hasText ? "PASS" : "FAIL");
if (!hasShadow || !hasStroke || !hasText) process.exit(1);
