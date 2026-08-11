// Frame2PPT — Figma 插件主线程
// 负责：读取选中 Frame → 加载字体 → 序列化节点树（含图片导出）→ 传给 Custom UI 生成 PPT

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

async function exportNodePng(node, scale) {
  const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale || 2 } });
  return u8ToDataUrl(bytes, PNG);
}

async function loadFonts(frames) {
  const textNodes = frames.flatMap((f) => f.findAll((n) => n.type === "TEXT")).filter((n) => n.characters.length > 0);
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

function getCornerRadius(node) {
  try {
    if (typeof node.topLeftRadius === "number") {
      const tl = node.topLeftRadius;
      const tr = node.topRightRadius;
      const bl = node.bottomLeftRadius;
      const br = node.bottomRightRadius;
      if (tl === tr && tl === bl && tl === br) return tl;
      return { tl, tr, bl, br }; // 非统一圆角 → 图片兜底
    }
  } catch (_) { /* 节点无该属性 */ }
  const cr = node.cornerRadius;
  return typeof cr === "number" ? cr : 0;
}

function hasNonSolidFill(fills) {
  return (fills || []).some((f) => f && f.type !== "SOLID");
}

function hasBlur(effects) {
  return (effects || []).some((e) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR");
}

function shouldExportAsImage(node) {
  if (node.isMask) return true;
  if (IMAGE_ONLY_TYPES.indexOf(node.type) >= 0) return true;
  if (node.type === "POLYGON" && node.pointCount !== 3) return true;
  if (node.type === "STAR" && !STAR_POINTS[node.pointCount]) return true;
  if (hasBlur(node.effects)) return true;
  if (node.type === "LINE" || node.type === "TEXT") return false;
  if (hasNonSolidFill(node.fills)) return true;
  if (node.type === "RECTANGLE" && typeof getCornerRadius(node) === "object") return true;
  return false;
}

function applyTextCase(text, textCase) {
  if (!textCase || !text) return text;
  if (textCase === "UPPER") return text.toUpperCase();
  if (textCase === "LOWER") return text.toLowerCase();
  if (textCase === "TITLE") return text.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return text;
}

async function exportNodeAsImage(node, frameOrigin) {
  const bb = node.absoluteBoundingBox;
  return {
    type: "__IMAGE__",
    name: node.name,
    dataUrl: await exportNodePng(node, 2),
    absX: bb.x - frameOrigin.x,
    absY: bb.y - frameOrigin.y,
    width: bb.width,
    height: bb.height,
  };
}

function buildText(node, common) {
  const out = Object.assign({}, common);
  out.characters = node.characters;
  out.textAlignHorizontal = node.textAlignHorizontal;
  out.textAlignVertical = node.textAlignVertical;
  out.textAutoResize = node.textAutoResize;
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

async function serializeNode(node, frameOrigin, absX, absY, inheritedOpacity) {
  if (node.visible === false) return null;
  const type = node.type;
  const rot = typeof node.rotation === "number" ? node.rotation : 0;
  const ownOpacity = typeof node.opacity === "number" ? node.opacity : 1;
  const opacity = ownOpacity * (inheritedOpacity != null ? inheritedOpacity : 1);
  const hasChildren = !!node.children;

  // 复杂/不可编辑节点，或旋转容器 → 整棵子树导出为图片，保证视觉一致
  if (shouldExportAsImage(node) || (rot !== 0 && hasChildren)) {
    return await exportNodeAsImage(node, frameOrigin);
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
    strokeDashes: Array.isArray(node.strokeDashes) && node.strokeDashes.length ? node.strokeDashes : null,
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
      const s = await serializeNode(c, frameOrigin, absX + c.x, absY + c.y, opacity);
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
  return await exportNodeAsImage(node, frameOrigin);
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
    // 渐变/图片背景 → 整帧导出为背景图
    root.background = { type: "IMAGE", dataUrl: await exportNodePng(frame, exportScale) };
  }
  for (const c of frame.children) {
    if (c.type === "SLICE" || c.visible === false) continue;
    const s = await serializeNode(c, frameOrigin, c.x, c.y, 1);
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
  const frames = figma.currentPage.selection.filter((n) => FRAME_TYPES.indexOf(n.type) >= 0);
  figma.ui.postMessage({
    type: "selection",
    frames: frames.map((f) => ({ id: f.id, name: f.name, width: Math.round(f.width), height: Math.round(f.height) })),
  });
}

async function convertSelection(nodes, exportScale) {
  const frames = nodes.filter((n) => FRAME_TYPES.indexOf(n.type) >= 0);
  if (!frames.length) throw new Error("未找到可转换的 Frame");
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

figma.ui.onmessage = async (msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "rescan") {
    updateSelection();
    return;
  }
  if (msg.type === "convert") {
    const settings = msg.settings || {};
    const exportScale = Math.min(4, Math.max(1, Number(settings.exportScale) || 2));
    const selected = figma.currentPage.selection.filter((n) => FRAME_TYPES.indexOf(n.type) >= 0);
    if (!selected.length) {
      figma.ui.postMessage({ type: "error", message: "请先在画布中选择要转换的 Frame。" });
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
