# Comic Reveal
Comic Reveal is a Foundry VTT v14 module for creating and presenting cinematic comics to every connected player. The GM advances a synchronized full-screen sequence one image at a time. Arbitrary panel shapes, curved borders, text, lighting changes, and other effects are supported because each reveal is exported as a complete prepared image.

## Example
### Comics
<img width="2552" height="1401" alt="image" src="https://github.com/user-attachments/assets/1ee8cce5-6597-4b03-a008-72af30daeeae" />

### Editor
<img width="2557" height="1407" alt="image" src="https://github.com/user-attachments/assets/f4598922-1acd-4e2f-889c-5565bbd38a68" />

## Install

Copy the `comic-reveal` folder into Foundry's `Data/modules` directory, restart Foundry, and enable **Comic Reveal** in the world.

## Prepare a comic

### Built-in constructor

Open the Comic Reveal library and click **Create comic from images**.

1. Enter a comic name and choose an output folder such as `comics/my-comic`.
2. Click **Add empty page**. Paste its image with `Ctrl+V`, or select the empty layer and click **Choose layer image**.
3. Outline each reveal area in playback order.
4. Add and arrange more pages when needed.
5. Use the preview controls to inspect every state, including the initial black state.
6. Click **Build comic**.

Three outline tools are available:

- **Freehand**: drag around the area. Use this for curved or irregular borders.
- **Polygon**: click to place points, then double-click or press Enter to finish.
- **Rectangle**: drag from one corner to the opposite corner.

The left sidebar selects, renames, reorders, and deletes pages. The right sidebar manages layers and the global reveal order. Every page can use a different layout.

### Layers

Each page contains one or more image layers. Click **Add empty layer**, select it, and paste or choose another full-size image. `Ctrl+V` always targets the selected layer; replacing a filled layer requires confirmation. Any regions drawn while that layer is selected reveal pixels from that layer. Each newly drawn region is appended to the page's global click order.

In edit mode, the canvas displays only the currently selected layer so its elements are easy to outline. The Preview controls show the cumulative result across all layers. Layers can be reordered by dragging their rows; reveal entries from different layers can be reordered independently with the arrow buttons.

This allows a later click to paint a region from another layer over everything already visible. For predictable alignment, use layer images with the same dimensions and composition.

### Sound effects

Every entry in the reveal-order sidebar has sound controls. Use the music-note button to choose an audio file, the speaker button to preview it locally, and the muted-speaker button to remove it. When that reveal is reached during presentation, the effect plays once on every connected client. Moving a reveal also moves its attached sound.

Sound does not replay merely because a player reconnects or reloads while a frame is already visible. Moving backward or forward onto the frame again does play it. The default effect volume can be changed in the module settings; each user's Foundry interface-volume control still applies.

The constructor creates cumulative WebP states in `page-01`, `page-02`, and so on. It also saves `comic-reveal-project.json` in the output folder. Use **Open project** later and select that file to edit the original page sources and outlines. Rebuilding updates the library automatically. Old surplus image files are ignored because playback follows the saved project manifest.

You can copy an image in another application and press `Ctrl+V` anywhere in the constructor. The image is converted to WebP and uploaded to the project's `sources` folder. It fills the currently selected layer. Choose the output folder before pasting.

Keep the source images in Foundry's user-data storage. The constructor never modifies the source images.

### Manually prepared image sequences

Use one of these folder layouts in Foundry's user-data storage.

One page:

```text
comics/my-comic/
  01.webp
  02.webp
  03.webp
```

Multiple pages:

```text
comics/my-comic/
  page-01/
    01.webp
    02.webp
  page-02/
    01.webp
    02.webp
```

Every image is a complete state of its page. Use zero-padded filenames when convenient. The module applies natural filename sorting, so `2.webp` also sorts before `10.webp`.

The presentation itself provides the initial black screen. Do not add a blank `00.webp` unless you deliberately want an extra blank click.

Only immediate subfolders are scanned. When the root contains images, those images form the first page; non-empty immediate subfolders follow in folder-name order.

## Use

1. Select the Token controls in a scene.
2. Click the book icon named **Comic Reveal**.
3. Choose the comic folder, enter a title, and click **Add**.
4. Choose a comic from the clearly labeled library and click **Show**. Constructor projects also have an **Edit** button.
5. Click anywhere on the stage, press Space, Enter, or Right Arrow to advance.

GM controls:

- Right Arrow, Space, Enter: next state.
- Left Arrow or Backspace: previous state.
- Escape: end the presentation for everyone.
- The toolbar provides the same previous, next, and close actions.

Players cannot advance or dismiss the synchronized presentation. The current state is stored as a world setting so reconnecting clients restore the current comic automatically. Socket messages provide immediate updates while the persistent setting remains authoritative.

The Foundry module settings include image fit (`contain` or `cover`) and an option to insert a black screen between pages.

## Updating assets

After adding, removing, or renaming image files, open the library and click the circular-arrow button to rescan that comic's folder.

Removing a comic from the library does not delete any image files.

## License

MIT
