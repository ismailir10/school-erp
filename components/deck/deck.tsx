"use client";

import Link from "next/link";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowLeft, ArrowRight, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import { cn } from "@/lib/utils";
import { SlideView } from "./slide-view";
import type { Slide } from "./types";

/* ── Slide position lives in the URL hash (#1 … #N) ───────────────────────────────────────────────
 * A tiny external store rather than state + effect: the hash is the source of truth, so a reload, a
 * pasted link and the browser's own hashchange all land on the same slide with no sync code.
 * replaceState (not assignment) keeps Back from walking through every slide a presenter visited. */
const listeners = new Set<() => void>();

function subscribeHash(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("hashchange", onChange);
  };
}

function writeHash(n: number) {
  window.history.replaceState(null, "", `#${n}`);
  listeners.forEach((l) => l());
}

function parseHash(total: number): number {
  const n = Number.parseInt(window.location.hash.slice(1), 10);
  return Number.isInteger(n) && n >= 1 && n <= total ? n : 1;
}

const subscribeNoop = () => () => {};

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

const SWIPE_MIN_PX = 56;

/** True when Space/Enter would be taking an action the focused control already owns. */
function ownsActivationKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a[href], input, select, textarea, [role='button']") !== null
  );
}

export function Deck({
  slides,
  homeHref,
  homeLabel,
  title = "Panduan Talib",
}: {
  slides: Slide[];
  /** Deck name in the header and the carousel label. */
  title?: string;
  /** Where "Kembali" goes: the viewer's own portal home. */
  homeHref: string;
  homeLabel: string;
}) {
  const total = slides.length;
  const current = useSyncExternalStore(
    subscribeHash,
    () => parseHash(total),
    () => 1,
  );
  const index = current - 1;
  const slide = slides[index];

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<"fwd" | "back">("fwd");

  const canFullscreen = useSyncExternalStore(
    subscribeNoop,
    () => typeof document.fullscreenEnabled === "boolean" && document.fullscreenEnabled,
    () => false,
  );
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );

  const go = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 1), total);
      if (next === parseHash(total)) return;
      setDirection(next > parseHash(total) ? "fwd" : "back");
      writeHash(next);
      scrollRef.current?.scrollTo?.({ top: 0 });
    },
    [total],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          go(parseHash(total) + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(parseHash(total) - 1);
          break;
        case " ":
          if (ownsActivationKeys(e.target)) return;
          e.preventDefault();
          go(parseHash(total) + (e.shiftKey ? -1 : 1));
          break;
        case "Home":
          e.preventDefault();
          go(1);
          break;
        case "End":
          e.preventDefault();
          go(total);
          break;
        case "f":
        case "F":
          if (ownsActivationKeys(e.target)) return;
          toggleFullscreen();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, toggleFullscreen, total]);

  // Touch swipe. `touch-action: pan-y` on the stage hands horizontal gestures to us while vertical
  // ones keep scrolling a tall slide. Mouse drags are ignored on purpose: they select text.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  function onPointerDown(e: ReactPointerEvent) {
    swipe.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: ReactPointerEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(current + (dx < 0 ? 1 : -1));
  }

  const atStart = current === 1;
  const atEnd = current === total;

  return (
    <div ref={rootRef} className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4 sm:px-8">
        <Link
          href={homeHref}
          className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Kembali ke ${homeLabel}`}
        >
          <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
          <TalibWordmark size="sm" showSublabel={false} />
        </Link>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <span className="truncate text-sm text-muted-foreground">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          <p
            className="mr-2 hidden text-xs tabular-nums text-muted-foreground sm:block"
            aria-hidden="true"
          >
            {String(current).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
          {canFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Keluar dari layar penuh" : "Layar penuh"}
              aria-keyshortcuts="F"
              className="hidden sm:inline-flex"
            >
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          )}
          <Button variant="ghost" size="sm" render={<Link href={homeHref} />}>
            Kembali
          </Button>
        </div>
      </header>

      <main
        aria-roledescription="carousel"
        aria-label={title}
        className="relative min-h-0 flex-1"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          Slide {current} dari {total}: {slide.title}
        </p>
        {/* touch-action lives on the scroller itself: the browser reads it from the touched element up to the
            nearest scroll container only, so on <main> it was ignored and horizontal swipes were cancelled. */}
        <div
          ref={scrollRef}
          data-deck-scroll
          className="h-full touch-pan-y overflow-y-auto overscroll-contain"
        >
          <section
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${current} dari ${total}`}
            id={`slide-${slide.id}`}
            className={cn(
              "flex min-h-full",
              direction === "fwd"
                ? "motion-safe:animate-deck-in-fwd"
                : "motion-safe:animate-deck-in-back",
            )}
          >
            <SlideView slide={slide} index={current} />
          </section>
        </div>
      </main>

      <footer className="relative flex min-h-16 shrink-0 items-center gap-3 border-t border-border/70 px-4 pb-[env(safe-area-inset-bottom)] sm:px-8">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-foreground/10 sm:hidden"
        >
          <div
            className="h-full bg-primary-text transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${(current / total) * 100}%` }}
          />
        </div>
        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => go(current - 1)}
          disabled={atStart}
          aria-label="Slide sebelumnya"
        >
          <ArrowLeft />
        </Button>

        <nav
          aria-label="Daftar slide"
          className="mx-auto hidden items-center sm:flex"
        >
          {slides.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i + 1)}
                aria-label={`Slide ${i + 1}: ${s.nav}`}
                aria-current={active ? "step" : undefined}
                title={s.nav}
                className="group grid h-9 w-7 place-items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block h-1.5 rounded-full transition-[width,background-color] duration-300",
                    active
                      ? "w-6 bg-primary-text"
                      : "w-1.5 bg-foreground/20 group-hover:bg-foreground/45",
                  )}
                />
              </button>
            );
          })}
        </nav>

        <p
          className="mx-auto text-xs tabular-nums text-muted-foreground sm:hidden"
          aria-hidden="true"
        >
          {current} / {total}
        </p>

        <Button
          size="icon-lg"
          onClick={() => go(current + 1)}
          disabled={atEnd}
          aria-label="Slide berikutnya"
        >
          <ArrowRight />
        </Button>
      </footer>
    </div>
  );
}
