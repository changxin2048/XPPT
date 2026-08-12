// 验证：单行文字（自动宽度/固定框）→ wrap=none + 加宽120%；多行固定文字保持 wrap=square
import fs from "node:fs";
import JSZip from "jszip";
import { createPresentation } from "../src/converter.js";

const mkText = (name, x, align, autoResize, height, singleLine) => ({
  type: "TEXT", name, absX: x, absY: 100, width: 400, height,
  rotation: 0, opacity: 1,
  textAlignHorizontal: align, textAlignVertical: "TOP",
  textAutoResize: autoResize,
  singleLine,
  segments: [{ characters: "一段测试文字", fontName: { family: "PingFang SC", style: "Regular" }, fontSize: 24, fontWeight: 400, textDecoration: "NONE", letterSpacing: { value: 0, unit: "PIXELS" }, lineHeight: { value: 30, unit: "PIXELS" }, fill: { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 } }],
});

const frame = {
  name: "文字宽度测试",
  width: 1920, height: 1080,
  background: null,
  children: [
    // 自动宽度单行（height=30=一行）
    mkText("自动-左对齐", 100, "LEFT", "WIDTH_AND_HEIGHT", 30, true),
    mkText("自动-居中", 600, "CENTER", "WIDTH_AND_HEIGHT", 30, true),
    mkText("自动-右对齐", 1100, "RIGHT", "WIDTH_AND_HEIGHT", 30, true),
    // 固定框但单行（模拟底部 6 同级元素，height=30=一行）→ 也应 wrap=none
    mkText("固定单行-左对齐", 400, "LEFT", "NONE", 30, true),
    // 固定框多行（height=60=两行）→ wrap=square
    mkText("固定多行-左对齐", 1600, "LEFT", "NONE", 60, false),
  ],
};

const pptx = createPresentation([frame], { slideSize: "16x9", scaleMode: "fit", fileName: "text-width" });
const buf = await pptx.write({ outputType: "nodebuffer" });
fs.mkdirSync("test/output", { recursive: true });
fs.writeFileSync("test/output/text-width.pptx", buf);

const zip = await JSZip.loadAsync(buf);
const s = await zip.file("ppt/slides/slide1.xml").async("string");

const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
const shapes = [];
let m;
while ((m = spRe.exec(s))) {
  const sp = m[1];
  const off = sp.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
  const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const text = (sp.match(/<a:t>([^<]*)<\/a:t>/) || [])[1] || "";
  const wrap = (sp.match(/wrap="([^"]+)"/) || [])[1];
  const autoFit = sp.includes("spAutoFit") ? "sp" : sp.includes("normAutofit") ? "norm" : "none";
  shapes.push({ text, x: Number(off[1]), w: Number(ext[1]), wrap, autoFit });
}

// scale: frame 1920 → 10in；1px = 0.0052083in = 4762.5 EMU；文字 400px → 1905000 EMU
const baseW = 400 * 4762.5;
const slackW = 480 * 4762.5; // 400*1.2（避免浮点误差，直接写 480）
const a = shapes.find((x) => x.text === "一段测试文字");

const left = shapes[0];        // 自动-左对齐 (单行)
const center = shapes[1];      // 自动-居中 (单行)
const right = shapes[2];       // 自动-右对齐 (单行)
const fixedSingle = shapes[3]; // 固定框-单行
const fixedMulti = shapes[4];  // 固定框-多行

const checks = [
  { name: "自动-左对齐: 宽度=120%", ok: left.w === slackW },
  { name: "自动-左对齐: x 不变", ok: left.x === 100 * 4762.5 },
  { name: "自动-居中: 宽度=120%", ok: center.w === slackW },
  { name: "自动-居中: x 左移半个增量", ok: center.x === 600 * 4762.5 - (slackW - baseW) / 2 },
  { name: "自动-右对齐: x 左移整个增量", ok: right.x === 1100 * 4762.5 - (slackW - baseW) },
  { name: "单行(自动宽度): wrap=none", ok: left.wrap === "none" && center.wrap === "none" && right.wrap === "none" },
  { name: "单行(固定框): wrap=none", ok: fixedSingle.wrap === "none" },
  { name: "多行(固定框): wrap=square", ok: fixedMulti.wrap === "square" },
  { name: "单行: 不收缩(无autofit)", ok: left.autoFit === "none" && fixedSingle.autoFit === "none" },
  { name: "多行: 收缩(spAutoFit)", ok: fixedMulti.autoFit === "sp" },
];

for (const c of checks) {
  console.log((c.ok ? "  PASS " : "  FAIL ") + c.name);
}
if (checks.some((c) => !c.ok)) process.exit(1);
