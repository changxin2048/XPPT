// Frame2PPT — Custom UI 逻辑
import { createPresentation } from "./converter.js";

const $ = (s) => document.querySelector(s);

const ICON_CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3.2 3.2L13 5"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 5v3.6"/><path d="M8 11.2h.01"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8"/><path d="m4.5 7 3.5 3.5L11.5 7"/><path d="M2.5 13.5h11"/></svg>';

let frames = [];
let busy = false;

const selectionEmpty = $("#selectionEmpty");
const frameList = $("#frameList");
const convertBtn = $("#convertBtn");
const progressWrap = $("#progressWrap");
const progressFill = $("#progressFill");
const progressText = $("#progressText");
const statusEl = $("#status");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === "selection") renderSelection(msg.frames || []);
  else if (msg.type === "progress") renderProgress(msg);
  else if (msg.type === "data") generateAndDownload(msg.frames || [], msg.fileName);
  else if (msg.type === "error") showError(msg.message || "发生未知错误");
};

function renderSelection(list) {
  frames = list;
  frameList.innerHTML = "";
  if (!list.length) {
    selectionEmpty.classList.remove("hidden");
    frameList.classList.add("hidden");
    convertBtn.disabled = true;
    return;
  }
  selectionEmpty.classList.add("hidden");
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
  convertBtn.disabled = false;
}

function renderProgress(p) {
  const pct = Math.round((p.index / p.total) * 100);
  progressWrap.classList.remove("hidden");
  progressFill.style.width = pct + "%";
  progressText.textContent = "正在转换 " + p.index + "/" + p.total + " · " + p.name;
}

function setBusy(b) {
  busy = b;
  convertBtn.classList.toggle("loading", b);
  convertBtn.disabled = b || !frames.length;
}

function showStatus(kind, icon, text) {
  statusEl.className = "status " + kind;
  statusEl.innerHTML = icon + "<span>" + escapeHtml(text) + "</span>";
  statusEl.classList.remove("hidden");
}

function showSuccess(text) {
  showStatus("success", ICON_CHECK, text);
}

function showError(text) {
  showStatus("error", ICON_ALERT, text);
}

function getSettings() {
  const mode = document.querySelector('input[name="scaleMode"]:checked');
  return {
    slideSize: $("#slideSize").value,
    scaleMode: mode ? mode.value : "fit",
    exportScale: $("#exportScale").value,
    fileName: $("#fileName").value.trim(),
  };
}

convertBtn.addEventListener("click", () => {
  if (busy) return;
  if (!frames.length) {
    showError("请先在画布中选择要转换的 Frame");
    return;
  }
  statusEl.classList.add("hidden");
  progressWrap.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "准备中…";
  setBusy(true);
  parent.postMessage({ pluginMessage: { type: "convert", settings: getSettings() } }, "*");
});

$("#rescanBtn").addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "rescan" } }, "*");
});

async function generateAndDownload(dataFrames, fileName) {
  try {
    const settings = getSettings();
    const pptx = createPresentation(dataFrames, {
      slideSize: settings.slideSize,
      scaleMode: settings.scaleMode,
      fileName: fileName || "Frame2PPT",
      onProgress: (index, total, name) => renderProgress({ index, total, name }),
    });
    progressText.textContent = "正在生成 PPTX 文件…";
    const blob = await pptx.write({ outputType: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = /\.pptx$/i.test(fileName) ? fileName : fileName + ".pptx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    showSuccess("已生成 " + dataFrames.length + " 页幻灯片，文件开始下载");
  } catch (e) {
    console.error("[Frame2PPT]", e);
    showError((e && e.message) || "PPT 生成失败");
  } finally {
    setBusy(false);
  }
}
