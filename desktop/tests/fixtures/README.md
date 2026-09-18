# Image decoder fixtures

These small geometric fixtures are test inputs, not character artwork or default companions.

The static companion test also generates a 369 x 544 transparent PNG with a colored rectangle using `tests/helpers/image.ts`; it requires no external artwork.

- `moving.gif` and `moving.webp`: 64 × 64, two 240 ms frames, infinite loop. Frame one has a red rectangle at x=8–23, y=8–55. Frame two has a blue rectangle at x=40–55, y=8–55. Other pixels are transparent. GIF uses disposal method 2; WebP is lossless.
- `static-lossless.webp`: the red rectangle on a transparent canvas, encoded as a simple VP8L image.
- `static-lossy.webp`: the red rectangle on an opaque canvas, encoded as a simple VP8 image.

The files were encoded with Pillow 12.1.0. Tests read the fixture files directly and do not require Python or Pillow.
