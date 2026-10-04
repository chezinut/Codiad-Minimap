# MiniMap

Adds a minimap to the right of the editor, giving a quick visual overview of the
open file. Highlights are produced in a web worker and colored to match the
active ACE theme.

## Features

- Language agnostic syntax highlighting (no per-language mode needed).
- Colors follow the editor theme, generated from the bundled ACE themes.
- Viewport indicator stays in sync while scrolling, and the map scrolls itself
  to follow the cursor for long files.
- Click or drag on the map to jump around the file.
- Works with split editor panes and follows the focused pane.

## Installation

Unzip into your `plugins` directory, the folder must be named after the
repository, e.g. `plugins/Codiad-Minimap-master`.

## Settings

The minimap has a **Minimap** tab in the editor settings dialog. Use
*Regenerate Presets* after adding or updating ACE themes so the minimap colors
are rebuilt from them. The presets are cached in `data/minimap/presets.json`;
until they are generated for the first time they are derived on the fly.

## Changelog

- 1.1.0 Ported the Atheos Minimap: Lumin highlighter replaces Prism, drag to
  scroll, theme aware colors, viewport scrolling for long files.
- 0.1.2 Rewritten, changed logic.
- 0.1.0 Initial release.

## Credits

- [Lumin](https://github.com/lrsjng/lolight) released under the MIT License.
- Minimap for Codiad by CheziNut, Liam Siira Andr3as MIT License.
