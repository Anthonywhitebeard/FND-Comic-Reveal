import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advancePresentation,
  getActiveAudioTracks,
  getCurrentDuration,
  getCurrentImage,
  getCurrentOverlay,
  getCurrentOverlayRect,
  getCurrentSound,
  getCurrentTransition,
  getUpcomingSounds,
  getUpcomingOverlays,
  getUpcomingImages,
  naturalCompare,
  normalizeLibrary,
  retreatPresentation,
  startPresentation
} from "../scripts/model.js";
import { assignAudioLanes, encodeWavSegment, localizeGeneratedName, normalizeProject, reorderLayers, simplifyPoints } from "../scripts/comic-builder.js";

const comic = {
  id: "comic-1",
  title: "Test",
  folder: "comics/test",
  pages: [
    { name: "Page 1", states: ["01.webp", "02.webp"] },
    { name: "Page 2", states: ["03.webp"] }
  ]
};

test("starts on a black screen and reveals states in order", () => {
  let state = startPresentation(comic, 1);
  assert.equal(getCurrentImage(state, comic), null);

  state = advancePresentation(state, comic, { revision: 2 });
  assert.equal(getCurrentImage(state, comic), "01.webp");

  state = advancePresentation(state, comic, { revision: 3 });
  assert.equal(getCurrentImage(state, comic), "02.webp");
});

test("inserts a black screen between pages and closes after the final state", () => {
  let state = { ...startPresentation(comic), pageIndex: 0, stepIndex: 1 };
  state = advancePresentation(state, comic, { blankBetweenPages: true, revision: 1 });
  assert.deepEqual([state.pageIndex, state.stepIndex, state.open], [1, -1, true]);

  state = advancePresentation(state, comic, { blankBetweenPages: true, revision: 2 });
  assert.equal(getCurrentImage(state, comic), "03.webp");

  state = advancePresentation(state, comic, { blankBetweenPages: true, revision: 3 });
  assert.equal(state.open, false);
});

test("can move backward across a page boundary", () => {
  const state = retreatPresentation({
    open: true,
    comicId: comic.id,
    pageIndex: 1,
    stepIndex: -1,
    revision: 2
  }, comic, 3);
  assert.deepEqual([state.pageIndex, state.stepIndex], [0, 1]);
});

test("preload list crosses page boundaries", () => {
  const state = { ...startPresentation(comic), stepIndex: 0 };
  assert.deepEqual(getUpcomingImages(state, comic, 2), ["02.webp", "03.webp"]);
});

test("library normalization rejects empty comics and sorts state names naturally", () => {
  const library = normalizeLibrary({ comics: [
    { id: "empty", pages: [] },
    { id: "ok", title: "OK", pages: [{ states: ["10.webp", "2.webp", "1.webp"] }] }
  ] });
  assert.equal(library.comics.length, 1);
  assert.deepEqual(library.comics[0].pages[0].states, ["1.webp", "2.webp", "10.webp"]);
  assert.ok(naturalCompare("2", "10") < 0);
});

test("constructor project normalization preserves independent page layouts", () => {
  const project = normalizeProject({
    format: "comic-reveal-project",
    title: "Built comic",
    outputFolder: "comics/built",
    pages: [
      { id: "a", source: "a.webp", regions: [{ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }] }] },
      { id: "b", source: "b.webp", regions: [{ points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }] }] }
    ]
  });
  assert.equal(project.pages.length, 2);
  assert.equal(project.pages[0].layers[0].regions[0].points.length, 3);
  assert.equal(project.pages[1].layers[0].regions[0].points.length, 4);
  assert.equal(project.pages[0].timeline.length, 1);
});

test("constructor keeps a global reveal timeline across image layers", () => {
  const project = normalizeProject({
    format: "comic-reveal-project",
    version: 2,
    title: "Layers",
    outputFolder: "comics/layers",
    pages: [{
      id: "page",
      layers: [
        { id: "base", source: "base.webp", regions: [{ id: "a", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] },
        { id: "overlay", source: "overlay.webp", regions: [{ id: "b", points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] }
      ],
      timeline: [
        { layerId: "base", regionId: "a" },
        { layerId: "overlay", regionId: "b", sound: "sounds/impact.ogg" }
      ]
    }]
  });
  assert.deepEqual(project.pages[0].timeline, [
    { layerId: "base", regionId: "a", sound: null, transition: "instant", duration: 600 },
    { layerId: "overlay", regionId: "b", sound: null, transition: "instant", duration: 600 }
  ]);
  assert.deepEqual(project.audioTracks, [{
    id: "audio-1",
    source: "sounds/impact.ogg",
    start: 1,
    end: 1
  }]);
});

test("overlapping audio tracks stay active across their frame ranges", () => {
  const library = normalizeLibrary({ comics: [{
    id: "tracks",
    pages: [{
      states: ["1.webp", "2.webp", "3.webp"],
      audioTracks: [
        { id: "ambience", source: "ambience.ogg", start: 0, end: 2 },
        { id: "impact", source: "impact.ogg", start: 1, end: 1 }
      ]
    }]
  }] });
  const audioComic = library.comics[0];
  const first = { ...startPresentation(audioComic), stepIndex: 0 };
  const second = { ...first, stepIndex: 1 };
  const third = { ...first, stepIndex: 2 };
  assert.deepEqual(getActiveAudioTracks(first, audioComic).map((track) => track.id), ["ambience"]);
  assert.deepEqual(getActiveAudioTracks(second, audioComic).map((track) => track.id), ["ambience", "impact"]);
  assert.deepEqual(getActiveAudioTracks(third, audioComic).map((track) => track.id), ["ambience"]);
});

test("an audio track remains active across a page boundary and its blank step", () => {
  const library = normalizeLibrary({ comics: [{
    id: "cross-page",
    pages: [
      { states: ["1.webp", "2.webp"] },
      { states: ["3.webp", "4.webp"] }
    ],
    audioTracks: [{ id: "bridge", source: "bridge.ogg", start: 1, end: 2 }]
  }] });
  const audioComic = library.comics[0];
  const lastOnFirstPage = { ...startPresentation(audioComic), pageIndex: 0, stepIndex: 1 };
  const blankBeforeSecondPage = { ...lastOnFirstPage, pageIndex: 1, stepIndex: -1 };
  const firstOnSecondPage = { ...lastOnFirstPage, pageIndex: 1, stepIndex: 0 };
  assert.deepEqual(getActiveAudioTracks(lastOnFirstPage, audioComic).map((track) => track.id), ["bridge"]);
  assert.deepEqual(getActiveAudioTracks(blankBeforeSecondPage, audioComic).map((track) => track.id), ["bridge"]);
  assert.deepEqual(getActiveAudioTracks(firstOnSecondPage, audioComic).map((track) => track.id), ["bridge"]);
});

test("non-overlapping audio tracks reuse the leftmost lane", () => {
  const lanes = assignAudioLanes([
    { id: "first", start: 0, end: 0 },
    { id: "second", start: 2, end: 3 },
    { id: "overlap", start: 3, end: 4 },
    { id: "later", start: 5, end: 5 }
  ]);
  assert.equal(lanes.get("first"), 0);
  assert.equal(lanes.get("second"), 0);
  assert.equal(lanes.get("overlap"), 1);
  assert.equal(lanes.get("later"), 0);
});

test("constructor preserves layer transforms and frame transitions", () => {
  const project = normalizeProject({
    format: "comic-reveal-project",
    title: "Animated",
    outputFolder: "comics/animated",
    pages: [{
      layers: [{
        id: "layer",
        source: "layer.webp",
        transform: { x: 0.25, y: 0.75, scale: 1.4, rotation: 25 },
        regions: [{ id: "region", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }]
      }],
      timeline: [{ layerId: "layer", regionId: "region", transition: "blur", duration: 1400 }]
    }]
  });
  assert.deepEqual(project.pages[0].layers[0].transform, { x: 0.25, y: 0.75, scale: 1.4, rotation: 25 });
  assert.equal(project.pages[0].timeline[0].transition, "blur");
  assert.equal(project.pages[0].timeline[0].duration, 1400);
});

test("freehand point simplification removes near-duplicate samples", () => {
  const points = simplifyPoints([
    { x: 0, y: 0 },
    { x: 0.0001, y: 0.0001 },
    { x: 0.5, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 0, y: 0.5 }
  ]);
  assert.equal(points.length, 4);
});

test("sound effects stay aligned with naturally sorted frame images", () => {
  const library = normalizeLibrary({ comics: [{
    id: "sound",
    pages: [{
      states: ["10.webp", "2.webp", "1.webp"],
      sounds: ["ten.ogg", "two.ogg", "one.ogg"]
    }]
  }] });
  const soundComic = library.comics[0];
  const state = { ...startPresentation(soundComic), stepIndex: 1 };
  assert.equal(getCurrentImage(state, soundComic), "2.webp");
  assert.equal(getCurrentSound(state, soundComic), "two.ogg");
  assert.deepEqual(getUpcomingSounds({ ...state, stepIndex: 0 }, soundComic), ["two.ogg", "ten.ogg"]);
});

test("transitions stay aligned with naturally sorted frame images", () => {
  const library = normalizeLibrary({ comics: [{
    id: "transitions",
    pages: [{
      states: ["10.webp", "2.webp", "1.webp"],
      transitions: ["reveal-ltr", "slide-left", "blur"],
      overlays: ["overlay-10.webp", "overlay-2.webp", "overlay-1.webp"],
      durations: [5000, 800, 0],
      overlayRects: [
        { x: 0.4, y: 0.2, width: 0.5, height: 0.6 },
        { x: 0.1, y: 0.3, width: 0.25, height: 0.4 },
        { x: 0, y: 0, width: 1, height: 1 }
      ]
    }]
  }] });
  const transitionComic = library.comics[0];
  assert.deepEqual(transitionComic.pages[0].transitions, ["blur", "slide-left", "reveal-ltr"]);
  const state = { ...startPresentation(transitionComic), stepIndex: 1 };
  assert.equal(getCurrentTransition(state, transitionComic), "slide-left");
  assert.equal(getCurrentOverlay(state, transitionComic), "overlay-2.webp");
  assert.deepEqual(getCurrentOverlayRect(state, transitionComic), { x: 0.1, y: 0.3, width: 0.25, height: 0.4 });
  assert.equal(getCurrentDuration(state, transitionComic), 800);
  assert.equal(getCurrentDuration({ ...state, stepIndex: 2 }, transitionComic), 5000);
  assert.deepEqual(getUpcomingOverlays({ ...state, stepIndex: 0 }, transitionComic), ["overlay-2.webp", "overlay-10.webp"]);
});

test("layers can be reordered by drag target identifiers", () => {
  const layers = [{ id: "base" }, { id: "effects" }, { id: "text" }];
  assert.equal(reorderLayers(layers, "text", "base"), true);
  assert.deepEqual(layers.map((layer) => layer.id), ["text", "base", "effects"]);
  assert.equal(reorderLayers(layers, "missing", "base"), false);
});

test("audio segments are encoded as trimmed 16-bit PCM WAV files", () => {
  const left = new Float32Array([-1, -0.5, 0, 0.5, 1]);
  const right = new Float32Array([1, 0.5, 0, -0.5, -1]);
  const buffer = {
    sampleRate: 10,
    numberOfChannels: 2,
    length: 5,
    getChannelData: (channel) => channel === 0 ? left : right
  };
  const wav = encodeWavSegment(buffer, 0.1, 0.4);
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 8, 4)), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 10);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(44, true), -16384);
  assert.equal(view.getInt16(46, true), 16383);
});

test("English and Russian locales are complete and cover every static UI key", () => {
  const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const english = readJson("../lang/en.json");
  const russian = readJson("../lang/ru.json");
  assert.deepEqual(Object.keys(english).sort(), Object.keys(russian).sort());
  for (const [key, value] of Object.entries(english)) {
    assert.equal(typeof value, "string", `${key} must be a string in English`);
    assert.ok(value.trim(), `${key} must not be empty in English`);
    assert.doesNotMatch(value, /[А-Яа-яЁё]/u, `${key} contains Cyrillic in English`);
    assert.ok(String(russian[key]).trim(), `${key} must not be empty in Russian`);
  }
  const sources = ["../scripts/comic-builder.js", "../scripts/comic-reveal.js"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  const referenced = [...sources.matchAll(/["'](CR\.[A-Za-z0-9_.-]+)["']/g)].map((match) => match[1]);
  for (const key of referenced) {
    assert.ok(key in english, `${key} is missing from English locale`);
    assert.ok(key in russian, `${key} is missing from Russian locale`);
  }
});

test("saved automatic page and layer names follow the active locale", () => {
  const english = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const russian = JSON.parse(readFileSync(new URL("../lang/ru.json", import.meta.url), "utf8"));
  const previousGame = globalThis.game;
  const useLocale = (locale) => {
    globalThis.game = { i18n: {
      localize: (key) => locale[key],
      format: (key, values) => locale[key].replace("{number}", values.number)
    } };
  };
  try {
    useLocale(english);
    assert.equal(localizeGeneratedName("Страница 4", "page", 1), "Page 4");
    assert.equal(localizeGeneratedName("Слой 2", "layer", 1), "Layer 2");
    assert.equal(localizeGeneratedName("Импортированное состояние 3", "layer", 1), "Imported state 3");
    assert.equal(localizeGeneratedName("Моя страница", "page", 1), "Моя страница");
    useLocale(russian);
    assert.equal(localizeGeneratedName("Page 4", "page", 1), "Страница 4");
    assert.equal(localizeGeneratedName("Layer 2", "layer", 1), "Слой 2");
    assert.equal(localizeGeneratedName("New comic", "project"), "Новый комикс");
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
  }
});
