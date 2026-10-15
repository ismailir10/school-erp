import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Drawing kit for the deck illustrations.
 *
 * One grammar so the ten pictures read as one hand: a 560×400 canvas, 1.5px ink at 55% for outlines,
 * 12px corner radius on cards, flat fills from brand tokens only (teal for the subject, a pale teal
 * for the supporting cast, gold for the single thing to look at). No gradients, no shadows, no
 * decorative blobs. Colours are Tailwind token classes, so a theme change reaches the art too.
 * Illustrations are decorative: the slide's text carries the meaning, so the <svg> is aria-hidden.
 */

export const INK = "stroke-foreground/55";
export const HAIR = "stroke-foreground/15";

export function Art({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 560 400"
      className="block h-auto w-full select-none font-sans"
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-art={label}
    >
      {children}
    </svg>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** White card with a hairline border. */
export function Card({
  x,
  y,
  w,
  h,
  r = 12,
  className,
}: Box & { r?: number; className?: string }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={r}
      className={cn("fill-card", HAIR, className)}
    />
  );
}

/** Placeholder text line. */
export function Bar({
  x,
  y,
  w,
  h = 7,
  className,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  className?: string;
}) {
  return (
    <rect x={x} y={y} width={w} height={h} rx={h / 2} className={cn("fill-foreground/12 stroke-none", className)} />
  );
}

export function Label({
  x,
  y,
  children,
  size = 14,
  anchor = "start",
  tone = "muted",
  weight = 500,
  className,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  anchor?: "start" | "middle" | "end";
  tone?: "muted" | "ink" | "teal" | "gold" | "onTeal";
  weight?: number;
  className?: string;
}) {
  const fill = {
    muted: "fill-muted-foreground",
    ink: "fill-foreground",
    teal: "fill-primary-text",
    gold: "fill-celebration-gold-text",
    onTeal: "fill-primary-foreground",
  }[tone];
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      className={cn(fill, "stroke-none", className)}
    >
      {children}
    </text>
  );
}

/** Rounded status chip with centred text. */
export function Pill({
  x,
  y,
  w,
  h = 26,
  children,
  tone = "pale",
  size = 14,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  children: ReactNode;
  tone?: "pale" | "teal" | "gold" | "line";
  size?: number;
}) {
  const shape = {
    pale: "fill-secondary stroke-primary-text/25",
    teal: "fill-primary stroke-none",
    gold: "fill-celebration-gold-subtle stroke-celebration-gold/50",
    line: "fill-card stroke-foreground/25",
  }[tone];
  const text = tone === "teal" ? "onTeal" : tone === "gold" ? "gold" : "teal";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} className={shape} />
      <Label x={x + w / 2} y={y + h / 2 + size * 0.35} size={size} anchor="middle" tone={text} weight={600}>
        {children}
      </Label>
    </g>
  );
}

/** Head-and-shoulders person glyph in a circle. */
export function Avatar({
  cx,
  cy,
  r = 14,
  tone = "pale",
}: {
  cx: number;
  cy: number;
  r?: number;
  tone?: "pale" | "teal" | "gold";
}) {
  const bg = { pale: "fill-secondary", teal: "fill-primary/35", gold: "fill-celebration-gold-subtle" }[tone];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className={cn(bg, "stroke-none")} />
      <circle cx={cx} cy={cy - r * 0.18} r={r * 0.3} className="fill-foreground/35 stroke-none" />
      <path
        d={`M${cx - r * 0.55} ${cy + r * 0.62} a${r * 0.55} ${r * 0.5} 0 0 1 ${r * 1.1} 0`}
        className="fill-foreground/35 stroke-none"
      />
    </g>
  );
}

/** Small tick used for "done". */
export function Tick({ cx, cy, s = 1, className }: { cx: number; cy: number; s?: number; className?: string }) {
  return (
    <path
      d={`M${cx - 5 * s} ${cy} l${3.6 * s} ${3.6 * s} l${6.4 * s} ${-7.2 * s}`}
      strokeWidth={2 * s}
      className={cn("stroke-primary-text", className)}
    />
  );
}

/** Straight or curved connector with an arrowhead at the end. */
export function Arrow({
  d,
  head,
  className,
}: {
  d: string;
  /** [x, y, angleDeg] of the arrowhead tip. */
  head: [number, number, number];
  className?: string;
}) {
  const [hx, hy, a] = head;
  return (
    <g className={cn("stroke-primary-text/70", className)}>
      <path d={d} />
      <path d="M-7 -5 L0 0 L-7 5" transform={`translate(${hx} ${hy}) rotate(${a})`} />
    </g>
  );
}
