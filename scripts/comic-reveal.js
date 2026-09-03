import {
  EMPTY_PRESENTATION,
  advancePresentation,
  getCurrentImage,
  getCurrentDuration,
  getCurrentOverlay,
  getCurrentSound,
  getCurrentTransition,
  getUpcomingImages,
  getUpcomingOverlays,
  getUpcomingSounds,
  naturalCompare,
  normalizeLibrary,
  normalizePresentation,
  presentationLabel,
  retreatPresentation,
  startPresentation
} from "./model.js";
import { openComicBuilder, projectFileName } from "./comic-builder.js";

const MODULE_ID = "comic-reveal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const LIBRARY_SETTING = "library";
const PRESENTATION_SETTING = "presentation";
const IMAGE_EXTENSIONS = [".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"];

let managerDialog = null;
let currentState = { ...EMPTY_PRESENTATION };
let stateMutationPending = false;
let renderSequence = 0;
let lastSoundRevision = 0;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, LIBRARY_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { version: 1, comics: [] }
  });

  game.settings.register(MODULE_ID, PRESENTATION_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { ...EMPTY_PRESENTATION }
  });

  game.settings.register(MODULE_ID, "blankBetweenPages", {
    name: "CR.Settings.BlankBetweenPages.Name",
    hint: "CR.Settings.BlankBetweenPages.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "imageFit", {
    name: "CR.Settings.ImageFit.Name",
    hint: "CR.Settings.ImageFit.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      contain: "CR.Settings.ImageFit.Contain",
      cover: "CR.Settings.ImageFit.Cover"
    },
    default: "contain"
  });

  game.settings.register(MODULE_ID, "effectVolume", {
    name: "CR.Settings.EffectVolume.Name",
    hint: "CR.Settings.EffectVolume.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });

  game.settings.register(MODULE_ID, "transitionDuration", {
    name: "CR.Settings.TransitionDuration.Name",
    hint: "CR.Settings.TransitionDuration.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 2000, step: 100 },
    default: 600
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET_NAME, onSocketMessage);
  applyPresentation(game.settings.get(MODULE_ID, PRESENTATION_SETTING), { playSound: false });
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tokenTools = controls?.tokens?.tools;
  if (!tokenTools) return;

  tokenTools.comicReveal = {
    name: "comicReveal",
    title: "CR.Controls.Open",
    icon: "fa-solid fa-book-open",
    order: Object.keys(tokenTools).length,
    button: true,
    visible: true,
    onChange: () => openManager()
  };
});

Hooks.on("updateSetting", (setting) => {
  if (setting?.key !== `${MODULE_ID}.${PRESENTATION_SETTING}`) return;
  applyPresentation(setting.value);
});

function getLibrary() {
  return normalizeLibrary(game.settings.get(MODULE_ID, LIBRARY_SETTING));
}

function getComic(comicId) {
  return getLibrary().comics.find((comic) => comic.id === comicId) ?? null;
}

function openManager() {
  if (!game.user.isGM) return;
  if (managerDialog?.rendered) {
    managerDialog.bringToTop?.();
    return;
  }

  managerDialog = new Dialog({
    title: game.i18n.localize("CR.Manager.Title"),
    content: buildManagerMarkup(),
    buttons: {
      close: { label: game.i18n.localize("CR.Common.Close") }
    },
    render: (html) => bindManager(normalizeElement(html)),
    close: () => {
      managerDialog = null;
    }
  }, { width: 760, height: "auto", classes: ["comic-reveal-manager"] });

  managerDialog.render(true);
}

function buildManagerMarkup() {
  const library = getLibrary();
  const active = normalizePresentation(game.settings.get(MODULE_ID, PRESENTATION_SETTING));
  const cards = library.comics.length
    ? library.comics.map((comic) => buildComicCard(comic, active)).join("")
    : `<p class="cr-empty-library">${escapeHtml(game.i18n.localize("CR.Manager.Empty"))}</p>`;

  return `
    <section class="cr-manager" data-cr-manager>
      <div class="cr-import-row">
        <label>
          <span>${escapeHtml(game.i18n.localize("CR.Manager.Name"))}</span>
          <input type="text" name="comicTitle" placeholder="${escapeAttribute(game.i18n.localize("CR.Manager.NamePlaceholder"))}">
        </label>
        <label class="cr-folder-field">
          <span>${escapeHtml(game.i18n.localize("CR.Manager.Folder"))}</span>
          <span class="cr-folder-input">
            <input type="text" name="comicFolder" placeholder="comics/my-comic">
            <button type="button" data-cr-action="browse" title="${escapeAttribute(game.i18n.localize("CR.Manager.Browse"))}">
              <i class="fa-solid fa-folder-open"></i>
            </button>
          </span>
        </label>
        <button type="button" class="cr-primary" data-cr-action="add">
          <i class="fa-solid fa-plus"></i> ${escapeHtml(game.i18n.localize("CR.Manager.Add"))}
        </button>
      </div>
      <button type="button" class="cr-builder-launch" data-cr-action="builder">
        <i class="fa-solid fa-pen-ruler"></i> ${escapeHtml(game.i18n.localize("CR.Manager.Builder"))}
      </button>
      <p class="cr-import-hint">${escapeHtml(game.i18n.localize("CR.Manager.FolderHint"))}</p>
      <h3 class="cr-library-title"><i class="fa-solid fa-book-open"></i> ${escapeHtml(game.i18n.localize("CR.Manager.Library"))}</h3>
      <div class="cr-library">${cards}</div>
    </section>
  `;
}

function buildComicCard(comic, active) {
  const stateCount = comic.pages.reduce((total, page) => total + page.states.length, 0);
  const isActive = active.open && active.comicId === comic.id;
  return `
    <article class="cr-comic-card ${isActive ? "is-active" : ""}" data-comic-id="${escapeAttribute(comic.id)}">
      <div class="cr-card-copy">
        <input class="cr-title-input" type="text" value="${escapeAttribute(comic.title)}" aria-label="${escapeAttribute(game.i18n.localize("CR.Manager.Name"))}">
        <div class="cr-card-meta">${escapeHtml(game.i18n.format("CR.Manager.Stats", {
          pages: comic.pages.length,
          states: stateCount
        }))}</div>
        <div class="cr-card-folder">${escapeHtml(comic.folder)}</div>
      </div>
      <div class="cr-card-actions">
        <button type="button" data-cr-action="start" class="cr-primary" title="${escapeAttribute(game.i18n.localize("CR.Manager.Start"))}">
          <i class="fa-solid fa-play"></i> <span>${escapeHtml(game.i18n.localize("CR.Manager.Show"))}</span>
        </button>
        <button type="button" data-cr-action="edit" title="${escapeAttribute(game.i18n.localize("CR.Manager.Edit"))}">
          <i class="fa-solid fa-pen-ruler"></i> <span>${escapeHtml(game.i18n.localize("CR.Manager.Edit"))}</span>
        </button>
        <button type="button" data-cr-action="save-name" title="${escapeAttribute(game.i18n.localize("CR.Manager.SaveName"))}">
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
        <button type="button" data-cr-action="refresh" title="${escapeAttribute(game.i18n.localize("CR.Manager.Refresh"))}">
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button type="button" data-cr-action="delete" title="${escapeAttribute(game.i18n.localize("CR.Manager.Delete"))}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </article>
  `;
}

function bindManager(root) {
  if (!root) return;
  root.querySelector("[data-cr-manager]")?.addEventListener("click", onManagerClick);
}

async function onManagerClick(event) {
  const button = event.target.closest?.("[data-cr-action]");
  if (!button) return;
  event.preventDefault();

  const action = button.dataset.crAction;
  const manager = button.closest("[data-cr-manager]");
  const card = button.closest("[data-comic-id]");
  const comicId = card?.dataset.comicId;

  if (action === "browse") {
    openFolderPicker(manager?.querySelector("[name='comicFolder']"));
    return;
  }

  if (action === "builder") {
    openComicBuilder({ onExport: registerBuilderExport });
    return;
  }

  button.disabled = true;
  try {
    if (action === "add") await addComic(manager);
    if (action === "start") await beginComic(comicId);
    if (action === "edit") await editComic(comicId);
    if (action === "save-name") await saveComicName(comicId, card?.querySelector(".cr-title-input")?.value);
    if (action === "refresh") await refreshComic(comicId);
    if (action === "delete") await deleteComic(comicId);
  } catch (error) {
    console.error(`${MODULE_ID} |`, error);
    ui.notifications.error(error?.message || game.i18n.localize("CR.Errors.Unknown"));
  } finally {
    button.disabled = false;
  }
}

function openFolderPicker(input) {
  if (!input) return;
  const Picker = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
  new Picker({
    type: "folder",
    current: input.value,
    callback: (path) => {
      input.value = path;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }).render({ force: true });
}

async function addComic(manager) {
  const folder = String(manager?.querySelector("[name='comicFolder']")?.value ?? "").trim();
  const title = String(manager?.querySelector("[name='comicTitle']")?.value ?? "").trim();
  if (!folder) throw new Error(game.i18n.localize("CR.Errors.FolderRequired"));

  const comic = await scanComicFolder(folder, title, foundry.utils.randomID());
  const library = getLibrary();
  library.comics.push(comic);
  await game.settings.set(MODULE_ID, LIBRARY_SETTING, library);
  ui.notifications.info(game.i18n.format("CR.Notifications.Added", { title: comic.title }));
  reopenManager();
}

async function refreshComic(comicId) {
  const library = getLibrary();
  const index = library.comics.findIndex((comic) => comic.id === comicId);
  if (index < 0) return;
  const current = library.comics[index];
  library.comics[index] = await scanComicFolder(current.folder, current.title, current.id);
  await game.settings.set(MODULE_ID, LIBRARY_SETTING, library);
  ui.notifications.info(game.i18n.format("CR.Notifications.Refreshed", { title: current.title }));
  reopenManager();
}

async function saveComicName(comicId, titleValue) {
  const title = String(titleValue ?? "").trim();
  if (!title) return;
  const library = getLibrary();
  const comic = library.comics.find((entry) => entry.id === comicId);
  if (!comic) return;
  comic.title = title;
  await game.settings.set(MODULE_ID, LIBRARY_SETTING, library);
  ui.notifications.info(game.i18n.localize("CR.Notifications.NameSaved"));
  reopenManager();
}

async function deleteComic(comicId) {
  const library = getLibrary();
  const comic = library.comics.find((entry) => entry.id === comicId);
  if (!comic) return;
  if (!window.confirm(game.i18n.format("CR.Manager.DeleteConfirm", { title: comic.title }))) return;

  if (currentState.open && currentState.comicId === comicId) await closePresentation();
  library.comics = library.comics.filter((entry) => entry.id !== comicId);
  await game.settings.set(MODULE_ID, LIBRARY_SETTING, library);
  reopenManager();
}

async function scanComicFolder(folder, title, id) {
  const Picker = foundry.applications.apps.FilePicker;
  const root = await Picker.browse("data", folder);
  const projectPath = (root.files ?? []).find((path) => path.endsWith(`/${projectFileName}`) || path === projectFileName);
  if (projectPath) {
    try {
      const response = await fetch(`${projectPath}${projectPath.includes("?") ? "&" : "?"}v=${Date.now()}`);
      const project = await response.json();
      if (project?.format === "comic-reveal-project" && Array.isArray(project.outputs)) {
        const pages = project.outputs
          .map((page, index) => ({
            name: String(page?.name || `Page ${index + 1}`),
            states: imageFiles(page?.states),
            sounds: Array.isArray(page?.sounds) ? page.sounds.map((sound) => sound || null) : [],
            transitions: Array.isArray(page?.transitions) ? page.transitions : [],
            overlays: imageFiles(page?.overlays),
            durations: Array.isArray(page?.durations) ? page.durations : []
          }))
          .filter((page) => page.states.length);
        if (pages.length) return { id, title: title || project.title, folder, pages };
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not read builder project`, error);
    }
  }
  const pages = [];
  const rootImages = imageFiles(root.files);

  if (rootImages.length) {
    pages.push({ name: folderName(folder), states: rootImages });
  }

  for (const directory of [...(root.dirs ?? [])].sort(naturalCompare)) {
    const result = await Picker.browse("data", directory, { extensions: IMAGE_EXTENSIONS });
    const states = imageFiles(result.files);
    if (states.length) pages.push({ name: folderName(directory), states });
  }

  if (!pages.length) throw new Error(game.i18n.localize("CR.Errors.NoImages"));
  return { id, title: title || folderName(folder), folder, pages };
}

async function registerBuilderExport({ title, folder, pages }) {
  const library = getLibrary();
  const existing = library.comics.find((comic) => comic.folder === folder);
  if (existing) {
    existing.title = title;
    existing.pages = pages;
  } else {
    library.comics.push({ id: foundry.utils.randomID(), title, folder, pages });
  }
  await game.settings.set(MODULE_ID, LIBRARY_SETTING, library);
  ui.notifications.info(game.i18n.format("CR.Notifications.Added", { title }));
  if (managerDialog?.rendered) reopenManager();
}

async function editComic(comicId) {
  const comic = getComic(comicId);
  if (!comic) return;
  const folder = comic.folder.replace(/[\\/]+$/, "");
  const result = await foundry.applications.apps.FilePicker.browse("data", folder);
  const projectPath = (result.files ?? []).find((path) => path.endsWith(`/${projectFileName}`) || path === projectFileName);
  if (projectPath) {
    openComicBuilder({ onExport: registerBuilderExport, projectPath });
    return;
  }
  openComicBuilder({ onExport: registerBuilderExport, initialProject: projectFromImageSequence(comic) });
}

function projectFromImageSequence(comic) {
  return {
    format: "comic-reveal-project",
    version: 2,
    title: comic.title,
    outputFolder: comic.folder,
    pages: comic.pages.map((page, pageIndex) => {
      const layers = page.states.map((source, stateIndex) => {
        const layerId = foundry.utils.randomID();
        const regionId = foundry.utils.randomID();
        return {
          id: layerId,
          name: game.i18n.format("CR.Builder.ImportedLayerName", { number: stateIndex + 1 }),
          source,
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
          regions: [{
            id: regionId,
            points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
          }]
        };
      });
      return {
        id: foundry.utils.randomID(),
        name: page.name || game.i18n.format("CR.Builder.PageName", { number: pageIndex + 1 }),
        layers,
        timeline: layers.map((layer, stateIndex) => ({
          layerId: layer.id,
          regionId: layer.regions[0].id,
          sound: page.sounds?.[stateIndex] ?? null,
          transition: page.transitions?.[stateIndex] ?? "instant",
          duration: page.durations?.[stateIndex] ?? 600
        }))
      };
    })
  };
}

function imageFiles(files) {
  return [...(files ?? [])]
    .filter((path) => IMAGE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension)))
    .sort(naturalCompare);
}

function folderName(path) {
  return String(path || "Comic").replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "Comic";
}

async function beginComic(comicId) {
  const comic = getComic(comicId);
  if (!comic) return;
  await publishPresentation(startPresentation(comic, nextRevision()));
}

async function nextPresentation() {
  if (!game.user.isGM || stateMutationPending) return;
  const comic = getComic(currentState.comicId);
  if (!comic) return closePresentation();
  const blankBetweenPages = game.settings.get(MODULE_ID, "blankBetweenPages");
  await publishPresentation(advancePresentation(currentState, comic, {
    blankBetweenPages,
    revision: nextRevision()
  }));
}

async function previousPresentation() {
  if (!game.user.isGM || stateMutationPending) return;
  const comic = getComic(currentState.comicId);
  if (!comic) return;
  await publishPresentation(retreatPresentation(currentState, comic, nextRevision()));
}

async function closePresentation() {
  if (!game.user.isGM || stateMutationPending) return;
  await publishPresentation({ ...EMPTY_PRESENTATION, revision: nextRevision() });
}

async function publishPresentation(value) {
  stateMutationPending = true;
  const state = normalizePresentation(value);
  try {
    await game.settings.set(MODULE_ID, PRESENTATION_SETTING, state);
    game.socket.emit(SOCKET_NAME, {
      type: "presentation",
      senderId: game.user.id,
      state
    });
    applyPresentation(state);
  } finally {
    stateMutationPending = false;
  }
}

function onSocketMessage(message) {
  if (message?.type !== "presentation") return;
  const sender = game.users.get(message.senderId);
  if (!sender?.isGM) return;
  applyPresentation(message.state);
}

function applyPresentation(value, { playSound = true } = {}) {
  const incoming = normalizePresentation(value);
  if (incoming.revision < currentState.revision) return;
  const previous = currentState;
  const changedStep = incoming.open && incoming.stepIndex >= 0 && (
    !previous.open ||
    incoming.comicId !== previous.comicId ||
    incoming.pageIndex !== previous.pageIndex ||
    incoming.stepIndex !== previous.stepIndex
  );
  const shouldPlaySound = playSound && changedStep && incoming.revision > lastSoundRevision;
  currentState = incoming;
  lastSoundRevision = Math.max(lastSoundRevision, incoming.revision);

  if (!incoming.open) {
    removeOverlay();
    return;
  }

  const comic = getComic(incoming.comicId);
  if (!comic) {
    removeOverlay();
    return;
  }

  const overlay = ensureOverlay();
  overlay.classList.toggle("is-gm", game.user.isGM);
  overlay.classList.toggle("is-cover", game.settings.get(MODULE_ID, "imageFit") === "cover");
  const transitionDuration = getCurrentDuration(incoming, comic, game.settings.get(MODULE_ID, "transitionDuration"));
  overlay.style.setProperty("--cr-transition-duration", `${transitionDuration}ms`);
  for (const title of overlay.querySelectorAll("[data-cr-title]")) title.textContent = comic.title;
  overlay.querySelector("[data-cr-progress]").textContent = presentationLabel(incoming, comic);
  renderPresentationImage(
    overlay,
    getCurrentImage(incoming, comic),
    getCurrentOverlay(incoming, comic),
    getCurrentTransition(incoming, comic),
    incoming.revision,
    transitionDuration
  );
  preloadImages(getUpcomingImages(incoming, comic));
  preloadImages(getUpcomingOverlays(incoming, comic));
  preloadSounds(getUpcomingSounds(incoming, comic));
  if (shouldPlaySound) playFrameSound(getCurrentSound(incoming, comic));
}

function playFrameSound(src) {
  if (!src) return;
  foundry.audio.AudioHelper.play({
    src,
    volume: Number(game.settings.get(MODULE_ID, "effectVolume")),
    loop: false,
    autoplay: true,
    channel: "interface"
  }, false);
}

function preloadSounds(paths) {
  for (const path of paths) {
    foundry.audio.AudioHelper.preloadSound(path).catch(() => {});
  }
}

function ensureOverlay() {
  let overlay = document.getElementById("comic-reveal-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("section");
  overlay.id = "comic-reveal-overlay";
  overlay.className = "comic-reveal-overlay";
  overlay.innerHTML = `
    <div class="cr-stage" data-cr-stage></div>
    <div class="cr-player-title" data-cr-title></div>
    <div class="cr-gm-toolbar">
      <span class="cr-toolbar-title" data-cr-title></span>
      <span class="cr-progress" data-cr-progress></span>
      <button type="button" data-cr-control="choose" title="${escapeAttribute(game.i18n.localize("CR.Viewer.Choose"))}"><i class="fa-solid fa-list"></i></button>
      <button type="button" data-cr-control="previous" title="${escapeAttribute(game.i18n.localize("CR.Viewer.Previous"))}"><i class="fa-solid fa-backward-step"></i></button>
      <button type="button" data-cr-control="next" title="${escapeAttribute(game.i18n.localize("CR.Viewer.Next"))}"><i class="fa-solid fa-forward-step"></i></button>
      <button type="button" data-cr-control="close" title="${escapeAttribute(game.i18n.localize("CR.Viewer.End"))}"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `;

  overlay.querySelector("[data-cr-stage]").addEventListener("click", () => nextPresentation());
  overlay.querySelector("[data-cr-control='choose']").addEventListener("click", async (event) => {
    event.stopPropagation();
    await closePresentation();
    setTimeout(openManager, 200);
  });
  overlay.querySelector("[data-cr-control='previous']").addEventListener("click", (event) => {
    event.stopPropagation();
    previousPresentation();
  });
  overlay.querySelector("[data-cr-control='next']").addEventListener("click", (event) => {
    event.stopPropagation();
    nextPresentation();
  });
  overlay.querySelector("[data-cr-control='close']").addEventListener("click", (event) => {
    event.stopPropagation();
    closePresentation();
  });

  document.body.appendChild(overlay);
  document.addEventListener("keydown", onViewerKeydown, true);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  return overlay;
}

async function renderPresentationImage(overlay, path, overlayPath, transition, revision, duration) {
  const sequence = ++renderSequence;
  const stage = overlay.querySelector("[data-cr-stage]");
  if (!path) {
    stage.replaceChildren();
    return;
  }

  const current = stage.querySelector("[data-cr-current]");
  if (current?.getAttribute("src") === path) return;

  const next = await loadPresentationImage(path);
  const effect = transition === "instant" || duration === 0 ? null : await loadPresentationImage(overlayPath || path);

  if (sequence !== renderSequence || revision !== currentState.revision) return;
  for (const stale of stage.querySelectorAll(".cr-image:not([data-cr-current])")) stale.remove();
  next.className = "cr-image";
  next.alt = "";

  if (transition === "instant" || duration === 0) {
    current?.remove();
    next.dataset.crCurrent = "";
    stage.appendChild(next);
    return;
  }

  effect.className = `cr-image cr-transition-${transition}`;
  effect.alt = "";
  stage.appendChild(effect);
  requestAnimationFrame(() => requestAnimationFrame(() => effect.classList.add("is-active")));
  setTimeout(() => {
    if (sequence !== renderSequence || revision !== currentState.revision || !effect.isConnected) return;
    current?.remove();
    effect.remove();
    next.dataset.crCurrent = "";
    stage.appendChild(next);
  }, duration);
}

async function loadPresentationImage(path) {
  const image = new Image();
  image.src = path;
  try {
    await image.decode();
  } catch {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }
  }
  return image;
}

function preloadImages(paths) {
  for (const path of paths) {
    const image = new Image();
    image.src = path;
  }
}

function onViewerKeydown(event) {
  if (!game.user.isGM || !currentState.open) return;
  if (["ArrowRight", " ", "Enter"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    nextPresentation();
  }
  if (["ArrowLeft", "Backspace"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    previousPresentation();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePresentation();
  }
}

function removeOverlay() {
  renderSequence += 1;
  const overlay = document.getElementById("comic-reveal-overlay");
  if (!overlay) return;
  document.removeEventListener("keydown", onViewerKeydown, true);
  overlay.classList.remove("is-open");
  setTimeout(() => {
    if (!currentState.open && document.getElementById("comic-reveal-overlay") === overlay) overlay.remove();
  }, 180);
}

function reopenManager() {
  const dialog = managerDialog;
  managerDialog = null;
  Promise.resolve(dialog?.close()).finally(() => setTimeout(openManager, 0));
}

function nextRevision() {
  return Math.max(Date.now(), Number(currentState.revision) + 1);
}

function normalizeElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  if (value?.element instanceof HTMLElement) return value.element;
  if (value?.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
