/**
 * Client-side photo compressor for the CALauraAI intake loop.
 *
 * A phone camera hands us 8-20 MB originals; the recognition bridge (and its
 * upstream) only needs the plate, not the megapixels. This module resizes every
 * pick to fit MAX_IMAGE_EDGE on its long edge, re-encodes as JPEG at
 * IMAGE_QUALITY, and walks quality / edge down until the silent payload is under
 * TARGET_IMAGE_BYTES. The user never sees a size error: huge inputs are simply
 * shrunk before they leave the browser.
 *
 * Browser-only by design (Image + canvas); call it from a client component.
 */

/**
 * Longest edge of the compressed image, in pixels. A multi-plate table needs
 * 1280 to keep small pieces legible; this matches the upstream vision guard's
 * own cap, and the byte budget below still keeps the payload under the limit.
 */
export const MAX_IMAGE_EDGE = 1280;
/** First-pass JPEG quality. */
export const IMAGE_QUALITY = 0.8;
/**
 * Hard ceiling for the compressed payload. The CalorieAI upstream rejects
 * anything above 200 KB with `IMAGE_TOO_LARGE`, so we stay just under it: a
 * smaller payload is the difference between a result and a "could not read".
 */
export const TARGET_IMAGE_BYTES = 190 * 1024;

export interface CompressedImage {
  /** JPEG data URL, ready for the recognize body and the preview chip. */
  dataUrl: string;
  /** Compressed payload size in bytes. */
  bytes: number;
  width: number;
  height: number;
  /** Size of the file the user picked, before compression. */
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode that image"));
    image.src = source;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress that image"))),
      "image/jpeg",
      quality
    );
  });
}

interface Render {
  blob: Blob;
  width: number;
  height: number;
}

async function render(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  edge: number,
  quality: number
): Promise<Render> {
  const longest = Math.max(image.naturalWidth || 1, image.naturalHeight || 1);
  const scale = Math.min(1, edge / longest);
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not compress that image");

  // Flatten onto white so transparent PNGs do not turn black in JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, quality);
  return { blob, width, height };
}

/**
 * Compress one picked file into a small JPEG data URL.
 *
 * Never rejects for "too large" - the size is solved, not reported. It only
 * rejects when the file cannot be read or decoded, which the caller surfaces as
 * a normal error line.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const originalWidth = image.naturalWidth || 1;
  const originalHeight = image.naturalHeight || 1;

  const canvas = document.createElement("canvas");
  let edge = Math.min(MAX_IMAGE_EDGE, Math.max(originalWidth, originalHeight));
  let quality = IMAGE_QUALITY;
  let last = await render(canvas, image, edge, quality);

  // JPEG is usually far under the ceiling at 1280px / 0.8; this walk only
  // engages for pathological noise so the payload stays silently small.
  for (let attempt = 0; attempt < 6 && last.blob.size > TARGET_IMAGE_BYTES; attempt += 1) {
    if (quality > 0.55) {
      quality = Math.max(0.5, Math.round((quality - 0.1) * 100) / 100);
    } else {
      edge = Math.max(320, Math.round(edge * 0.75));
    }
    last = await render(canvas, image, edge, quality);
  }

  return {
    dataUrl: await blobToDataUrl(last.blob),
    bytes: last.blob.size,
    width: last.width,
    height: last.height,
    originalBytes: file.size,
    originalWidth,
    originalHeight,
  };
}
