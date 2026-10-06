/**
 * Browser-side image preparation for the enrollment "Berkas" step.
 *
 * A phone photo is routinely 4-8 MB; the upload route caps at 4 MB (Vercel's
 * request limit is 4.5 MB). Images are downscaled to a 2000 px longest side
 * and re-encoded as JPEG before they leave the browser. PDFs and anything we
 * cannot decode (e.g. HEIC outside Safari) go up untouched and the server
 * decides.
 */

export const MAX_IMAGE_SIDE = 2000;
export const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const JPEG_QUALITY = 0.85;

/** Scale (w, h) down so the longest side is at most `max`. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // fall through to the <img> path
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base || "foto";
}

/**
 * Returns the file to upload. Non-images (PDF) are returned as-is. Images are
 * downscaled / recompressed only when they are large; if anything fails the
 * original file is returned so the server can accept or reject it.
 */
export async function prepareUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const decoded = await decode(file);
    if (!decoded) return file;
    try {
      const { width, height } = decoded;
      // The server only accepts JPEG/PNG/PDF. Anything else the browser can
      // decode (WebP, GIF, HEIC on Safari) is always re-encoded to JPEG so it
      // isn't rejected with a 415.
      const acceptedByServer = file.type === "image/jpeg" || file.type === "image/png";
      const needsResize = Math.max(width, height) > MAX_IMAGE_SIDE;
      if (acceptedByServer && !needsResize && file.size <= COMPRESS_ABOVE_BYTES) return file;

      const target = fitWithin(width, height, MAX_IMAGE_SIDE);
      if (!target.width || !target.height) return file;
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // JPEG has no alpha, so paint white first or transparent PNGs turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) return file;
      // Never hand back something bigger than what we were given, unless the
      // original is a format the server would reject anyway.
      if (acceptedByServer && blob.size >= file.size) return file;
      return new File([blob], `${baseName(file.name)}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      decoded.release();
    }
  } catch {
    return file;
  }
}
