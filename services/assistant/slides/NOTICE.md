# Slides module (PPTist)

The `/slides` editor is **PPTist** by pipipi-pikachu, used unmodified except for the small overlay in
`overlay/` (Yggdrasil theme, IBM Plex fonts, and a bridge that loads/saves decks as JSON through the
Yggdrasil API).

- Source: https://github.com/pipipi-pikachu/PPTist
- Pinned commit: see `PPTIST_REF`
- License: **AGPL-3.0** (see `LICENSE`). The overlay files in this folder are provided under the same
  license. If you distribute a build of this module, the complete corresponding source is this
  directory plus the pinned upstream commit.

`build.sh` clones the pinned commit, copies the overlay over it, and builds a static bundle into `dist/`
(base path `/slides/`). It is built at image-build time and is only fetched by the browser when the Slides
view is opened.
