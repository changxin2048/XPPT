// Frame2PPT — Figma 插件主线程
// 负责：读取选中内容（Frame 每页一个；无 Frame 时合并为一页）→ 加载字体 → 序列化节点树（含图片导出）→ 传给 Custom UI 生成 PPT

const FRAME_TYPES = ["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"];
const IMAGE_ONLY_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "CONNECTOR", "EMBED", "MEDIA", "STAMP", "WASHI_TAPE", "SHAPE_WITH_TEXT", "SLICE"];
const STAR_POINTS = { 4: true, 5: true, 6: true, 7: true, 10: true };
const PNG = "image/png";

let imageCache = {};

// ---------- 工具函数 ----------

function u8ToDataUrl(bytes, mime) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return "data:" + mime + ";base64," + btoa(binary);
}

// ---------- 图片导出优化：超大内容自动降倍 + 不透明背景用 JPEG ----------

// 单张导出图片尺寸上限：超过上限自动降低导出倍数，从源头压缩数据量，
// 避免 UI 线程打包（base64 解码 + zip 组装）被大图拖慢
const MAX_EXPORT_DIM = 8192; // 单边像素上限
const MAX_EXPORT_PIXELS = 4096 * 4096; // 总像素上限（≈16.7MP）

function adaptiveScale(node, baseScale) {
  const w = finiteDim(node.width, 1);
  const h = finiteDim(node.height, 1);
  let s = baseScale > 0 ? baseScale : 2;
  if (w * s > MAX_EXPORT_DIM) s = MAX_EXPORT_DIM / w;
  if (h * s > MAX_EXPORT_DIM) s = MAX_EXPORT_DIM / h;
  if (w * h * s * s > MAX_EXPORT_PIXELS) s = Math.sqrt(MAX_EXPORT_PIXELS / (w * h));
  return Math.max(0.01, Math.round(s * 100) / 100);
}

// 渐变填充是否完全不透明（决定能否安全使用 JPEG，JPEG 无 alpha 通道）
function gradientFullyOpaque(fills) {
  const grad = (fills || []).find((f) => f.type.indexOf("GRADIENT") === 0);
  if (!grad) return false;
  return (grad.gradientStops || []).every((s) => !s.color || s.color.a == null || s.color.a >= 0.999);
}

async function exportNodeImage(node, scale, format) {
  const fmt = format === "JPG" ? "JPG" : "PNG";
  const bytes = await node.exportAsync({ format: fmt, constraint: { type: "SCALE", value: scale } });
  return u8ToDataUrl(bytes, fmt === "JPG" ? "image/jpeg" : PNG);
}

// 收集任意节点（含非 Frame）下的全部 TEXT 节点
function collectTextNodes(nodes) {
  const out = [];
  const walk = (n) => {
    if (n.type === "TEXT") { out.push(n); return; }
    if (n.children) for (const c of n.children) walk(c);
  };
  (nodes || []).forEach(walk);
  return out;
}

async function loadFonts(nodes) {
  const textNodes = collectTextNodes(nodes).filter((n) => n.characters.length > 0);
  const keys = new Set();
  for (const t of textNodes) {
    try {
      const names = await t.getRangeAllFontNamesAsync(0, t.characters.length);
      names.forEach((n) => keys.add(n.family + "|" + n.style));
    } catch (e) {
      try {
        const fn = t.fontName;
        if (fn && fn !== figma.mixed) keys.add(fn.family + "|" + fn.style);
      } catch (_) { /* 忽略无字体节点 */ }
    }
  }
  const fonts = [...keys].map((k) => {
    const i = k.lastIndexOf("|");
    return { family: k.slice(0, i), style: k.slice(i + 1) };
  });
  if (figma.loadFontsAsync) {
    await figma.loadFontsAsync(fonts);
  } else {
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  }
}

function serializeFills(fills) {
  if (!fills || fills === figma.mixed) return [];
  return fills
    .filter((f) => f && f.visible !== false)
    .map((f) => {
      const o = { type: f.type, opacity: f.opacity != null ? f.opacity : 1 };
      if (f.type === "SOLID") o.color = f.color;
      else if (f.type === "IMAGE") o.imageHash = f.imageHash;
      else if (f.type.indexOf("GRADIENT") === 0) {
        o.gradientStops = (f.gradientStops || []).map((s) => ({ color: s.color, position: s.position }));
      }
      return o;
    });
}

function serializeStrokes(strokes) {
  if (!strokes || strokes === figma.mixed) return [];
  return strokes
    .filter((s) => s && s.visible !== false)
    .map((s) => ({ type: s.type, color: s.color, opacity: s.opacity != null ? s.opacity : 1 }));
}

function serializeEffects(effects) {
  if (!effects) return [];
  return effects
    .filter((e) => e.visible !== false)
    .map((e) => {
      const o = { type: e.type };
      if (e.color) o.color = e.color;
      if (e.offset) o.offset = { x: e.offset.x, y: e.offset.y };
      if (typeof e.radius === "number") o.radius = e.radius;
      if (typeof e.spread === "number") o.spread = e.spread;
      if (typeof e.opacity === "number") o.opacity = e.opacity;
      return o;
    });
}

// 返回圆角半径（px）。非统一圆角（如只圆上方两角）时取最大半径近似，
// 保证输出为可编辑的圆角形状而非直角/正方形
function getCornerRadius(node) {
  let max = 0;
  try {
    for (const v of [node.topLeftRadius, node.topRightRadius, node.bottomLeftRadius, node.bottomRightRadius]) {
      if (typeof v === "number" && v > max) max = v;
    }
    return max;
  } catch (_) { /* 节点无该属性 */ }
  const cr = node.cornerRadius;
  return typeof cr === "number" && cr > max ? cr : max;
}

function hasNonSolidFill(fills) {
  return (fills || []).some((f) => f && f.type !== "SOLID");
}

function hasBlur(effects) {
  return (effects || []).some((e) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR");
}

function exportImageReason(node) {
  if (node.isMask) return "mask";
  if (IMAGE_ONLY_TYPES.indexOf(node.type) >= 0) return "type:" + node.type;
  if (node.type === "POLYGON" && node.pointCount !== 3) return "polygon:" + node.pointCount;
  if (node.type === "STAR" && !STAR_POINTS[node.pointCount]) return "star:" + node.pointCount;
  if (hasBlur(node.effects)) return "blur-effect";
  if (node.type === "LINE" || node.type === "TEXT") return null;
  if (hasNonSolidFill(node.fills)) {
    const bad = (node.fills || []).filter((f) => f && f.type !== "SOLID").map((f) => f.type);
    return "fill:" + bad.join(",");
  }
  return null;
}

function shouldExportAsImage(node) {
  return !!exportImageReason(node);
}

// 调试：输出节点树中每个节点的处理方式（不导出图片，安全快速）
function describeNode(node, depth) {
  const list = [];
  const rot = typeof node.rotation === "number" ? node.rotation : 0;
  const reason = exportImageReason(node) || (rot !== 0 && !!node.children ? "rotated-container" : null) || "editable";
  list.push({ depth, type: node.type, name: node.name, reason });
  if (node.children) {
    for (const c of node.children) {
      if (c.type === "SLICE") continue;
      list.push(...describeNode(c, depth + 1));
    }
  }
  return list;
}

function applyTextCase(text, textCase) {
  if (!textCase || !text) return text;
  if (textCase === "UPPER") return text.toUpperCase();
  if (textCase === "LOWER") return text.toLowerCase();
  if (textCase === "TITLE") return text.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return text;
}

// 判断文字是否为"设计中的单行"（无显式换行 + 框高≈单行行高）。
// 单行文字在 PPT 中应禁止自动换行，避免因回退字体更宽导致误换行。
function computeSingleLine(node) {
  if (node.characters && node.characters.indexOf("\n") >= 0) return false;
  let lh = null;
  try {
    const fs = typeof node.fontSize === "number" ? node.fontSize : 16;
    const lhObj = node.lineHeight;
    if (lhObj && lhObj !== figma.mixed && typeof lhObj.value === "number") {
      lh = lhObj.unit === "PIXELS" ? lhObj.value : (lhObj.unit === "PERCENT" ? (fs * lhObj.value) / 100 : fs * 1.2);
    } else {
      lh = fs * 1.2;
    }
  } catch (_) {
    return true;
  }
  if (!lh || lh <= 0) return true;
  return node.height <= lh * 1.35;
}

// 有效正数尺寸：缺尺寸 / 0 / NaN 时回退，保证导出图片的宽高始终合法
function finiteDim(v, fb) {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : fb;
}

async function exportNodeAsImage(node, frameOrigin, exportScale) {
  const bb = node.absoluteBoundingBox || {};
  // 细长线条的绝对包围盒可能缺一边（或为 0），需回退到节点自身尺寸 / 描边宽度，
  // 否则缺边被 pptxgenjs 兜底成 1 英寸会导致线条宽度/高度突变
  const width = finiteDim(bb.width, finiteDim(node.width, 1));
  const height = finiteDim(bb.height, finiteDim(node.height, finiteDim(node.strokeWeight, 1)));
  return {
    type: "__IMAGE__",
    name: node.name,
    dataUrl: await exportNodeImage(node, adaptiveScale(node, exportScale), "PNG"),
    absX: (typeof bb.x === "number" ? bb.x : node.x) - frameOrigin.x,
    absY: (typeof bb.y === "number" ? bb.y : node.y) - frameOrigin.y,
    width,
    height,
  };
}

function buildText(node, common) {
  const out = Object.assign({}, common);
  out.characters = node.characters;
  out.textAlignHorizontal = node.textAlignHorizontal;
  out.textAlignVertical = node.textAlignVertical;
  out.textAutoResize = node.textAutoResize;
  out.singleLine = computeSingleLine(node);
  out.segments = [];
  try {
    const segs = node.getStyledTextSegments([
      "characters", "fontName", "fontSize", "fontWeight",
      "fills", "textDecoration", "letterSpacing", "lineHeight", "textCase",
    ]);
    for (const s of segs) {
      if (!s.characters) continue;
      const fill = s.fills && s.fills[0];
      out.segments.push({
        characters: applyTextCase(s.characters, s.textCase),
        fontName: s.fontName,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        textDecoration: s.textDecoration,
        letterSpacing: s.letterSpacing,
        lineHeight: s.lineHeight,
        fill: fill ? serializeFills([fill])[0] : null,
      });
    }
  } catch (e) {
    const fill = node.fills && node.fills[0];
    out.segments.push({
      characters: applyTextCase(node.characters, node.textCase),
      fontName: node.fontName,
      fontSize: node.fontSize,
      fontWeight: null,
      textDecoration: node.textDecoration,
      letterSpacing: node.letterSpacing,
      lineHeight: node.lineHeight,
      fill: fill ? serializeFills([fill])[0] : null,
    });
  }
  return out;
}

// ---------- 节点序列化 ----------

async function serializeNode(node, frameOrigin, absX, absY, inheritedOpacity, exportScale) {
  if (node.visible === false) return null;
  const type = node.type;
  const rot = typeof node.rotation === "number" ? node.rotation : 0;
  const ownOpacity = typeof node.opacity === "number" ? node.opacity : 1;
  const opacity = ownOpacity * (inheritedOpacity != null ? inheritedOpacity : 1);
  const hasChildren = !!node.children;

  // 复杂/不可编辑节点，或旋转容器 → 整棵子树导出为图片，保证视觉一致
  if (shouldExportAsImage(node) || (rot !== 0 && hasChildren)) {
    return await exportNodeAsImage(node, frameOrigin, exportScale);
  }

  const common = {
    id: node.id,
    type: type,
    name: node.name,
    width: node.width,
    height: node.height,
    absX: absX,
    absY: absY,
    rotation: rot,
    opacity: opacity,
    fills: serializeFills(node.fills),
    strokes: serializeStrokes(node.strokes),
    strokeWeight: typeof node.strokeWeight === "number" ? node.strokeWeight : 0,
    strokeDashes: Array.isArray(node.dashPattern) && node.dashPattern.length ? [...node.dashPattern] : Array.isArray(node.strokeDashes) && node.strokeDashes.length ? node.strokeDashes : null,
    effects: serializeEffects(node.effects),
  };

  // 未旋转的叶子节点：用 absoluteBoundingBox 精确定位，兼容分组/组件坐标差异
  if (!hasChildren && rot === 0 && node.absoluteBoundingBox) {
    const bb = node.absoluteBoundingBox;
    common.absX = bb.x - frameOrigin.x;
    common.absY = bb.y - frameOrigin.y;
  }

  if (type === "TEXT") return buildText(node, common);

  if (["FRAME", "GROUP", "COMPONENT", "INSTANCE", "COMPONENT_SET", "SECTION"].indexOf(type) >= 0) {
    common.cornerRadius = getCornerRadius(node);
    common.children = [];
    for (const c of node.children) {
      if (c.type === "SLICE" || c.visible === false) continue;
      const s = await serializeNode(c, frameOrigin, absX + c.x, absY + c.y, opacity, exportScale);
      if (s) common.children.push(s);
    }
    return common;
  }

  if (type === "RECTANGLE") {
    common.cornerRadius = typeof getCornerRadius(node) === "number" ? getCornerRadius(node) : 0;
    return common;
  }
  if (type === "ELLIPSE") return common;
  if (type === "LINE") {
    // Figma 中 LINE 节点的 x/y 为线段中点
    if (rot === 0) {
      common.absX = common.absX + common.width / 2;
    }
    common.height = Math.max(node.strokeWeight || 1, 1);
    return common;
  }
  if (type === "STAR") {
    common.pointCount = node.pointCount || 5;
    return common;
  }
  if (type === "POLYGON") {
    common.pointCount = node.pointCount;
    return common;
  }
  return await exportNodeAsImage(node, frameOrigin, exportScale);
}

async function serializeFrame(frame, exportScale) {
  const frameOrigin = frame.absoluteBoundingBox;
  const root = {
    name: frame.name,
    width: frame.width,
    height: frame.height,
    background: null,
    children: [],
  };
  const fills = serializeFills(frame.fills);
  const solid = fills.find((f) => f.type === "SOLID");
  if (solid) {
    root.background = { type: "SOLID", color: solid.color, opacity: solid.opacity };
  } else if (fills.length) {
    // 渐变/图片背景 → 整帧导出为背景图；渐变完全不透明（无圆角/无透明）时用 JPEG 减小体积
    const jpegSafe =
      gradientFullyOpaque(fills) &&
      getCornerRadius(frame) === 0 &&
      (typeof frame.opacity !== "number" || frame.opacity >= 0.999);
    root.background = { type: "IMAGE", dataUrl: await exportNodeImage(frame, adaptiveScale(frame, exportScale), jpegSafe ? "JPG" : "PNG") };
  }
  for (const c of frame.children) {
    if (c.type === "SLICE" || c.visible === false) continue;
    const s = await serializeNode(c, frameOrigin, c.x, c.y, 1, exportScale);
    if (s) root.children.push(s);
  }
  return root;
}

// 计算一组节点的包围盒（用于无 Frame 时虚拟成一页）
function selectionBounds(nodes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const bb = n.absoluteBoundingBox;
    if (!bb) continue;
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 无 Frame 时：把选中的任意节点虚拟包装成一页（不修改画布）
async function serializeVirtualFrame(nodes, exportScale) {
  const box = selectionBounds(nodes);
  if (!box) throw new Error("无法确定选中内容的边界");
  const root = {
    name: (nodes[0] && nodes[0].name) || "选中内容",
    width: box.width,
    height: box.height,
    background: null,
    children: [],
  };
  for (const n of nodes) {
    if (n.visible === false) continue;
    const bb = n.absoluteBoundingBox || box;
    const s = await serializeNode(n, box, bb.x - box.x, bb.y - box.y, 1, exportScale);
    if (s) root.children.push(s);
  }
  return root;
}

// ---------- 主流程 ----------

function defaultFileName(count) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return "Frame2PPT-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + (count ? "-" + count + "p" : "");
}

function updateSelection() {
  const sel = figma.currentPage.selection || [];
  const frames = sel.filter((n) => FRAME_TYPES.indexOf(n.type) >= 0);
  figma.ui.postMessage({
    type: "selection",
    frames: frames.map((f) => ({ id: f.id, name: f.name, width: Math.round(f.width), height: Math.round(f.height) })),
    debug: { total: sel.length, types: sel.map((n) => n.type), names: sel.map((n) => n.name) },
  });
}

async function convertSelection(nodes, exportScale) {
  const frames = nodes.filter((n) => FRAME_TYPES.indexOf(n.type) >= 0);
  if (!frames.length) {
    // 无 Frame：将选中内容合并为一页
    if (!nodes.length) throw new Error("请先选择要转换的内容");
    const name = (nodes[0] && nodes[0].name) || "选中内容";
    await loadFonts(nodes);
    figma.ui.postMessage({ type: "progress", index: 1, total: 1, name });
    return [await serializeVirtualFrame(nodes, exportScale)];
  }
  await loadFonts(frames);
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    figma.ui.postMessage({ type: "progress", index: i + 1, total: frames.length, name: f.name });
    out.push(await serializeFrame(f, exportScale));
  }
  return out;
}

// ---------- 初始化 ----------

figma.showUI(__html__, { width: 372, height: 680, themeColors: true });

figma.on("selectionchange", updateSelection);
figma.on("currentpagechange", updateSelection);
updateSelection();
// 兜底：UI 若未及时回传 ui-ready，延迟再同步一次
setTimeout(updateSelection, 300);

figma.ui.onmessage = async (msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "ui-ready") {
    // Custom UI 加载完成后主动拉取一次当前选择，避免启动时首条消息丢失
    updateSelection();
    return;
  }
  if (msg.type === "rescan") {
    updateSelection();
    return;
  }
  if (msg.type === "close-plugin") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "debug-tree") {
    const nodes = [];
    for (const n of figma.currentPage.selection) nodes.push(...describeNode(n, 0));
    figma.ui.postMessage({ type: "debug-tree", total: figma.currentPage.selection.length, nodes });
    return;
  }
  if (msg.type === "convert") {
    const settings = msg.settings || {};
    const exportScale = Math.min(4, Math.max(1, Number(settings.exportScale) || 2));
    const selected = figma.currentPage.selection;
    if (!selected.length) {
      figma.ui.postMessage({ type: "error", message: "请先在画布中选择要转换的内容。" });
      return;
    }
    try {
      const data = await convertSelection(selected, exportScale);
      const fileName = (settings.fileName && settings.fileName.trim()) || defaultFileName(data.length);
      figma.ui.postMessage({ type: "data", frames: data, fileName: fileName });
    } catch (e) {
      console.error("[Frame2PPT]", e);
      figma.ui.postMessage({ type: "error", message: (e && e.message) || "转换失败，请重试。" });
    }
  }
};
