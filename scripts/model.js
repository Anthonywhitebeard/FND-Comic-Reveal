export const EMPTY_PRESENTATION = Object.freeze({
  open: false,
  comicId: null,
  pageIndex: 0,
  stepIndex: -1,
  revision: 0
});

export function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

export function normalizeLibrary(value) {
  const comics = Array.isArray(value?.comics) ? value.comics : [];
  return {
    version: 1,
    comics: comics.map(normalizeComic).filter(Boolean)
  };
}

export function normalizeComic(value) {
  if (!value || typeof value !== "object") return null;

  const pages = (Array.isArray(value.pages) ? value.pages : [])
    .map((page, index) => normalizePage(page, index))
    .filter((page) => page.states.length > 0);

  if (!value.id || !pages.length) return null;

  return {
    id: String(value.id),
    title: String(value.title || "Comic"),
    folder: String(value.folder || ""),
    pages
  };
}

function normalizePage(value, index) {
  const sounds = Array.isArray(value?.sounds) ? value.sounds : [];
  const transitions = Array.isArray(value?.transitions) ? value.transitions : [];
  const overlays = Array.isArray(value?.overlays) ? value.overlays : [];
  const durations = Array.isArray(value?.durations) ? value.durations : [];
  const overlayRects = Array.isArray(value?.overlayRects) ? value.overlayRects : [];
  const entries = (Array.isArray(value?.states) ? value.states : [])
    .map((state, stateIndex) => ({
      state: String(state),
      sound: sounds[stateIndex] ? String(sounds[stateIndex]) : null,
      transition: normalizeTransition(transitions[stateIndex]),
      overlay: overlays[stateIndex] ? String(overlays[stateIndex]) : null,
      duration: normalizeDuration(durations[stateIndex]),
      overlayRect: normalizeRect(overlayRects[stateIndex])
    }))
    .filter((entry) => entry.state)
    .sort((left, right) => naturalCompare(left.state, right.state));

  return {
    name: String(value?.name || `Page ${index + 1}`),
    states: entries.map((entry) => entry.state),
    sounds: entries.map((entry) => entry.sound),
    transitions: entries.map((entry) => entry.transition),
    overlays: entries.map((entry) => entry.overlay),
    durations: entries.map((entry) => entry.duration),
    overlayRects: entries.map((entry) => entry.overlayRect)
  };
}

export function normalizePresentation(value) {
  return {
    open: Boolean(value?.open),
    comicId: value?.comicId ? String(value.comicId) : null,
    pageIndex: toInteger(value?.pageIndex, 0),
    stepIndex: toInteger(value?.stepIndex, -1),
    revision: Number.isFinite(Number(value?.revision)) ? Number(value.revision) : 0
  };
}

export function startPresentation(comic, revision = 0) {
  if (!comic?.pages?.length) return { ...EMPTY_PRESENTATION, revision };
  return {
    open: true,
    comicId: comic.id,
    pageIndex: 0,
    stepIndex: -1,
    revision
  };
}

export function advancePresentation(state, comic, { blankBetweenPages = true, revision = 0 } = {}) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length) return { ...EMPTY_PRESENTATION, revision };

  const pageIndex = clamp(current.pageIndex, 0, comic.pages.length - 1);
  const page = comic.pages[pageIndex];
  if (current.stepIndex < page.states.length - 1) {
    return { ...current, pageIndex, stepIndex: current.stepIndex + 1, revision };
  }

  if (pageIndex < comic.pages.length - 1) {
    return {
      ...current,
      pageIndex: pageIndex + 1,
      stepIndex: blankBetweenPages ? -1 : 0,
      revision
    };
  }

  return { ...EMPTY_PRESENTATION, revision };
}

export function retreatPresentation(state, comic, revision = 0) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length) return { ...EMPTY_PRESENTATION, revision };

  const pageIndex = clamp(current.pageIndex, 0, comic.pages.length - 1);
  if (current.stepIndex >= 0) {
    return { ...current, pageIndex, stepIndex: current.stepIndex - 1, revision };
  }

  if (pageIndex > 0) {
    const previousPage = comic.pages[pageIndex - 1];
    return {
      ...current,
      pageIndex: pageIndex - 1,
      stepIndex: previousPage.states.length - 1,
      revision
    };
  }

  return { ...current, pageIndex: 0, stepIndex: -1, revision };
}

export function getCurrentImage(state, comic) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return null;
  return comic.pages[current.pageIndex]?.states?.[current.stepIndex] ?? null;
}

export function getCurrentSound(state, comic) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return null;
  return comic.pages[current.pageIndex]?.sounds?.[current.stepIndex] ?? null;
}

export function getCurrentTransition(state, comic) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return "instant";
  return normalizeTransition(comic.pages[current.pageIndex]?.transitions?.[current.stepIndex]);
}

export function getCurrentOverlay(state, comic) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return null;
  return comic.pages[current.pageIndex]?.overlays?.[current.stepIndex] ?? null;
}

export function getCurrentDuration(state, comic, fallback = 600) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return clampDuration(fallback);
  return comic.pages[current.pageIndex]?.durations?.[current.stepIndex] ?? clampDuration(fallback);
}

export function getCurrentOverlayRect(state, comic) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length || current.stepIndex < 0) return normalizeRect(null);
  return normalizeRect(comic.pages[current.pageIndex]?.overlayRects?.[current.stepIndex]);
}

export function getUpcomingImages(state, comic, count = 2) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length) return [];

  const images = [];
  let pageIndex = current.pageIndex;
  let stepIndex = current.stepIndex + 1;

  while (pageIndex < comic.pages.length && images.length < count) {
    const page = comic.pages[pageIndex];
    while (stepIndex < page.states.length && images.length < count) {
      if (stepIndex >= 0) images.push(page.states[stepIndex]);
      stepIndex += 1;
    }
    pageIndex += 1;
    stepIndex = 0;
  }

  return images;
}

export function getUpcomingOverlays(state, comic, count = 2) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length) return [];

  const overlays = [];
  let pageIndex = current.pageIndex;
  let stepIndex = current.stepIndex + 1;
  while (pageIndex < comic.pages.length && overlays.length < count) {
    const page = comic.pages[pageIndex];
    while (stepIndex < page.states.length && overlays.length < count) {
      const overlay = page.overlays?.[stepIndex];
      if (overlay) overlays.push(overlay);
      stepIndex += 1;
    }
    pageIndex += 1;
    stepIndex = 0;
  }
  return overlays;
}

export function getUpcomingSounds(state, comic, count = 2) {
  const current = normalizePresentation(state);
  if (!current.open || !comic?.pages?.length) return [];

  const sounds = [];
  let pageIndex = current.pageIndex;
  let stepIndex = current.stepIndex + 1;
  while (pageIndex < comic.pages.length && sounds.length < count) {
    const page = comic.pages[pageIndex];
    while (stepIndex < page.states.length && sounds.length < count) {
      const sound = page.sounds?.[stepIndex];
      if (sound) sounds.push(sound);
      stepIndex += 1;
    }
    pageIndex += 1;
    stepIndex = 0;
  }
  return sounds;
}

export function presentationLabel(state, comic) {
  const current = normalizePresentation(state);
  const page = comic?.pages?.[current.pageIndex];
  if (!page) return "";
  const shown = Math.max(0, current.stepIndex + 1);
  return `${current.pageIndex + 1}/${comic.pages.length} · ${shown}/${page.states.length}`;
}

function toInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeTransition(value) {
  const transitions = new Set(["instant", "fade", "blur", "dark", "slide-left", "slide-right", "slide-top", "slide-bottom", "zoom-in", "zoom-out", "reveal-ltr", "reveal-rtl", "reveal-ttb", "reveal-btt"]);
  return transitions.has(value) ? value : "instant";
}

function normalizeDuration(value) {
  if (!Number.isFinite(Number(value))) return null;
  return clampDuration(value);
}

function clampDuration(value) {
  return Math.round(clamp(Number(value) || 0, 0, 5000) / 100) * 100;
}

function normalizeRect(value) {
  const x = clamp(Number(value?.x) || 0, 0, 1);
  const y = clamp(Number(value?.y) || 0, 0, 1);
  return {
    x,
    y,
    width: clamp(Number(value?.width) || 1, 0, 1 - x),
    height: clamp(Number(value?.height) || 1, 0, 1 - y)
  };
}
