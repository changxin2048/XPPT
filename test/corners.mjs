// 验证：圆形容器→ellipse、非统一圆角容器→圆角矩形（取最大半径）、圆形 RECTANGLE→ellipse
import fs from "node:fs";
import JSZip from "jszip";
import { createPresentation } from "../src/converter.js";

const frame = {
  name: "圆角测试",
  width: 800,
  height: 600,
  background: { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 },
  children: [
    {
      // 圆形 FRAME 容器（正方形 + 满圆角）→ 应输出 ellipse
      type: "FRAME", name: "圆形容器", absX: 50, absY: 50, width: 120, height: 120,
      rotation: 0, opacity: 1, cornerRadius: 60,
      fills: [{ type: "SOLID", color: { r: 0.2, g: 0.5, b: 0.9 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [], children: [],
    },
    {
      // 非统一圆角 FRAME 容器（max=16，模拟只圆上方两角）→ 应输出 roundRect 且 adj 有效
      type: "FRAME", name: "非统一圆角卡片", absX: 200, absY: 50, width: 300, height: 180,
      rotation: 0, opacity: 1, cornerRadius: 16,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [], children: [],
    },
    {
      // 圆形 RECTANGLE（正方形 + 满圆角）→ 应输出 ellipse
      type: "RECTANGLE", name: "圆形形状", absX: 540, absY: 50, width: 100, height: 100,
      rotation: 0, opacity: 1, cornerRadius: 50,
      fills: [{ type: "SOLID", color: { r: 0.9, g: 0.3, b: 0.2 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
    {
      // 圆角 RECTANGLE → roundRect 且 adj 有效
      type: "RECTANGLE", name: "圆角矩形", absX: 50, absY: 250, width: 200, height: 120,
      rotation: 0, opacity: 1, cornerRadius: 12,
      fills: [{ type: "SOLID", color: { r: 0.1, g: 0.8, b: 0.5 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
    {
      // 无圆角 RECTANGLE → rect（无 avLst）
      type: "RECTANGLE", name: "直角矩形", absX: 300, absY: 250, width: 200, height: 120,
      rotation: 0, opacity: 1, cornerRadius: 0,
      fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
  ],
};

const pptx = createPresentation([frame], { slideSize: "16x9", scaleMode: "fit", fileName: "corner-test" });
const buf = await pptx.write({ outputType: "nodebuffer" });
fs.mkdirSync("test/output", { recursive: true });
fs.writeFileSync("test/output/corner-test.pptx", buf);

const zip = await JSZip.loadAsync(buf);
const s = await zip.file("ppt/slides/slide1.xml").async("string");

const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
const shapes = [];
let m;
while ((m = spRe.exec(s))) {
  const sp = m[1];
  const prst = (sp.match(/prst="([^"]+)"/) || [])[1];
  const adj = (sp.match(/fmla="val (\d+)"/) || [])[1];
  const hasAv = sp.includes("<a:avLst>");
  shapes.push({ prst, adj: hasAv ? adj : null });
}

const expect = [
  { name: "圆形容器→ellipse", ok: shapes[0].prst === "ellipse" },
  { name: "非统一圆角卡片→roundRect+有效adj", ok: shapes[1].prst === "roundRect" && Number(shapes[1].adj) > 0 },
  { name: "圆形形状→ellipse", ok: shapes[2].prst === "ellipse" },
  { name: "圆角矩形→roundRect+adj", ok: shapes[3].prst === "roundRect" && Number(shapes[3].adj) > 0 },
  { name: "直角矩形→rect", ok: shapes[4].prst === "rect" },
];

console.log(shapes.map((x, i) => `#${i + 1} [${x.prst}] adj=${x.adj ?? "无"}`).join("\n"));
let pass = true;
for (const e of expect) {
  console.log((e.ok ? "  PASS " : "  FAIL ") + e.name);
  if (!e.ok) pass = false;
}
if (!pass) process.exit(1);
