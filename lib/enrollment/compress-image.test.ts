import { describe, it, expect, vi, afterEach } from "vitest";
import { fitWithin, prepareUpload } from "./compress-image";

describe("fitWithin", () => {
  it("leaves images already inside the limit untouched", () => {
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it("scales a landscape image so the width is the cap", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("scales a portrait image so the height is the cap", () => {
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("never returns a zero side for extreme aspect ratios", () => {
    expect(fitWithin(20000, 1, 2000)).toEqual({ width: 2000, height: 1 });
  });

  it("returns zero for invalid input", () => {
    expect(fitWithin(0, 100, 2000)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100, 2000)).toEqual({ width: 0, height: 0 });
  });
});

describe("prepareUpload", () => {
  it("returns PDFs as-is", async () => {
    const pdf = new File(["%PDF-1.4"], "akta.pdf", { type: "application/pdf" });
    expect(await prepareUpload(pdf)).toBe(pdf);
  });

  it("returns the original image when it cannot be decoded", async () => {
    const img = new File(["not really an image"], "foto.heic", { type: "image/heic" });
    expect(await prepareUpload(img)).toBe(img);
  });
});

describe("prepareUpload re-encoding", () => {
  function stubDecode(width: number, height: number, outBytes: number) {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
    // This suite runs in the node project: fake just the canvas surface.
    const canvases: { width: number; height: number }[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" }),
          toBlob: (cb: BlobCallback, type?: string) => cb(new Blob([new Uint8Array(outBytes)], { type })),
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    return { canvases, close };
  }
  const file = (bytes: number, name: string, type: string) =>
    new File([new Uint8Array(bytes)], name, { type });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("leaves a small JPEG/PNG alone", async () => {
    stubDecode(1200, 800, 10);
    const f = file(500_000, "a.jpg", "image/jpeg");
    expect(await prepareUpload(f)).toBe(f);
  });

  it("downscales a large PNG to JPEG at 1600px on the longest side", async () => {
    const { canvases, close } = stubDecode(4000, 3000, 400_000);
    const out = await prepareUpload(file(3_000_000, "kk.png", "image/png"));
    expect(out.name).toBe("kk.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(canvases[0].width).toBe(1600);
    expect(canvases[0].height).toBe(1200);
    expect(close).toHaveBeenCalled();
  });

  it("re-encodes a JPEG above 800 KB even when its dimensions are small", async () => {
    stubDecode(1200, 800, 300_000);
    const out = await prepareUpload(file(900_000, "a.jpg", "image/jpeg"));
    expect(out.size).toBe(300_000);
    expect(out.type).toBe("image/jpeg");
  });

  it("returns the original when the resized JPEG would be bigger", async () => {
    stubDecode(4000, 3000, 900_000);
    const f = file(500_000, "a.jpg", "image/jpeg");
    expect(await prepareUpload(f)).toBe(f);
  });

  it("returns the original when a large PNG does not shrink", async () => {
    stubDecode(1000, 1000, 2_000_000);
    const f = file(1_600_000, "a.png", "image/png");
    expect(await prepareUpload(f)).toBe(f);
  });

  it("always re-encodes a decodable WebP to JPEG, even when small or when it grows", async () => {
    stubDecode(800, 600, 90_000);
    const out = await prepareUpload(file(10_000, "foto.webp", "image/webp"));
    expect(out.name).toBe("foto.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(90_000);
  });
});
