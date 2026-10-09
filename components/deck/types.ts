import type { ReactNode } from "react";

export type Who = "admin" | "guru";

export type SlideStep = { title: string; text: string };

export type Slide = {
  /** Stable id, also the DOM id suffix. */
  id: string;
  /** Short label for the progress rail and screen readers. */
  nav: string;
  /** Module label shown next to the slide number. */
  kicker: string;
  title: string;
  lead: string;
  /** Up to four numbered points, revealed in sequence. */
  steps?: SlideStep[];
  /** Who uses this part of Talib. */
  who: Who[];
  /** Small tag for parts that are mid-cutover. */
  badge?: string;
  /** Right-hand illustration (or any node). Decorative: meaning lives in the text beside it. */
  art: ReactNode;
  /** The cover has its own composition. */
  variant?: "cover";
};
