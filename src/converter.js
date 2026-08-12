// Frame2PPT 转换核心：将序列化后的 Figma 节点树转换为可编辑的 PPT。
// 纯逻辑模块（不依赖 DOM / Figma API），可在浏览器（Custom UI）与 Node（测试）中复用。
import pptxgen from "pptxgenjs";

export const SLIDE_SIZES = {
  "16x9": { label: "16:9", w: 10, h: 5.625 },
  "16x10": { label: "16:10", w: 10, h: 6.25 },
  "4x3": { label: "4:3", w: 10, h: 7.5 },
  "wide": { label: "宽屏 16:9", w: 13.333, h: 7.5 },
};

const CONTAINER_TYPES = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "INSTANCE",
  "COMPONENT_SET",
  "SECTION",
]);

const ALIGN_MAP = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
const VALIGN_MAP = { TOP: "top", CENTER: "middle", BOTTOM: "bottom" };
const STAR_PRESETS = { 4: "star4Point", 5: "star5Point", 6: "star6Point", 7: "star7Point", 10: "star10Point" };

const to2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

// 图片/形状尺寸防御：宽度或高度缺失、为 0 或 NaN 时退回极小值，
// 避免被 pptxgenjs 的 `h: NaN || 1`（或 `0 || 1`）兜底成恰好 1 英寸，
// 导致横向线高度/竖向线宽度突变
const posDim = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0.001);

export function rgbHex(c) {
  if (!c) return "000000";
  return to2(c.r * 255) + to2(c.g * 255) + to2(c.b * 255);
}

function isBold(fontName, weight) {
  if (typeof weight === "number" && weight >= 600) return true;
  const s = ((fontName && fontName.style) || "").toLowerCase();
  return /bold|black|heavy|medium/.test(s);
}

function isItalic(fontName) {
  const s = ((fontName && fontName.style) || "").toLowerCase();
  return /italic|oblique/.test(s);
}

const solidFill = (fill) =>
  fill && fill.type === "SOLID" ? { color: rgbHex(fill.color), transparency: fill.opacity != null && fill.opacity < 1 ? (1 - fill.opacity) * 100 : 0 } : null;

function dropShadow(effects, S) {
  const sh = (effects || []).find((e) => e.type === "DROP_SHADOW");
  if (!sh) return undefined;
  const dx = sh.offset ? sh.offset.x : 0;
  const dy = sh.offset ? sh.offset.y : 0;
  // Figma 投影透明度在 color.a 中（0-1），而非独立的 opacity 字段
  const opacity =
    sh.color && typeof sh.color.a === "number"
      ? sh.color.a
      : typeof sh.opacity === "number"
      ? sh.opacity
      : 0.4;
  return {
    type: "outer",
    color: rgbHex(sh.color),
    blur: pt(sh.radius || 0, S),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    offset: pt(Math.hypot(dx, dy), S),
    opacity: Math.max(0, Math.min(1, opacity)),
  };
}

const pxToPt = (px, S) => px * S.scale * 72;
const pt = pxToPt;
// pptxgenjs 的 rectRadius 单位是英寸
const pxToIn = (px, S) => px * S.scale;

function dashType(node) {
  if (!node.strokeDashes || !node.strokeDashes.length) return undefined;
  const first = node.strokeDashes[0] || 1;
  return first >= 3 ? "dash" : "dot";
}

// 判断是否为"圆形"：正方形 + 圆角半径 ≥ 边长一半 → 直接输出 ellipse 保证真圆
function isCircleLike(node) {
  return (
    typeof node.cornerRadius === "number" &&
    node.cornerRadius > 0 &&
    Math.abs(node.width - node.height) < 1 &&
    node.cornerRadius * 2 >= node.width
  );
}

// 仅在 cornerRadius 是有效数字时应用圆角
function applyRectRadius(opts, node, S) {
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    opts.rectRadius = pxToIn(node.cornerRadius, S);
  }
}

/**
 * 根据序列化后的 frames 创建 PPT 对象。
 * @param {Array} frames 由 code.js 序列化的 Frame 数组
 * @param {Object} settings { slideSize, scalePct, fileName, onProgress }
 */
export function createPresentation(frames, settings = {}) {
  const size = SLIDE_SIZES[settings.slideSize] || SLIDE_SIZES["16x9"];
  const scalePct = clampPct(settings.scalePct, 90);

  const pptx = new pptxgen();
  pptx.defineLayout({ name: "F2P", width: size.w, height: size.h });
  pptx.layout = "F2P";
  pptx.author = "Frame2PPT";
  pptx.title = settings.fileName || "Frame2PPT";
  pptx.subject = "由 Figma Frame 转换生成";

  frames.forEach((frame, i) => {
    if (settings.onProgress) settings.onProgress(i + 1, frames.length, frame.name);
    const slide = pptx.addSlide();
    addFrame(slide, frame, size, scalePct);
  });

  return pptx;
}

// 缩放百分比限制在 1%–100%
function clampPct(v, def) {
  const n = parseFloat(v);
  if (isNaN(n)) return def;
  return Math.max(1, Math.min(100, n));
}

function addFrame(slide, frame, size, scalePct) {
  // 页面背景
  const bg = frame.background;
  if (bg) {
    if (bg.type === "SOLID") {
      slide.background = { color: rgbHex(bg.color) };
    } else if (bg.type === "IMAGE" && bg.dataUrl) {
      const mime = /jpeg|jpg/i.test(bg.dataUrl) ? "jpg" : "png";
      slide.background = { data: bg.dataUrl.split(",")[1] || bg.dataUrl, type: mime };
    }
  }

  // 缩放区域：内容占幻灯片宽/高的比例（等比），Frame 等比缩放居中放入
  const regionW = (size.w * scalePct) / 100;
  const regionH = (size.h * scalePct) / 100;
  const scale = Math.min(regionW / frame.width, regionH / frame.height);
  const offX = (size.w - frame.width * scale) / 2;
  const offY = (size.h - frame.height * scale) / 2;

  const S = { scale };
  const toX = (px) => offX + px * scale;
  const toY = (px) => offY + px * scale;
  const toW = (px) => px * scale;
  const toH = (px) => px * scale;

  const walk = (node) => {
    if (!node) return;
    if (node.type === "__IMAGE__") {
      slide.addImage({ data: node.dataUrl, x: toX(node.absX), y: toY(node.absY), w: toW(posDim(node.width)), h: toH(posDim(node.height)) });
      return;
    }
    if (node.type === "TEXT") {
      addText(slide, node, S, toX, toY, toW, toH);
      return;
    }
    if (node.type === "LINE") {
      addLine(slide, node, S, toX, toY, toW, toH);
      return;
    }
    if (node.type === "RECTANGLE") {
      // 圆形（正方形+满圆角）→ 直接画椭圆保证真圆；否则按圆角矩形/直角矩形
      addShape(slide, node, S, toX, toY, toW, toH, isCircleLike(node) ? "ellipse" : node.cornerRadius ? "roundRect" : "rect");
      return;
    }
    if (node.type === "ELLIPSE") {
      addShape(slide, node, S, toX, toY, toW, toH, "ellipse");
      return;
    }
    if (node.type === "STAR") {
      const preset = STAR_PRESETS[node.pointCount] || "star5Point";
      addShape(slide, node, S, toX, toY, toW, toH, preset);
      return;
    }
    if (node.type === "POLYGON" && node.pointCount === 3) {
      addShape(slide, node, S, toX, toY, toW, toH, "triangle");
      return;
    }
    if (CONTAINER_TYPES.has(node.type)) {
      const fill = solidFill(node.fills && node.fills[0]);
      const stroke = node.strokes && node.strokes[0];
      // 有填充或描边的容器 → 画一个矩形/圆角矩形（含描边与投影，避免白卡在白底上消失）
      if (fill || (stroke && stroke.type === "SOLID" && node.strokeWeight > 0)) {
        const opts = buildShapeOptions(node, S, toX, toY, toW, toH);
        if (isCircleLike(node)) {
          slide.addShape("ellipse", opts);
        } else if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
          applyRectRadius(opts, node, S);
          // 注意：圆角必须用 roundRect 预设，rect 预设即使带 adj 也会被 PowerPoint 忽略
          slide.addShape("roundRect", opts);
        } else {
          slide.addShape("rect", opts);
        }
      }
      (node.children || []).forEach(walk);
      return;
    }
    // 兜底：其它类型直接以图片占位
    if (node.dataUrl) {
      slide.addImage({ data: node.dataUrl, x: toX(node.absX), y: toY(node.absY), w: toW(posDim(node.width)), h: toH(posDim(node.height)) });
    }
  };

  (frame.children || []).forEach(walk);
}

function addText(slide, t, S, toX, toY, toW, toH) {
  const segs = t.segments && t.segments.length
    ? t.segments
    : [{ characters: t.characters, fontName: t.fontName, fontSize: t.fontSize, fontWeight: null, textDecoration: t.textDecoration, letterSpacing: t.letterSpacing, lineHeight: t.lineHeight, fill: t.fills && t.fills[0] }];

  const runs = segs.map((seg) => {
    const fill = solidFill(seg.fill);
    const opts = {
      color: fill ? fill.color : "000000",
      fontFace: (seg.fontName && seg.fontName.family) || "Arial",
      bold: isBold(seg.fontName, seg.fontWeight),
      italic: isItalic(seg.fontName),
      underline: seg.textDecoration === "UNDERLINE",
      strike: seg.textDecoration === "STRIKETHROUGH",
      breakLine: false,
    };
    if (typeof seg.fontSize === "number") opts.fontSize = pxToPt(seg.fontSize, S);
    const ls = seg.letterSpacing;
    if (ls && typeof ls.value === "number") {
      const px = ls.unit === "PERCENT" && typeof seg.fontSize === "number" ? (seg.fontSize * ls.value) / 100 : ls.value;
      opts.charSpacing = pxToPt(px, S);
    }
    return { text: seg.characters, options: opts };
  });

  // 设计中的单行文字（含自动宽度与固定框）→ 禁止自动换行(wrap=none)、关闭收缩，
  // 加宽 20% 并按对齐方式微调 x 保持视觉位置，避免 PPT 回退字体更宽导致误换行。
  const singleLine = !!t.singleLine;
  const slack = singleLine ? 0.2 : 0;
  const box = {
    x: toX(t.absX),
    y: toY(t.absY),
    w: toW(t.width * (1 + slack)),
    h: toH(t.height),
    align: ALIGN_MAP[t.textAlignHorizontal] || "left",
    valign: VALIGN_MAP[t.textAlignVertical] || "top",
    autoFit: !singleLine,
    wrap: !singleLine,
    inset: 0,
  };
  if (slack > 0) {
    const grow = toW(t.width * slack);
    if (t.textAlignHorizontal === "CENTER") box.x = toX(t.absX) - grow / 2;
    else if (t.textAlignHorizontal === "RIGHT") box.x = toX(t.absX) - grow;
  }
  if (t.rotation) box.rotate = t.rotation;

  const first = segs[0];
  const fs = first && typeof first.fontSize === "number" ? first.fontSize : t.fontSize;
  const lh = first && first.lineHeight;
  if (lh && fs && typeof lh.value === "number") {
    if (lh.unit === "PIXELS") box.lineSpacingMultiple = lh.value / fs;
    else if (lh.unit === "PERCENT") box.lineSpacingMultiple = lh.value / 100;
  }

  slide.addText(runs, box);
}

// 形状/容器的公共选项：位置、旋转、透明度、填充、描边、投影
function buildShapeOptions(node, S, toX, toY, toW, toH) {
  const opts = {
    x: toX(node.absX),
    y: toY(node.absY),
    w: toW(node.width),
    h: toH(node.height),
  };
  if (node.rotation) opts.rotate = node.rotation;
  if (node.opacity != null && node.opacity < 1) opts.transparency = (1 - node.opacity) * 100;

  const fill = solidFill(node.fills && node.fills[0]);
  opts.fill = fill || { color: "FFFFFF", transparency: 100 };

  const stroke = node.strokes && node.strokes[0];
  if (stroke && stroke.type === "SOLID" && node.strokeWeight > 0) {
    opts.line = {
      color: rgbHex(stroke.color),
      width: pxToPt(node.strokeWeight, S),
      transparency: stroke.opacity != null && stroke.opacity < 1 ? (1 - stroke.opacity) * 100 : 0,
    };
    const dd = dashType(node);
    if (dd) opts.lineDash = dd;
  }

  const shadow = dropShadow(node.effects, S);
  if (shadow) opts.shadow = shadow;

  return opts;
}

function addShape(slide, node, S, toX, toY, toW, toH, preset) {
  const opts = buildShapeOptions(node, S, toX, toY, toW, toH);
  if (preset === "roundRect") applyRectRadius(opts, node, S);
  slide.addShape(preset, opts);
}

function addLine(slide, node, S, toX, toY, toW, toH) {
  const opts = {
    x: toX(node.absX),
    y: toY(node.absY),
    w: toW(node.width),
    h: Math.max(toH(node.height), 0.01),
  };
  if (node.rotation) opts.rotate = node.rotation;
  const stroke = node.strokes && node.strokes[0];
  const weight = Math.max(0.5, pxToPt(node.strokeWeight || 1, S));
  opts.line = { color: stroke && stroke.type === "SOLID" ? rgbHex(stroke.color) : "000000", width: weight };
  const dd = dashType(node);
  if (dd) opts.lineDash = dd;
  slide.addShape("line", opts);
}
