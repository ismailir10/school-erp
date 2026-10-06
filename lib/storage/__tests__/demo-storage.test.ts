import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm } from "fs/promises";
import os from "os";
import path from "path";

// The demo backend must never touch Supabase — mock it so any accidental call fails loudly.
const { uploadObjectMock, downloadObjectMock, removeObjectMock } = vi.hoisted(() => ({
  uploadObjectMock: vi.fn(),
  downloadObjectMock: vi.fn(),
  removeObjectMock: vi.fn(),
}));
vi.mock("../supabase", () => ({
  uploadObject: uploadObjectMock,
  downloadObject: downloadObjectMock,
  removeObject: removeObjectMock,
}));

import { saveFile, streamFile, deleteFile } from "../index";

const ENV_KEYS = ["DEMO_MODE", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL"] as const;
const saved: Record<string, string | undefined> = {};

async function consume(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const args = {
  entity: "enrollment",
  entityId: "ea_demo1",
  field: "doc-akta",
  file: { bytes: pdf, mimeType: "application/pdf", ext: "pdf" },
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(path.join(os.tmpdir(), "talib-demo-storage", "enrollment", "ea_demo1"), {
    recursive: true,
    force: true,
  });
});

describe("storage adapter — demo disk backend", () => {
  it("round-trips save → stream → delete without touching Supabase", async () => {
    process.env.DEMO_MODE = "true";
    const { token } = await saveFile(args);
    expect(token).toMatch(/^demo:v1:enrollment\/ea_demo1\/doc-akta-[a-f0-9]{16}\.pdf$/);
    expect(uploadObjectMock).not.toHaveBeenCalled();

    const { stream, mimeType, filename } = await streamFile(token);
    expect(mimeType).toBe("application/pdf");
    expect(filename).toMatch(/^doc-akta-[a-f0-9]{16}\.pdf$/);
    expect((await consume(stream)).equals(pdf)).toBe(true);

    await deleteFile(token);
    await expect(streamFile(token)).rejects.toThrow();
    await expect(deleteFile(token)).resolves.toBeUndefined(); // already gone is success
    expect(downloadObjectMock).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("saveFile uses Supabase (not disk) when not in demo mode", async () => {
    const { token } = await saveFile(args);
    expect(token).toMatch(/^supabase:v1:/);
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["DEMO_MODE unset", {}],
    ["Supabase key present", { DEMO_MODE: "true", SUPABASE_SERVICE_ROLE_KEY: "k" }],
    ["running on Vercel", { DEMO_MODE: "true", VERCEL: "1" }],
  ])("rejects a demo token when %s", async (_label, env) => {
    process.env.DEMO_MODE = "true";
    const { token } = await saveFile(args);
    delete process.env.DEMO_MODE;
    Object.assign(process.env, env);
    await expect(streamFile(token)).rejects.toThrow(/outside demo mode/);
    await expect(deleteFile(token)).rejects.toThrow(/outside demo mode/);
  });

  it("applies the same path-traversal hardening to demo tokens", async () => {
    process.env.DEMO_MODE = "true";
    for (const t of [
      "demo:v1:../etc/passwd",
      "demo:v1:enrollment/../../x/doc.pdf",
      "demo:v1:/etc/passwd",
      "demo:v1:enrollment/ea/doc.exe",
    ]) {
      await expect(streamFile(t)).rejects.toThrow();
    }
  });
});
