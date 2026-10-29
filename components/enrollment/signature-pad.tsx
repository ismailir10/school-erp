"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { DrawCheck } from "@/components/reactbits/draw-check";

/**
 * Drawn-signature pad for the enrollment consent step. The parent draws with a
 * finger / mouse / stylus; "Simpan" hands the PNG blob up via onSave (the
 * wizard uploads it to the signature route and stores the returned token).
 * `saved` shows a confirmed state once the upload round-trips.
 *
 * Pointer Events cover mouse + touch + pen uniformly. The canvas backing store
 * is sized to its CSS box × devicePixelRatio so strokes stay crisp on HiDPI.
 */
export function SignaturePad({
  label,
  saved,
  saving = false,
  onSave,
}: {
  label: string;
  saved: boolean;
  /** A save is in flight: Simpan shows a busy state but stays mounted (focus-safe). */
  saving?: boolean;
  onSave: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1A2E2F";
    }
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    dirty.current = true;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    setHasInk(false);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas || !dirty.current || saving) return;
    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-text">
            <DrawCheck size={16} strokeWidth={2.5} /> Tersimpan
          </span>
        )}
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none rounded-lg border border-dashed border-border bg-muted"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label={`Area tanda tangan ${label}`}
        />
        {saved && !hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Tanda tangan sudah tersimpan. Gambar ulang jika ingin mengganti.
          </p>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={clear} disabled={!hasInk}>
          <Eraser size={14} /> Hapus
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-11 bg-primary-text text-white hover:bg-primary-text/90 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8"
          onClick={save}
          disabled={!hasInk}
          aria-disabled={saving}
          aria-busy={saving}
        >
          {saving && <Spinner aria-hidden className="size-3.5" />}{" "}
          {saving ? "Menyimpan tanda tangan…" : "Simpan tanda tangan"}
        </Button>
      </div>
    </div>
  );
}
