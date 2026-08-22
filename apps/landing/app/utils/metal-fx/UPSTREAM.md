# metal-fx — vendored engine

The files in `engine/` are a framework-neutral port of `metal-fx` 1.0.4:

- upstream: https://github.com/Jakubantalik/metal-fx
- source commit: `be1bf89c63056521a4e8224f368768314c9006f7`
- copyright: 2026 Jakub Antalik
- license: MIT; see `LICENSE` in this directory

The React component and its runtime dependencies are intentionally not vendored.
OpenExpert provides its own Vue lifecycle, semantic border, focus handling and
fallbacks for reduced motion, reduced transparency, forced colors, print and
`data-oe-effects="solid"`.

Local changes to the engine must remain narrowly scoped and documented here.
The current integration may group rendering by preset and resolved theme so
multiple Vue instances can safely use the public per-instance preset contract.
OpenExpert also enables opt-in proximity reflections in light and dark themes.
Dark mode follows the upstream composite. Light mode deliberately attenuates
the canvases and uses a low-opacity source-over composite so the effect remains
visible on white while reading as a small cast of colour, not a dark stain.
