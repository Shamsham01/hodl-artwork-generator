/** Studio preview always composites at this size using WebP thumbs (not full PNGs). */
export const PREVIEW_CANVAS_SIZE = 512;

/** Final collection generation uses project canvas from Settings. */
export function jobConfigForPreview(config) {
  return {
    ...config,
    format: {
      ...config.format,
      width: PREVIEW_CANVAS_SIZE,
      height: PREVIEW_CANVAS_SIZE,
    },
  };
}
