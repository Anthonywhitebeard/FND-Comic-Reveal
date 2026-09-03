const MODULE_ID = "comic-reveal";
const PROJECT_FILENAME = "comic-reveal-project.json";
const COLORS = ["#55d6ff", "#ffcf56", "#ff6b9d", "#7cff6b", "#c69cff", "#ff8c42"];

let builder = null;

export function openComicBuilder({ onExport, projectPath, initialProject } = {}) {
  if (!game.user.isGM) return;
  if (builder?.root?.isConnected) return;

  builder = createBuilderState(onExport);
  builder.root = createBuilderElement();
  document.body.appendChild(builder.root);
  bindBuilder(builder);
  refreshBuilder(builder);
  requestAnimationFrame(() => builder.root.classList.add("is-open"));
  if (projectPath) loadProjectFromPath(builder, projectPath).catch((error) => reportBuilderError(builder, error));
  else if (initialProject) loadProjectValue(builder, initialProject).catch((error) => reportBuilderError(builder, error));
}

function createBuilderState(onExport) {
  return {
    root: null,
    project: {
      format: "comic-reveal-project",
      version: 2,
      title: game.i18n.localize("CR.Builder.DefaultTitle"),
      outputFolder: "comics/new-comic",
      pages: []
    },
    activePageId: null,
    activeLayerId: null,
    tool: "freehand",
    draft: [],
    drawing: false,
    previewStep: null,
    image: null,
    baseImage: null,
    layerImages: new Map(),
    imageCache: new Map(),
    dirty: false,
    exporting: false,
    draggedLayerId: null,
    onExport
  };
}

function createBuilderElement() {
  const root = document.createElement("section");
  root.id = "comic-reveal-builder";
  root.className = "comic-reveal-builder";
  root.innerHTML = `
    <header class="cr-builder-header">
      <div class="cr-builder-brand"><i class="fa-solid fa-pen-ruler"></i> ${text("CR.Builder.Title")}</div>
      <label><span>${text("CR.Manager.Name")}</span><input name="projectTitle" type="text"></label>
      <label class="cr-builder-output"><span>${text("CR.Builder.OutputFolder")}</span><span><input name="outputFolder" type="text"><button type="button" data-builder-action="browse-output"><i class="fa-solid fa-folder-open"></i></button></span></label>
      <button type="button" data-builder-action="load-project"><i class="fa-solid fa-folder-tree"></i> ${text("CR.Builder.LoadProject")}</button>
      <button type="button" data-builder-action="export" class="cr-primary"><i class="fa-solid fa-file-export"></i> ${text("CR.Builder.Export")}</button>
      <button type="button" data-builder-action="close" title="${attr("CR.Common.Close")}"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="cr-builder-body">
      <aside class="cr-builder-pages">
        <div class="cr-builder-section-title">${text("CR.Builder.Pages")}</div>
        <button type="button" data-builder-action="add-page" class="cr-primary"><i class="fa-solid fa-plus"></i> ${text("CR.Builder.AddPage")}</button>
        <div data-builder-pages></div>
      </aside>
      <main class="cr-builder-workspace">
        <div class="cr-builder-empty" data-builder-empty>${text("CR.Builder.Empty")}</div>
        <div class="cr-builder-canvas-wrap" data-builder-canvas-wrap hidden>
          <canvas data-builder-canvas></canvas>
        </div>
        <div class="cr-builder-tools">
          <div class="cr-tool-group" data-builder-tools>
            <button type="button" data-builder-action="tool" data-tool="freehand" title="${attr("CR.Builder.FreehandHint")}"><i class="fa-solid fa-signature"></i> ${text("CR.Builder.Freehand")}</button>
            <button type="button" data-builder-action="tool" data-tool="polygon" title="${attr("CR.Builder.PolygonHint")}"><i class="fa-solid fa-draw-polygon"></i> ${text("CR.Builder.Polygon")}</button>
            <button type="button" data-builder-action="tool" data-tool="rectangle"><i class="fa-regular fa-square"></i> ${text("CR.Builder.Rectangle")}</button>
            <button type="button" data-builder-action="finish-polygon"><i class="fa-solid fa-check"></i> ${text("CR.Builder.Finish")}</button>
            <button type="button" data-builder-action="cancel-draft"><i class="fa-solid fa-ban"></i> ${text("CR.Builder.Cancel")}</button>
          </div>
          <div class="cr-tool-group">
            <button type="button" data-builder-action="preview-edit"><i class="fa-solid fa-pen"></i> ${text("CR.Builder.EditMode")}</button>
            <button type="button" data-builder-action="preview-previous"><i class="fa-solid fa-backward-step"></i></button>
            <span data-builder-preview-label></span>
            <button type="button" data-builder-action="preview-next"><i class="fa-solid fa-forward-step"></i></button>
          </div>
        </div>
      </main>
      <aside class="cr-builder-regions">
        <div class="cr-builder-section-title">${text("CR.Builder.Layers")}</div>
        <button type="button" data-builder-action="add-layer" class="cr-primary"><i class="fa-solid fa-layer-group"></i> ${text("CR.Builder.AddLayer")}</button>
        <div data-builder-layers></div>
        <button type="button" data-builder-action="choose-layer-image"><i class="fa-solid fa-image"></i> ${text("CR.Builder.ChooseLayerImage")}</button>
        <div class="cr-builder-section-title">${text("CR.Builder.RevealOrder")}</div>
        <p>${text("CR.Builder.DrawHint")}</p>
        <div data-builder-regions></div>
      </aside>
    </div>
    <footer class="cr-builder-status" data-builder-status>${text("CR.Builder.Ready")}</footer>
  `;
  return root;
}

function bindBuilder(state) {
  state.root.addEventListener("click", (event) => onBuilderClick(state, event));
  state.root.addEventListener("dragstart", (event) => onLayerDragStart(state, event));
  state.root.addEventListener("dragover", (event) => onLayerDragOver(state, event));
  state.root.addEventListener("drop", (event) => onLayerDrop(state, event));
  state.root.addEventListener("dragend", () => clearLayerDragState(state));
  state.root.querySelector("[name='projectTitle']").addEventListener("input", (event) => {
    state.project.title = event.target.value;
    state.dirty = true;
  });
  state.root.querySelector("[name='outputFolder']").addEventListener("input", (event) => {
    state.project.outputFolder = event.target.value;
    state.dirty = true;
  });

  const canvas = state.root.querySelector("[data-builder-canvas]");
  canvas.addEventListener("pointerdown", (event) => onCanvasPointerDown(state, event));
  canvas.addEventListener("pointermove", (event) => onCanvasPointerMove(state, event));
  canvas.addEventListener("pointerup", (event) => onCanvasPointerUp(state, event));
  canvas.addEventListener("pointercancel", (event) => onCanvasPointerUp(state, event));
  canvas.addEventListener("dblclick", (event) => {
    if (state.tool !== "polygon") return;
    event.preventDefault();
    finishDraft(state);
  });
  document.addEventListener("keydown", onBuilderKeydown, true);
  window.addEventListener("paste", onBuilderPaste, true);
}

async function onBuilderClick(state, event) {
  const button = event.target.closest?.("[data-builder-action]");
  if (!button || state.exporting) return;
  event.preventDefault();
  const action = button.dataset.builderAction;

  try {
    if (action === "close") return closeBuilder(state);
    if (action === "add-page") return addEmptyPage(state);
    if (action === "add-layer") {
      await addEmptyLayer(state);
      return;
    }
    if (action === "choose-layer-image") return chooseLayerImage(state);
    if (action === "load-project") return chooseProjectFile(state);
    if (action === "browse-output") return chooseOutputFolder(state);
    if (action === "export") {
      await exportProject(state);
      return;
    }
    if (action === "tool") {
      state.tool = button.dataset.tool;
      state.previewStep = null;
      state.draft = [];
      return refreshBuilder(state);
    }
    if (action === "finish-polygon") return finishDraft(state);
    if (action === "cancel-draft") {
      state.draft = [];
      state.drawing = false;
      return renderCanvas(state);
    }
    if (action === "preview-edit") {
      state.previewStep = null;
      return refreshBuilder(state);
    }
    if (action === "preview-previous") return changePreview(state, -1);
    if (action === "preview-next") return changePreview(state, 1);

    const pageId = button.closest("[data-page-id]")?.dataset.pageId;
    if (action === "select-page") {
      await selectPage(state, pageId);
      return;
    }
    if (action === "delete-page") {
      await deletePage(state, pageId);
      return;
    }
    if (action === "rename-page") return renamePage(state, pageId);
    if (action === "page-up") return movePage(state, pageId, -1);
    if (action === "page-down") return movePage(state, pageId, 1);

    const layerId = button.closest("[data-layer-id]")?.dataset.layerId;
    if (action === "select-layer") {
      await selectLayer(state, layerId);
      return;
    }
    if (action === "rename-layer") return renameLayer(state, layerId);
    if (action === "delete-layer") {
      await deleteLayer(state, layerId);
      return;
    }

    const regionIndex = Number(button.closest("[data-region-index]")?.dataset.regionIndex);
    if (action === "region-up") return moveRegion(state, regionIndex, -1);
    if (action === "region-down") return moveRegion(state, regionIndex, 1);
    if (action === "region-delete") return deleteRegion(state, regionIndex);
    if (action === "sound-select") return chooseRegionSound(state, regionIndex);
    if (action === "sound-preview") return previewRegionSound(state, regionIndex);
    if (action === "sound-clear") return clearRegionSound(state, regionIndex);
  } catch (error) {
    console.error(`${MODULE_ID} | Builder`, error);
    ui.notifications.error(error?.message || game.i18n.localize("CR.Errors.Unknown"));
    setStatus(state, error?.message || game.i18n.localize("CR.Errors.Unknown"), true);
  }
}

function addEmptyPage(state) {
  const layer = createLayer(1);
  const page = {
    id: foundry.utils.randomID(),
    name: game.i18n.format("CR.Builder.PageName", { number: state.project.pages.length + 1 }),
    layers: [layer],
    timeline: []
  };
  state.project.pages.push(page);
  state.activePageId = page.id;
  state.activeLayerId = layer.id;
  state.previewStep = null;
  state.dirty = true;
  state.image = null;
  state.baseImage = null;
  refreshBuilder(state);
}

async function addEmptyLayer(state) {
  const page = activePage(state);
  if (!page) return ui.notifications.warn(game.i18n.localize("CR.Builder.PageRequired"));
  const layer = createLayer(page.layers.length + 1);
  page.layers.push(layer);
  state.activeLayerId = layer.id;
  state.image = null;
  state.previewStep = null;
  state.dirty = true;
  await loadActiveImage(state);
  refreshBuilder(state);
  return layer;
}

function createLayer(number, source = "") {
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.format("CR.Builder.LayerName", { number }),
    source,
    regions: []
  };
}

function chooseLayerImage(state) {
  const layer = activeLayer(state);
  if (!layer) return ui.notifications.warn(game.i18n.localize("CR.Builder.LayerRequired"));
  openPicker("image", layer.source, async (path) => assignLayerImage(state, layer, path));
}

async function assignLayerImage(state, layer, path, { confirmReplace = true } = {}) {
  if (confirmReplace && layer.source && layer.source !== path) {
    const confirmed = window.confirm(game.i18n.localize("CR.Builder.ReplaceLayerConfirm"));
    if (!confirmed) return;
  }
  const previousPath = layer.source;
  layer.source = path;
  if (previousPath && previousPath !== path) state.imageCache.delete(previousPath);
  state.previewStep = null;
  state.dirty = true;
  await loadActiveImage(state);
  refreshBuilder(state);
}

function chooseOutputFolder(state) {
  openPicker("folder", state.project.outputFolder, (path) => {
    state.project.outputFolder = path;
    state.root.querySelector("[name='outputFolder']").value = path;
    state.dirty = true;
  });
}

function chooseProjectFile(state) {
  openPicker("any", state.project.outputFolder, async (path) => {
    await loadProjectFromPath(state, path);
  });
}

async function loadProjectFromPath(state, path) {
  const response = await fetch(withCacheBuster(path));
  if (!response.ok) throw new Error(game.i18n.localize("CR.Builder.LoadFailed"));
  await loadProjectValue(state, await response.json());
}

async function loadProjectValue(state, value) {
  const project = normalizeProject(value);
  state.project = project;
  state.activePageId = project.pages[0]?.id ?? null;
  state.activeLayerId = project.pages[0]?.layers[0]?.id ?? null;
  state.previewStep = null;
  state.draft = [];
  state.dirty = false;
  await loadActiveImage(state);
  refreshBuilder(state);
  setStatus(state, game.i18n.localize("CR.Builder.ProjectLoaded"));
}

function openPicker(type, current, callback) {
  const Picker = getFilePickerClass();
  const picker = new Picker({
    type,
    current,
    callback: async (...args) => {
      try {
        await callback(...args);
      } catch (error) {
        console.error(`${MODULE_ID} | Builder picker`, error);
        ui.notifications.error(error?.message || game.i18n.localize("CR.Errors.Unknown"));
        if (builder) setStatus(builder, error?.message || game.i18n.localize("CR.Errors.Unknown"), true);
      }
    }
  });
  picker.addEventListener("render", () => {
    picker.element.style.zIndex = "120001";
    picker.element.classList.add("comic-reveal-file-picker");
  }, { once: true });
  picker.render({ force: true });
}

async function selectPage(state, pageId) {
  const page = state.project.pages.find((entry) => entry.id === pageId);
  if (!page) return;
  state.activePageId = pageId;
  state.activeLayerId = page.layers[0]?.id ?? null;
  state.previewStep = null;
  state.draft = [];
  await loadActiveImage(state);
  refreshBuilder(state);
}

async function deletePage(state, pageId) {
  const page = state.project.pages.find((entry) => entry.id === pageId);
  if (!page || !window.confirm(game.i18n.format("CR.Builder.DeletePageConfirm", { name: page.name }))) return;
  state.project.pages = state.project.pages.filter((entry) => entry.id !== pageId);
  if (state.activePageId === pageId) {
    state.activePageId = state.project.pages[0]?.id ?? null;
    state.activeLayerId = state.project.pages[0]?.layers[0]?.id ?? null;
  }
  state.image = null;
  state.dirty = true;
  await loadActiveImage(state);
  refreshBuilder(state);
}

function renamePage(state, pageId) {
  const page = state.project.pages.find((entry) => entry.id === pageId);
  if (!page) return;
  const name = window.prompt(game.i18n.localize("CR.Builder.PageNamePrompt"), page.name)?.trim();
  if (!name) return;
  page.name = name;
  state.dirty = true;
  refreshBuilder(state);
}

function movePage(state, pageId, delta) {
  const index = state.project.pages.findIndex((page) => page.id === pageId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.project.pages.length) return;
  [state.project.pages[index], state.project.pages[target]] = [state.project.pages[target], state.project.pages[index]];
  state.dirty = true;
  refreshBuilder(state);
}

function activePage(state) {
  return state.project.pages.find((page) => page.id === state.activePageId) ?? null;
}

function activeLayer(state) {
  return activePage(state)?.layers.find((layer) => layer.id === state.activeLayerId) ?? null;
}

function onLayerDragStart(state, event) {
  const item = event.target.closest?.("[data-layer-id]");
  if (!item) return;
  state.draggedLayerId = item.dataset.layerId;
  item.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggedLayerId);
}

function onLayerDragOver(state, event) {
  if (!state.draggedLayerId) return;
  const item = event.target.closest?.("[data-layer-id]");
  if (!item || item.dataset.layerId === state.draggedLayerId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  for (const element of state.root.querySelectorAll(".cr-builder-layer.is-drop-target")) element.classList.remove("is-drop-target");
  item.classList.add("is-drop-target");
}

function onLayerDrop(state, event) {
  const targetId = event.target.closest?.("[data-layer-id]")?.dataset.layerId;
  const sourceId = state.draggedLayerId || event.dataTransfer.getData("text/plain");
  const layers = activePage(state)?.layers;
  if (!layers || !sourceId || !targetId || sourceId === targetId) return clearLayerDragState(state);
  event.preventDefault();
  if (!reorderLayers(layers, sourceId, targetId)) return clearLayerDragState(state);
  state.dirty = true;
  clearLayerDragState(state);
  refreshBuilder(state);
}

function clearLayerDragState(state) {
  state.draggedLayerId = null;
  for (const element of state.root.querySelectorAll(".cr-builder-layer.is-dragging, .cr-builder-layer.is-drop-target")) {
    element.classList.remove("is-dragging", "is-drop-target");
  }
}

function reorderLayers(layers, sourceId, targetId) {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceId);
  const targetIndex = layers.findIndex((layer) => layer.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;
  const [layer] = layers.splice(sourceIndex, 1);
  layers.splice(targetIndex, 0, layer);
  return true;
}

async function selectLayer(state, layerId) {
  if (!activePage(state)?.layers.some((layer) => layer.id === layerId)) return;
  state.activeLayerId = layerId;
  state.previewStep = null;
  state.draft = [];
  await loadActiveImage(state);
  refreshBuilder(state);
}

function renameLayer(state, layerId) {
  const layer = activePage(state)?.layers.find((entry) => entry.id === layerId);
  if (!layer) return;
  const name = window.prompt(game.i18n.localize("CR.Builder.LayerNamePrompt"), layer.name)?.trim();
  if (!name) return;
  layer.name = name;
  state.dirty = true;
  refreshBuilder(state);
}

async function deleteLayer(state, layerId) {
  const page = activePage(state);
  const layer = page?.layers.find((entry) => entry.id === layerId);
  if (!page || !layer || !window.confirm(game.i18n.format("CR.Builder.DeleteLayerConfirm", { name: layer.name }))) return;
  page.layers = page.layers.filter((entry) => entry.id !== layerId);
  page.timeline = page.timeline.filter((entry) => entry.layerId !== layerId);
  if (!page.layers.length) page.layers.push(createLayer(1));
  state.activeLayerId = page.layers[0].id;
  state.previewStep = null;
  state.dirty = true;
  await loadActiveImage(state);
  refreshBuilder(state);
}

async function loadActiveImage(state) {
  const page = activePage(state);
  if (!page) {
    state.image = null;
    state.baseImage = null;
    state.layerImages = new Map();
    return;
  }
  const layer = activeLayer(state);
  const baseLayer = page.layers.find((entry) => entry.source);
  const loaded = await Promise.all(page.layers.filter((entry) => entry.source).map(async (entry) => [entry.id, await loadImage(state, entry.source)]));
  state.layerImages = new Map(loaded);
  state.image = layer ? state.layerImages.get(layer.id) ?? null : null;
  state.baseImage = baseLayer ? state.layerImages.get(baseLayer.id) ?? null : null;
  sizeEditorCanvas(state);
}

async function loadImage(state, path) {
  if (state.imageCache.has(path)) return state.imageCache.get(path);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(game.i18n.format("CR.Builder.ImageLoadFailed", { path })));
    image.src = path;
  });
  state.imageCache.set(path, promise);
  return promise;
}

function sizeEditorCanvas(state) {
  if (!state.baseImage) return;
  const canvas = state.root.querySelector("[data-builder-canvas]");
  const scale = Math.min(1, 1600 / state.baseImage.naturalWidth, 900 / state.baseImage.naturalHeight);
  canvas.width = Math.max(1, Math.round(state.baseImage.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(state.baseImage.naturalHeight * scale));
}

function onCanvasPointerDown(state, event) {
  if (!state.image || state.previewStep !== null || event.button !== 0) return;
  event.preventDefault();
  const point = canvasPoint(event);
  if (state.tool === "polygon") {
    state.draft.push(point);
    renderCanvas(state);
    return;
  }
  state.drawing = true;
  state.draft = [point];
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onCanvasPointerMove(state, event) {
  if (!state.drawing || !state.image || state.previewStep !== null) return;
  const point = canvasPoint(event);
  if (state.tool === "rectangle") {
    state.draft[1] = point;
  } else if (state.tool === "freehand" && distance(last(state.draft), point) > 0.003) {
    state.draft.push(point);
  }
  renderCanvas(state);
}

function onCanvasPointerUp(state, event) {
  if (!state.drawing) return;
  state.drawing = false;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  if (state.tool === "rectangle" && state.draft.length === 2) {
    const [a, b] = state.draft;
    state.draft = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  }
  finishDraft(state);
}

function finishDraft(state) {
  const page = activePage(state);
  const layer = activeLayer(state);
  const points = simplifyPoints(state.draft);
  if (!page || !layer?.source || points.length < 3) {
    state.draft = [];
    return renderCanvas(state);
  }
  const region = { id: foundry.utils.randomID(), points };
  layer.regions.push(region);
  page.timeline.push({ layerId: layer.id, regionId: region.id, sound: null });
  state.draft = [];
  state.drawing = false;
  state.dirty = true;
  state.previewStep = null;
  refreshBuilder(state);
}

function moveRegion(state, index, delta) {
  const regions = activePage(state)?.timeline;
  const target = index + delta;
  if (!regions || index < 0 || target < 0 || target >= regions.length) return;
  [regions[index], regions[target]] = [regions[target], regions[index]];
  state.dirty = true;
  refreshBuilder(state);
}

function deleteRegion(state, index) {
  const page = activePage(state);
  const action = page?.timeline[index];
  if (!page || !action) return;
  page.timeline.splice(index, 1);
  const layer = page.layers.find((entry) => entry.id === action.layerId);
  if (layer) layer.regions = layer.regions.filter((region) => region.id !== action.regionId);
  state.dirty = true;
  state.previewStep = null;
  refreshBuilder(state);
}

function chooseRegionSound(state, index) {
  const action = activePage(state)?.timeline[index];
  if (!action) return;
  openPicker("audio", action.sound || "", (path) => {
    action.sound = path;
    state.dirty = true;
    refreshBuilder(state);
  });
}

function previewRegionSound(state, index) {
  const sound = activePage(state)?.timeline[index]?.sound;
  if (!sound) return;
  foundry.audio.AudioHelper.play({
    src: sound,
    volume: Number(game.settings.get(MODULE_ID, "effectVolume")),
    loop: false,
    autoplay: true,
    channel: "interface"
  }, false);
}

function clearRegionSound(state, index) {
  const action = activePage(state)?.timeline[index];
  if (!action?.sound) return;
  action.sound = null;
  state.dirty = true;
  refreshBuilder(state);
}

function changePreview(state, delta) {
  const count = activePage(state)?.timeline.length ?? 0;
  if (!count) return;
  if (state.previewStep === null) state.previewStep = -1;
  state.previewStep = Math.min(count - 1, Math.max(-1, state.previewStep + delta));
  refreshBuilder(state);
}

function refreshBuilder(state) {
  if (!state.root?.isConnected) return;
  state.root.querySelector("[name='projectTitle']").value = state.project.title;
  state.root.querySelector("[name='outputFolder']").value = state.project.outputFolder;
  state.root.querySelector("[data-builder-pages]").innerHTML = state.project.pages.map((page, index) => `
    <article class="cr-builder-page ${page.id === state.activePageId ? "is-active" : ""}" data-page-id="${escapeHtml(page.id)}">
      <button type="button" data-builder-action="select-page"><span>${index + 1}</span><strong>${escapeHtml(page.name)}</strong><small>${page.timeline.length}</small></button>
      <button type="button" data-builder-action="page-up" title="${attr("CR.Builder.PageUp")}" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" data-builder-action="page-down" title="${attr("CR.Builder.PageDown")}" ${index === state.project.pages.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
      <button type="button" data-builder-action="rename-page" title="${attr("CR.Builder.RenamePage")}"><i class="fa-solid fa-pen"></i></button>
      <button type="button" data-builder-action="delete-page" title="${attr("CR.Builder.DeletePage")}"><i class="fa-solid fa-trash"></i></button>
    </article>
  `).join("");

  const page = activePage(state);
  state.root.querySelector("[data-builder-layers]").innerHTML = page?.layers.length
    ? page.layers.map((layer, index) => `
      <article class="cr-builder-layer ${layer.id === state.activeLayerId ? "is-active" : ""}" data-layer-id="${escapeHtml(layer.id)}" draggable="true">
        <button type="button" data-builder-action="select-layer"><i class="fa-solid fa-layer-group"></i><strong>${escapeHtml(layer.name)}</strong><small>${layer.source ? layer.regions.length : "—"}</small></button>
        <button type="button" data-builder-action="rename-layer" title="${attr("CR.Builder.RenameLayer")}"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-builder-action="delete-layer" title="${attr("CR.Builder.DeleteLayer")}"><i class="fa-solid fa-trash"></i></button>
      </article>
    `).join("")
    : "";

  state.root.querySelector("[data-builder-regions]").innerHTML = page?.timeline.length
    ? page.timeline.map((action, index) => {
      const resolved = resolveAction(page, action);
      const soundLabel = action.sound ? fileName(action.sound) : game.i18n.localize("CR.Builder.NoSound");
      return `
      <article class="cr-builder-region" data-region-index="${index}">
        <span style="--region-color:${COLORS[index % COLORS.length]}">${index + 1}</span>
        <strong>${escapeHtml(resolved?.layer.name ?? game.i18n.format("CR.Builder.Region", { number: index + 1 }))}</strong>
        <button type="button" data-builder-action="region-up" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" data-builder-action="region-down" ${index === page.timeline.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" data-builder-action="region-delete"><i class="fa-solid fa-trash"></i></button>
        <div class="cr-region-sound ${action.sound ? "has-sound" : ""}">
          <button type="button" data-builder-action="sound-select" title="${attr("CR.Builder.ChooseSound")}"><i class="fa-solid fa-music"></i><span>${escapeHtml(soundLabel)}</span></button>
          <button type="button" data-builder-action="sound-preview" title="${attr("CR.Builder.PreviewSound")}" ${action.sound ? "" : "disabled"}><i class="fa-solid fa-volume-high"></i></button>
          <button type="button" data-builder-action="sound-clear" title="${attr("CR.Builder.ClearSound")}" ${action.sound ? "" : "disabled"}><i class="fa-solid fa-volume-xmark"></i></button>
        </div>
      </article>
    `;
    }).join("")
    : `<p class="cr-builder-no-regions">${text("CR.Builder.NoRegions")}</p>`;

  const hasCanvasImage = state.previewStep === null ? Boolean(state.image) : Boolean(state.baseImage);
  state.root.querySelector("[data-builder-empty]").hidden = hasCanvasImage;
  state.root.querySelector("[data-builder-empty]").textContent = page
    ? game.i18n.localize("CR.Builder.EmptyLayer")
    : game.i18n.localize("CR.Builder.Empty");
  state.root.querySelector("[data-builder-canvas-wrap]").hidden = !hasCanvasImage;
  for (const button of state.root.querySelectorAll("[data-builder-action='tool']")) {
    button.classList.toggle("is-active", button.dataset.tool === state.tool && state.previewStep === null);
  }
  state.root.querySelector("[data-builder-action='finish-polygon']").disabled = state.tool !== "polygon" || state.draft.length < 3;
  state.root.querySelector("[data-builder-action='cancel-draft']").disabled = !state.draft.length;
  state.root.querySelector("[data-builder-preview-label]").textContent = state.previewStep === null
    ? game.i18n.localize("CR.Builder.Editing")
    : game.i18n.format("CR.Builder.PreviewState", { current: state.previewStep + 1, total: page?.timeline.length ?? 0 });
  renderCanvas(state);
}

function resolveAction(page, action) {
  const layer = page?.layers.find((entry) => entry.id === action?.layerId);
  const region = layer?.regions.find((entry) => entry.id === action?.regionId);
  return layer && region ? { layer, region } : null;
}

function renderCanvas(state) {
  const canvas = state.root?.querySelector("[data-builder-canvas]");
  const page = activePage(state);
  if (!canvas || !page || !state.baseImage) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (state.previewStep !== null) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index <= state.previewStep; index += 1) {
      const resolved = resolveAction(page, page.timeline[index]);
      const image = resolved ? state.layerImages.get(resolved.layer.id) : null;
      if (image) drawClippedImage(context, image, resolved.region.points, canvas.width, canvas.height);
    }
    return;
  }

  if (!state.image) return;
  context.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  const layer = activeLayer(state);
  for (const region of layer?.regions ?? []) {
    const index = page.timeline.findIndex((action) => action.layerId === layer.id && action.regionId === region.id);
    strokeRegion(context, region.points, canvas.width, canvas.height, COLORS[Math.max(0, index) % COLORS.length], index + 1);
  }
  if (state.draft.length) strokeRegion(context, state.draft, canvas.width, canvas.height, "#ffffff", "+", false);
}

function drawClippedImage(context, image, points, width, height) {
  if (!points?.length) return;
  context.save();
  makePath(context, points, width, height, true);
  context.clip();
  context.drawImage(image, 0, 0, width, height);
  context.restore();
}

function strokeRegion(context, points, width, height, color, label, close = true) {
  if (!points.length) return;
  context.save();
  makePath(context, points, width, height, close);
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, width / 600);
  context.stroke();
  const first = points[0];
  const x = first.x * width;
  const y = first.y * height;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, Math.max(10, width / 80), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#111";
  context.font = `bold ${Math.max(12, width / 70)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(label), x, y);
  context.restore();
}

function makePath(context, points, width, height, close) {
  context.beginPath();
  context.moveTo(points[0].x * width, points[0].y * height);
  for (const point of points.slice(1)) context.lineTo(point.x * width, point.y * height);
  if (close) context.closePath();
}

async function exportProject(state) {
  syncHeaderFields(state);
  const project = normalizeProject(state.project);
  validateProject(project);
  state.exporting = true;
  state.root.classList.add("is-exporting");

  try {
    await ensureDirectoryTree(project.outputFolder);
    const outputPages = [];
    let completed = 0;
    const total = project.pages.reduce((sum, page) => sum + page.timeline.length, 0);

    for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex += 1) {
      const page = project.pages[pageIndex];
      const pageFolder = `${project.outputFolder}/page-${String(pageIndex + 1).padStart(2, "0")}`;
      await ensureDirectoryTree(pageFolder);
      const baseLayer = page.layers.find((layer) => layer.source);
      const baseImage = await loadImage(state, baseLayer.source);
      const layerImages = new Map(await Promise.all(page.layers.filter((layer) => layer.source).map(async (layer) => [layer.id, await loadImage(state, layer.source)])));
      const canvas = document.createElement("canvas");
      canvas.width = baseImage.naturalWidth;
      canvas.height = baseImage.naturalHeight;
      const context = canvas.getContext("2d");
      const states = [];

      for (let regionIndex = 0; regionIndex < page.timeline.length; regionIndex += 1) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (let revealIndex = 0; revealIndex <= regionIndex; revealIndex += 1) {
          const resolved = resolveAction(page, page.timeline[revealIndex]);
          const image = resolved ? layerImages.get(resolved.layer.id) : null;
          if (image) drawClippedImage(context, image, resolved.region.points, canvas.width, canvas.height);
        }
        const blob = await canvasBlob(canvas, "image/webp", 0.92);
        const filename = `${String(regionIndex + 1).padStart(2, "0")}.webp`;
        const path = await uploadFile(pageFolder, new File([blob], filename, { type: "image/webp" }));
        states.push(path);
        completed += 1;
        setStatus(state, game.i18n.format("CR.Builder.ExportProgress", { current: completed, total }));
      }
      outputPages.push({ name: page.name, states });
      outputPages[outputPages.length - 1].sounds = page.timeline.map((action) => action.sound || null);
    }

    const manifest = { ...project, exportedAt: Date.now(), outputs: outputPages };
    const projectBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    await uploadFile(project.outputFolder, new File([projectBlob], PROJECT_FILENAME, { type: "application/json" }));
    state.project = manifest;
    state.dirty = false;
    setStatus(state, game.i18n.localize("CR.Builder.ExportComplete"));
    ui.notifications.info(game.i18n.localize("CR.Builder.ExportComplete"));
    await state.onExport?.({ title: project.title, folder: project.outputFolder, pages: outputPages });
  } finally {
    state.exporting = false;
    state.root.classList.remove("is-exporting");
  }
}

function syncHeaderFields(state) {
  state.project.title = state.root.querySelector("[name='projectTitle']").value.trim();
  state.project.outputFolder = state.root.querySelector("[name='outputFolder']").value.trim().replace(/[\\/]+$/, "");
}

function validateProject(project) {
  if (!project.title) throw new Error(game.i18n.localize("CR.Builder.TitleRequired"));
  if (!project.outputFolder) throw new Error(game.i18n.localize("CR.Builder.OutputRequired"));
  if (!project.pages.length) throw new Error(game.i18n.localize("CR.Builder.PageRequired"));
  if (project.pages.some((page) => !page.layers.some((layer) => layer.source))) throw new Error(game.i18n.localize("CR.Builder.ImageRequired"));
  if (project.pages.some((page) => !page.timeline.length)) throw new Error(game.i18n.localize("CR.Builder.RegionRequired"));
}

function normalizeProject(value) {
  if (value?.format !== "comic-reveal-project") throw new Error(game.i18n.localize("CR.Builder.InvalidProject"));
  const pages = (Array.isArray(value.pages) ? value.pages : []).map((page, pageIndex) => normalizePage(page, pageIndex));
  return {
    format: "comic-reveal-project",
    version: 2,
    title: String(value.title ?? ""),
    outputFolder: String(value.outputFolder ?? ""),
    pages
  };
}

function normalizePage(page, pageIndex) {
  const pageId = String(page.id || makeId(`page-${pageIndex}`));
  let layers;
  let timeline;

  if (Array.isArray(page.layers)) {
    layers = page.layers.map((layer, layerIndex) => normalizeLayer(layer, layerIndex));
    timeline = (Array.isArray(page.timeline) ? page.timeline : []).map((entry) => ({
      layerId: String(entry.layerId ?? ""),
      regionId: String(entry.regionId ?? ""),
      sound: entry.sound ? String(entry.sound) : null
    }));
  } else {
    const legacyLayer = normalizeLayer({
      id: makeId(`layer-${pageIndex}-0`),
      name: "Layer 1",
      source: page.source,
      regions: page.regions
    }, 0);
    layers = [legacyLayer];
    timeline = legacyLayer.regions.map((region, regionIndex) => ({
      layerId: legacyLayer.id,
      regionId: region.id,
      sound: page.sounds?.[regionIndex] ? String(page.sounds[regionIndex]) : null
    }));
  }

  if (!layers.length) layers.push(normalizeLayer({}, 0));
  const validActions = timeline.filter((action) => {
    const layer = layers.find((entry) => entry.id === action.layerId);
    return layer?.regions.some((region) => region.id === action.regionId);
  });
  const knownRegionIds = new Set(validActions.map((action) => `${action.layerId}.${action.regionId}`));
  for (const layer of layers) {
    for (const region of layer.regions) {
      const key = `${layer.id}.${region.id}`;
      if (!knownRegionIds.has(key)) validActions.push({ layerId: layer.id, regionId: region.id, sound: null });
    }
  }

  return {
    id: pageId,
    name: String(page.name || `Page ${pageIndex + 1}`),
    layers,
    timeline: validActions
  };
}

function normalizeLayer(layer, layerIndex) {
  return {
    id: String(layer.id || makeId(`layer-${layerIndex}`)),
    name: String(layer.name || `Layer ${layerIndex + 1}`),
    source: String(layer.source || ""),
    regions: (Array.isArray(layer.regions) ? layer.regions : []).map((region, regionIndex) => ({
      id: String(region.id || makeId(`region-${regionIndex}`)),
      points: (Array.isArray(region.points) ? region.points : []).map((point) => ({
        x: clamp(Number(point.x), 0, 1),
        y: clamp(Number(point.y), 0, 1)
      })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    })).filter((region) => region.points.length >= 3)
  };
}

function makeId(fallback) {
  return globalThis.foundry?.utils?.randomID?.() || fallback;
}

async function ensureDirectoryTree(path) {
  const Picker = getFilePickerClass();
  const segments = path.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await Picker.createDirectory("data", current, { notify: false });
    } catch (creationError) {
      try {
        await Picker.browse("data", current, { notify: false });
      } catch {
        throw creationError;
      }
    }
  }
}

async function uploadFile(folder, file) {
  const result = await getFilePickerClass().upload("data", folder, file, { overwrite: true }, { notify: false });
  const path = typeof result === "string" ? result : result?.path;
  if (!path) throw new Error(game.i18n.localize("CR.Builder.UploadFailed"));
  return path;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(game.i18n.localize("CR.Builder.RenderFailed"))), type, quality);
  });
}

function closeBuilder(state) {
  if (state.dirty && !window.confirm(game.i18n.localize("CR.Builder.CloseConfirm"))) return;
  document.removeEventListener("keydown", onBuilderKeydown, true);
  window.removeEventListener("paste", onBuilderPaste, true);
  state.root.classList.remove("is-open");
  setTimeout(() => state.root.remove(), 160);
  if (builder === state) builder = null;
}

async function onBuilderPaste(event) {
  const state = builder;
  if (!state?.root?.isConnected || state.exporting) return;
  if (event.target?.closest?.(".comic-reveal-file-picker")) return;
  const imageFile = clipboardImage(event.clipboardData);
  if (!imageFile) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  syncHeaderFields(state);
  if (!state.project.outputFolder) {
    ui.notifications.warn(game.i18n.localize("CR.Builder.OutputRequiredForPaste"));
    return;
  }
  const layer = activeLayer(state);
  if (!layer) {
    ui.notifications.warn(game.i18n.localize("CR.Builder.LayerRequiredForPaste"));
    return;
  }
  if (layer.source && !window.confirm(game.i18n.localize("CR.Builder.ReplaceLayerConfirm"))) return;

  state.exporting = true;
  state.root.classList.add("is-exporting");
  setStatus(state, game.i18n.localize("CR.Builder.Pasting"));
  try {
    const sourceFolder = `${state.project.outputFolder}/sources`;
    await ensureDirectoryTree(sourceFolder);
    const webp = await convertClipboardImageToWebp(imageFile);
    const filename = `source-${Date.now()}-${foundry.utils.randomID()}.webp`;
    const path = await uploadFile(sourceFolder, new File([webp], filename, { type: "image/webp" }));
    await assignLayerImage(state, layer, path, { confirmReplace: false });
    setStatus(state, game.i18n.localize("CR.Builder.PasteComplete"));
    ui.notifications.info(game.i18n.localize("CR.Builder.PasteComplete"));
  } catch (error) {
    console.error(`${MODULE_ID} | Could not paste builder image`, error);
    setStatus(state, error?.message || game.i18n.localize("CR.Builder.PasteFailed"), true);
    ui.notifications.error(error?.message || game.i18n.localize("CR.Builder.PasteFailed"));
  } finally {
    state.exporting = false;
    state.root.classList.remove("is-exporting");
  }
}

function clipboardImage(clipboardData) {
  if (!clipboardData) return null;
  for (const item of clipboardData.items ?? []) {
    if (!item.type?.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  for (const file of clipboardData.files ?? []) {
    if (file.type?.startsWith("image/")) return file;
  }
  return null;
}

async function convertClipboardImageToWebp(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(game.i18n.localize("CR.Builder.PasteDecodeFailed")));
      element.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return await canvasBlob(canvas, "image/webp", 0.95);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function onBuilderKeydown(event) {
  const state = builder;
  if (!state?.root?.isConnected) return;
  if (event.key === "Enter" && state.tool === "polygon" && state.draft.length >= 3) {
    event.preventDefault();
    finishDraft(state);
  } else if (event.key === "Escape" && state.draft.length) {
    event.preventDefault();
    state.draft = [];
    state.drawing = false;
    refreshBuilder(state);
  }
}

function canvasPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function simplifyPoints(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const result = [points[0]];
  for (const point of points.slice(1)) {
    if (distance(last(result), point) >= 0.002) result.push(point);
  }
  if (result.length > 3 && distance(result[0], last(result)) < 0.004) result.pop();
  return result;
}

function setStatus(state, message, error = false) {
  const status = state.root.querySelector("[data-builder-status]");
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function reportBuilderError(state, error) {
  console.error(`${MODULE_ID} | Builder`, error);
  const message = error?.message || game.i18n.localize("CR.Errors.Unknown");
  setStatus(state, message, true);
  ui.notifications.error(message);
}

function withCacheBuster(path) {
  return `${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

function fileName(path) {
  const value = String(path || "").split("?")[0].replaceAll("\\", "/").split("/").at(-1) || path;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getFilePickerClass() {
  return foundry.applications.apps.FilePicker.implementation;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function last(values) {
  return values[values.length - 1];
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function text(key) {
  return escapeHtml(game.i18n.localize(key));
}

function attr(key) {
  return escapeHtml(game.i18n.localize(key));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const projectFileName = PROJECT_FILENAME;
export { normalizeProject, reorderLayers, simplifyPoints };
