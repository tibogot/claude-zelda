/**
 * Runs mosaic generation off the main thread so WebGPU/UI stay responsive.
 */
import { generateMosaic } from "./roman-mosaic-pipeline.js";

self.onmessage = async (e) => {
  const { id, file, params } = e.data;
  if (!file) {
    self.postMessage({ id, type: "error", message: "No image file" });
    return;
  }
  try {
    self.postMessage({ id, type: "progress", msg: "Loading image…" });
    const result = await generateMosaic(file, params, (msg) => {
      self.postMessage({ id, type: "progress", msg });
    });
    const bitmap = await createImageBitmap(result.canvas);
    self.postMessage(
      {
        id,
        type: "done",
        bitmap,
        tileCount: result.tileCount,
        chainTileCount: result.chainTileCount,
        chainCount: result.chainCount,
        w: result.w,
        h: result.h,
      },
      [bitmap],
    );
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err?.message ?? String(err),
    });
  }
};
