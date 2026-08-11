// Frame2PPT 转换逻辑的 Node 测试：用模拟的 Frame 数据生成 PPT，并校验结构与内容
import fs from "node:fs";
import JSZip from "jszip";
import { createPresentation } from "../src/converter.js";

// 1x1 红色像素 PNG（用于模拟从 Figma 导出的图片节点）
const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const mkFrame = (overrides) =>
  Object.assign(
    {
      name: "未命名 Frame",
      width: 1920,
      height: 1080,
      background: { type: "SOLID", color: { r: 0.96, g: 0.97, b: 1 }, opacity: 1 },
      children: [],
    },
    overrides
  );

const frame1 = mkFrame({
  name: "启动页",
  children: [
    {
      type: "RECTANGLE",
      name: "主视觉卡片",
      absX: 200, absY: 150, width: 1520, height: 560,
      rotation: 0, opacity: 1,
      cornerRadius: 24,
      fills: [{ type: "SOLID", color: { r: 0.13, g: 0.25, b: 0.55 }, opacity: 1 }],
      strokes: [], strokeWeight: 0,
      effects: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0 }, offset: { x: 0, y: 16 }, radius: 32, spread: 0, opacity: 0.25 },
      ],
    },
    {
      type: "TEXT",
      name: "主标题",
      absX: 260, absY: 230, width: 1400, height: 130,
      rotation: 0, opacity: 1,
      textAlignHorizontal: "CENTER", textAlignVertical: "MIDDLE",
      segments: [
        {
          characters: "AI 驱动的新一代工作台",
          fontName: { family: "PingFang SC", style: "Bold" },
          fontSize: 96, fontWeight: 700,
          textDecoration: "NONE",
          letterSpacing: { value: 0, unit: "PIXELS" },
          lineHeight: { value: 120, unit: "PIXELS" },
          fill: { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
      ],
    },
    {
      type: "TEXT",
      name: "副标题",
      absX: 260, absY: 380, width: 1400, height: 60,
      rotation: 0, opacity: 1,
      textAlignHorizontal: "CENTER", textAlignVertical: "TOP",
      segments: [
        {
          characters: "高效协作 · 智能创作 · 数据洞察",
          fontName: { family: "Inter", style: "Regular" },
          fontSize: 40, fontWeight: 400,
          textDecoration: "NONE",
          letterSpacing: { value: 4, unit: "PIXELS" },
          lineHeight: { value: 48, unit: "PIXELS" },
          fill: { type: "SOLID", color: { r: 0.82, g: 0.85, b: 0.94 }, opacity: 1 },
        },
      ],
    },
    {
      type: "ELLIPSE",
      name: "装饰圆",
      absX: 300, absY: 760, width: 120, height: 120,
      rotation: 0, opacity: 1,
      fills: [{ type: "SOLID", color: { r: 0.95, g: 0.55, b: 0.25 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
    {
      type: "RECTANGLE",
      name: "主按钮",
      absX: 760, absY: 770, width: 400, height: 100,
      rotation: 0, opacity: 1,
      cornerRadius: 50,
      fills: [{ type: "SOLID", color: { r: 0.06, g: 0.6, b: 0.98 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
    {
      type: "TEXT",
      name: "按钮文字",
      absX: 760, absY: 770, width: 400, height: 100,
      rotation: 0, opacity: 1,
      textAlignHorizontal: "CENTER", textAlignVertical: "MIDDLE",
      segments: [
        {
          characters: "立即开始",
          fontName: { family: "PingFang SC", style: "Medium" },
          fontSize: 40, fontWeight: 500,
          textDecoration: "NONE",
          letterSpacing: { value: 0, unit: "PIXELS" },
          lineHeight: { value: 52, unit: "PIXELS" },
          fill: { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 },
        },
      ],
    },
    {
      type: "LINE",
      name: "分隔线",
      absX: 860, absY: 900, width: 200, height: 4,
      rotation: 0, opacity: 1,
      strokes: [{ type: "SOLID", color: { r: 0.7, g: 0.72, b: 0.8 }, opacity: 1 }],
      strokeWeight: 4, effects: [],
    },
    {
      type: "STAR",
      name: "装饰星",
      absX: 1500, absY: 800, width: 100, height: 100,
      rotation: 15, opacity: 0.8,
      pointCount: 5,
      fills: [{ type: "SOLID", color: { r: 1, g: 0.85, b: 0.2 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
    {
      type: "__IMAGE__",
      name: "产品图",
      absX: 1700, absY: 780, width: 120, height: 120,
      rotation: 0, opacity: 1,
      dataUrl: RED_PNG,
    },
  ],
});

const frame2 = mkFrame({
  name: "数据页",
  width: 1920,
  height: 1080,
  children: [
    {
      type: "TEXT",
      name: "页面标题",
      absX: 120, absY: 100, width: 1000, height: 90,
      rotation: 0, opacity: 1,
      textAlignHorizontal: "LEFT", textAlignVertical: "TOP",
      segments: [
        {
          characters: "核心指标一览",
          fontName: { family: "PingFang SC", style: "Semibold" },
          fontSize: 64, fontWeight: 600,
          textDecoration: "NONE",
          letterSpacing: { value: 0, unit: "PIXELS" },
          lineHeight: { value: 80, unit: "PIXELS" },
          fill: { type: "SOLID", color: { r: 0.1, g: 0.12, b: 0.18 }, opacity: 1 },
        },
      ],
    },
    {
      type: "RECTANGLE",
      name: "数据卡片",
      absX: 120, absY: 260, width: 520, height: 300,
      rotation: 0, opacity: 1,
      cornerRadius: 16,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      strokes: [{ type: "SOLID", color: { r: 0.86, g: 0.88, b: 0.92 }, opacity: 1 }],
      strokeWeight: 2, effects: [],
    },
    {
      type: "POLYGON",
      name: "三角标记",
      absX: 140, absY: 600, width: 80, height: 70,
      rotation: 0, opacity: 1,
      pointCount: 3,
      fills: [{ type: "SOLID", color: { r: 0.05, g: 0.8, b: 0.55 }, opacity: 1 }],
      strokes: [], strokeWeight: 0, effects: [],
    },
  ],
});

const frames = [frame1, frame2];

const pptx = createPresentation(frames, {
  slideSize: "16x9",
  scaleMode: "fit",
  fileName: "sample",
  onProgress: (i, t, name) => console.log(`  [进度] ${i}/${t} ${name}`),
});

const outDir = "test/output";
fs.mkdirSync(outDir, { recursive: true });
const outPath = outDir + "/sample.pptx";
const buf = await pptx.write({ outputType: "nodebuffer" });
fs.writeFileSync(outPath, buf);
console.log("已生成:", outPath, "(" + (fs.statSync(outPath).size / 1024).toFixed(1) + " KB)");

// ---------- 结构校验 ----------
const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
const slideKeys = Object.keys(zip.files)
  .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
  .sort();
console.log("幻灯片页数:", slideKeys.length, "(应为 2)");

const slide1 = await zip.file(slideKeys[0]).async("string");
const slide2 = await zip.file(slideKeys[1]).async("string");

const checks = [
  ["包含主标题文字", slide1.includes("AI 驱动的新一代工作台")],
  ["副标题带字距", slide1.includes("高效协作")],
  ["矩形色块", slide1.includes("prstGeom") && slide1.includes('prst="rect"')],
  ["圆角矩形", slide1.includes('prst="roundRect"')],
  ["圆形", slide1.includes('prst="ellipse"')],
  ["星形", slide1.includes("star5")],
  ["线条", slide1.includes('prst="line"') || slide1.includes("<a:ln " )],
  ["内嵌图片", slide1.includes("<p:pic>")],
  ["背景纯色填充", slide1.includes("<p:bg>")],
  ["第二页标题", slide2.includes("核心指标一览")],
  ["三角形状", slide2.includes('prst="triangle"')],
];

let pass = true;
for (const [name, ok] of checks) {
  console.log((ok ? "  PASS" : "  FAIL") + "  " + name);
  if (!ok) pass = false;
}

if (!pass) {
  console.error("存在未通过的校验项");
  process.exit(1);
}
console.log("全部校验通过");
