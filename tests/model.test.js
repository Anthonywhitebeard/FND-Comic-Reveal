import test from "node:test";
import assert from "node:assert/strict";

import {
  advancePresentation,
  getCurrentImage,
  getCurrentSound,
  getUpcomingSounds,
  getUpcomingImages,
  naturalCompare,
  normalizeLibrary,
  retreatPresentation,
  startPresentation
} from "../scripts/model.js";
import { normalizeProject, reorderLayers, simplifyPoints } from "../scripts/comic-builder.js";

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
    { layerId: "base", regionId: "a", sound: null },
    { layerId: "overlay", regionId: "b", sound: "sounds/impact.ogg" }
  ]);
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

test("layers can be reordered by drag target identifiers", () => {
  const layers = [{ id: "base" }, { id: "effects" }, { id: "text" }];
  assert.equal(reorderLayers(layers, "text", "base"), true);
  assert.deepEqual(layers.map((layer) => layer.id), ["text", "base", "effects"]);
  assert.equal(reorderLayers(layers, "missing", "base"), false);
});
