// XPPT — Custom UI 逻辑
import { createPresentation } from "./converter.js";

const $ = (s) => document.querySelector(s);

const ICON_ALERT = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 5v3.6"/><path d="M8 11.2h.01"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8"/><path d="m4.5 7 3.5 3.5L11.5 7"/><path d="M2.5 13.5h11"/></svg>';
const ICON_SPINNER_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.18"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';
const ICON_DONE_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity="0.18"/><path d="m7.5 12.5 3.2 3.2 6-6"/></svg>';

let frames = [];
let hasContent = false; // 是否有可转换内容（Frame 或多个非 Frame 合并为一页）
let busy = false;

const selectionEmpty = $("#selectionEmpty");
const selectionEmptyIcon = $("#selectionEmptyIcon");
const frameList = $("#frameList");
const convertBtn = $("#convertBtn");
const progressWrap = $("#progressWrap");
const progressText = $("#progressText");
const modalSpinner = $("#modalSpinner");
const statusEl = $("#status");
const selectionEmptyTip = $("#selectionEmptyTip");
const progressModal = $("#progressModal");
const modalTitle = $("#modalTitle");
const modalCloseBtn = $("#modalCloseBtn");
const modalDoneBtn = $("#modalDoneBtn");

// 底部提示：x 为真实数字——选中项数、生成的幻灯片页数
function buildHintText(itemCount, pageCount) {
  return "已选择 " + itemCount + " 项，将转成 " + pageCount + " 页幻灯片";
}
const EMPTY_TIP_TEXT = "请在画布中选择要转换的 Frame 或其他内容";

// 与主线程预估阈值保持一致，仅用于组装警告文案
const WARN_LEVELS = { nodes: 5000, text: 500, images: 100, pixels: 32 * 1024 * 1024, pages: 8 };

// 默认文件名取自选中元素：单个用其名称，多个取首尾名称用“-”连接；兜底才用 XPPT
function sanitizeFileName(name) {
  const clean = String(name == null ? "" : name)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "XPPT";
}

function deriveFileName(list, debug) {
  let names = [];
  if (debug && debug.names && debug.names.length) names = debug.names;
  else if (list && list.length) names = list.map((f) => f.name);
  if (!names.length) return "XPPT";
  const safe = names.map(sanitizeFileName);
  return safe.length > 1 ? safe[0] + "-" + safe[safe.length - 1] : safe[0];
}

let derivedFileName = "XPPT"; // 默认下载文件名（用户可在浏览器下载时自行修改）

function rememberDefaultFileName(list, debug) {
  derivedFileName = deriveFileName(list, debug);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === "selection") {
    renderSelection(msg.frames || [], msg.debug);
    renderSizeWarn(msg.estimate);
  }
  else if (msg.type === "progress") renderProgress(msg);
  else if (msg.type === "data") generateAndDownload(msg.frames || [], msg.fileName);
  else if (msg.type === "error") {
    // 转换/生成过程中出错：若弹窗已打开则在弹窗内展示
    if (!progressModal.classList.contains("hidden")) showModalError(msg.message || "发生未知错误");
    else showError(msg.message || "发生未知错误");
  }
  else if (msg.type === "debug-tree") renderDebugTree(msg);
};

function renderDebugTree(msg) {
  const out = $("#debugOut");
  const lines = ["选中节点: " + (msg.total || 0)];
  (msg.nodes || []).forEach((n) => {
    lines.push("  ".repeat(n.depth) + n.type + ' "' + (n.name || "") + '" -> ' + (n.reason || "?"));
  });
  out.textContent = lines.join("\n");
  $("#debugWrap").classList.remove("hidden");
}

$("#copyDebugBtn").addEventListener("click", () => {
  const text = $("#debugOut").textContent || "";
  const copyToClipboard = () => {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    // Figma 插件环境中可能无 Clipboard API，回退到 execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  };
  copyToClipboard().then(() => {
    const label = $("#copyDebugBtn").querySelector("span");
    const old = label.textContent;
    label.textContent = "已复制";
    setTimeout(() => { label.textContent = old; }, 1200);
  });
});

// 通知主线程 UI 已就绪（带上当前设置，同步导出精度到转换成本预估），主动拉取当前画布选择
parent.postMessage({ pluginMessage: { type: "ui-ready", settings: getSettings() } }, "*");

// 根据主线程预估，在转换前提示"内容较大、预计耗时较长"
function renderSizeWarn(estimate) {
  const el = $("#sizeWarn");
  const text = $("#sizeWarnText");
  if (!estimate || !estimate.heavy) {
    el.classList.add("hidden");
    return;
  }
  const gte = (v, cap) => (estimate.capped && v >= cap ? "≥" : "") + v;
  const parts = [];
  if (estimate.pages >= WARN_LEVELS.pages) parts.push(estimate.pages + " 页幻灯片");
  if (estimate.nodeCount >= WARN_LEVELS.nodes) parts.push(gte(estimate.nodeCount, WARN_LEVELS.nodes) + " 个节点");
  if (estimate.textCount >= WARN_LEVELS.text) parts.push(estimate.textCount + " 段文字");
  if (estimate.imageCount >= WARN_LEVELS.images) parts.push(gte(estimate.imageCount, WARN_LEVELS.images) + " 张图片导出");
  if (estimate.imagePixels >= WARN_LEVELS.pixels) parts.push((estimate.imagePixels / 1024 / 1024).toFixed(1) + " MP 图片导出");
  if (!parts.length) parts.push("内容较大");
  text.textContent = "检测到转换内容较大（" + parts.join(" · ") + "），预计耗时较长，请耐心等待";
  el.classList.remove("hidden");
}

function renderSelection(list, debug) {
  frames = list;
  hasContent = list.length > 0 || !!(debug && debug.total > 0);
  frameList.innerHTML = "";
  if (!list.length) {
    if (debug && debug.total > 0) {
      // 无 Frame 但有选中内容 → 合并为一页
      frameList.classList.remove("hidden");
      const li = document.createElement("li");
      li.className = "frame-item";
      const name = (debug.names && debug.names[0]) || "选中内容";
      li.innerHTML =
        '<span class="frame-idx">1</span>' +
        '<span class="frame-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + "</span>" +
        '<span class="frame-size">' + debug.total + " 个节点 · 合并 1 页</span>";
      frameList.appendChild(li);
      selectionEmptyIcon.classList.add("hidden");
      selectionEmptyTip.innerHTML = buildHintText(debug.total, 1);
      rememberDefaultFileName(list, debug);
      convertBtn.disabled = false;
      return;
    }
    selectionEmpty.classList.remove("hidden");
    frameList.classList.add("hidden");
    convertBtn.disabled = true;
    selectionEmptyIcon.classList.remove("hidden");
    selectionEmptyTip.innerHTML = EMPTY_TIP_TEXT;
    rememberDefaultFileName(list, debug);
    return;
  }
  frameList.classList.remove("hidden");
  list.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "frame-item";
    li.innerHTML =
      '<span class="frame-idx">' + (i + 1) + '</span>' +
      '<span class="frame-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</span>' +
      '<span class="frame-size">' + f.width + "×" + f.height + "</span>";
    frameList.appendChild(li);
  });
  // 混选：Frame 之外的其他节点合并为一页
  if (debug && debug.otherCount > 0) {
    const name = debug.othersName || "其他内容";
    const li = document.createElement("li");
    li.className = "frame-item";
    li.innerHTML =
      '<span class="frame-idx">' + (list.length + 1) + '</span>' +
      '<span class="frame-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>' +
      '<span class="frame-size">' + debug.otherCount + " 个节点 · 合并 1 页</span>";
    frameList.appendChild(li);
  }
  selectionEmptyIcon.classList.add("hidden");
  const itemCount = (debug && debug.total) || list.length;
  const pageCount = list.length + ((debug && debug.otherCount > 0) ? 1 : 0);
  selectionEmptyTip.innerHTML = buildHintText(itemCount, pageCount);
  rememberDefaultFileName(list, debug);
  convertBtn.disabled = false;
}

function renderProgress(p) {
  progressWrap.classList.remove("hidden");
  setProgressText("正在转换 " + p.index + "/" + p.total + " · " + p.name);
}

function setBusy(b) {
  busy = b;
  convertBtn.classList.toggle("loading", b);
  convertBtn.disabled = b || !hasContent;
}

function showStatus(kind, icon, text) {
  statusEl.className = "status " + kind;
  statusEl.innerHTML = icon + "<span>" + escapeHtml(text) + "</span>";
  statusEl.classList.remove("hidden");
}

function showError(text) {
  showStatus("error", ICON_ALERT, text);
}

// ---------- 进度弹窗 ----------

function resetModalSpinner() {
  modalSpinner.innerHTML = ICON_SPINNER_SVG;
  modalSpinner.classList.remove("done");
}

function setProgressText(text, kind, title) {
  progressText.textContent = text;
  progressText.classList.toggle("success", kind === "success");
  progressText.classList.toggle("error", kind === "error");
  modalTitle.textContent = title || "正在转换";
}

function openProgressModal() {
  resetModalSpinner();
  modalCloseBtn.classList.add("hidden");
  modalDoneBtn.classList.add("hidden");
  setProgressText("准备中…");
  progressModal.classList.remove("hidden");
}

function closeProgressModal() {
  resetModalSpinner();
  progressModal.classList.add("hidden");
  modalCloseBtn.classList.add("hidden");
  modalDoneBtn.classList.add("hidden");
  setProgressText("准备中…");
}

function showModalSuccess(text) {
  modalSpinner.innerHTML = ICON_DONE_SVG;
  modalSpinner.classList.add("done");
  modalCloseBtn.classList.add("hidden");
  modalDoneBtn.classList.remove("hidden");
  setProgressText(text, "success", "转换完成");
}

function showModalError(text) {
  modalCloseBtn.classList.remove("hidden");
  modalDoneBtn.classList.add("hidden");
  setProgressText(text, "error", "转换失败");
}

function clampPct(v, def) {
  const n = parseFloat(v);
  if (isNaN(n)) return def;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function getSettings() {
  return {
    slideSize: $("#slideSize").value,
    scalePct: clampPct($("#scalePct").value, 90),
    exportScale: $("#exportScale").value,
    fileName: derivedFileName,
  };
}

convertBtn.addEventListener("click", () => {
  if (busy) return;
  if (!hasContent) {
    showError("请先在画布中选择要转换的内容");
    return;
  }
  statusEl.classList.add("hidden");
  openProgressModal();
  setBusy(true);
  parent.postMessage({ pluginMessage: { type: "convert", settings: getSettings() } }, "*");
});

modalCloseBtn.addEventListener("click", () => {
  closeProgressModal();
  setBusy(false);
});

modalDoneBtn.addEventListener("click", () => {
  closeProgressModal();
  setBusy(false);
});

$("#rescanBtn").addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "rescan", settings: getSettings() } }, "*");
});

$("#debugBtn").addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "debug-tree" } }, "*");
});

async function generateAndDownload(dataFrames, fileName) {
  try {
    const settings = getSettings();
    const pptx = createPresentation(dataFrames, {
      slideSize: settings.slideSize,
      scalePct: settings.scalePct,
      fileName: fileName || "XPPT",
      onProgress: (index, total, name) => renderProgress({ index, total, name }),
    });
    setProgressText("正在生成 PPTX 文件…", undefined, "正在生成");
    // 让出主线程一帧，先完成本次界面绘制（文案/转圈），再进入耗时的打包阶段
    await new Promise((r) => setTimeout(r, 30));
    const blob = await pptx.write({ outputType: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = /\.pptx$/i.test(fileName) ? fileName : fileName + ".pptx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    // 下载已触发：弹窗内提示成功，不自动关闭；用户点击「完成」后关闭弹窗
    showModalSuccess("已生成 " + dataFrames.length + " 页幻灯片，文件开始下载");
  } catch (e) {
    console.error("[XPPT]", e);
    showModalError((e && e.message) || "PPT 生成失败");
  } finally {
    setBusy(false);
  }
}
