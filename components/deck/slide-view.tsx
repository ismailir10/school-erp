import { Aurora } from "@/components/reactbits/aurora";
import { BlurText } from "@/components/reactbits/blur-text";
import { Stagger, StaggerItem } from "@/components/reactbits/stagger";
import { cn } from "@/lib/utils";
import { FitHeight } from "./fit-height";
import type { Slide, Who } from "./types";

const WHO_LABEL: Record<Who, string> = { admin: "Admin", guru: "Guru" };

function WhoChips({ who }: { who: Who[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Dipakai oleh</span>
      {who.map((w) => (
        <span
          key={w}
          className="rounded-full border border-primary-text/25 bg-secondary px-2.5 py-0.5 text-xs font-medium text-primary-text"
        >
          {WHO_LABEL[w]}
        </span>
      ))}
    </div>
  );
}

function Kicker({ index, label }: { index: number; label: string }) {
  return (
    <p className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.14em] text-primary-text">
      <span className="tabular-nums">{String(index).padStart(2, "0")}</span>
      <span aria-hidden="true" className="h-px w-8 bg-primary-text/40" />
      {label}
    </p>
  );
}

export function SlideView({ slide, index }: { slide: Slide; index: number }) {
  if (slide.variant === "cover") return <CoverView slide={slide} />;

  // Three blocks, so a phone reads: headline and lead, the picture, then the details. On a wide screen
  // the picture takes the right column and the other two stack on the left.
  return (
    <FitHeight>
      <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-5 py-6 sm:px-10 sm:py-8 lg:grid-cols-[minmax(0,5.5fr)_minmax(0,6.5fr)] lg:gap-x-12 lg:gap-y-0 lg:px-14">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-end">
          <Kicker index={index} label={slide.kicker} />
          <BlurText
            as="h2"
            text={slide.title}
            className="mt-3 text-balance text-[clamp(1.875rem,1.1rem+2.3vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] sm:mt-4"
          />
          <p className="mt-4 max-w-[48ch] text-pretty text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-[1.1875rem]">
            {slide.lead}
          </p>
        </div>

        <div
          className="relative isolate -mx-5 min-w-0 overflow-hidden border-y border-border bg-secondary/40 p-3 sm:mx-0 sm:rounded-3xl sm:border sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in oklch, var(--primary-text) 16%, transparent) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
          }}
        >
          {slide.art}
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-start">
          {slide.steps && (
            <Stagger as="ol" count={slide.steps.length} className="grid gap-3.5 lg:mt-6">
              {slide.steps.map((s, i) => (
                <StaggerItem
                  key={s.title}
                  as="li"
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 text-xs font-medium tabular-nums text-primary-text"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="block">
                    <span className="block text-[0.95rem] font-semibold">{s.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                      {s.text}
                    </span>
                  </span>
                </StaggerItem>
              ))}
            </Stagger>
          )}
          <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-3", slide.steps ? "mt-6" : "lg:mt-6")}>
            <WhoChips who={slide.who} />
            {slide.badge && (
              <span className="rounded-full bg-celebration-gold-subtle px-2.5 py-0.5 text-xs font-medium text-celebration-gold-text">
                {slide.badge}
              </span>
            )}
          </div>
        </div>
      </div>
    </FitHeight>
  );
}

function CoverView({ slide }: { slide: Slide }) {
  return (
    <div className="relative isolate flex w-full overflow-hidden">
      <Aurora />
      <FitHeight>
      <div className="mx-auto grid w-full max-w-[1400px] items-center gap-8 px-5 pb-12 pt-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16 lg:px-14">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary-text">
            {slide.kicker}
          </p>
          <BlurText
            as="h1"
            text={slide.title}
            stagger={70}
            className={cn(
              "mt-5 text-balance text-[clamp(2.375rem,1.3rem+3.6vw,4.5rem)]",
              "font-semibold leading-[1.04] tracking-[-0.035em]",
            )}
          />
          <p className="mt-6 max-w-[46ch] text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {slide.lead}
          </p>
          <div className="mt-8">
            <WhoChips who={slide.who} />
          </div>
        </div>
        <div className="min-w-0">{slide.art}</div>
      </div>
      </FitHeight>
    </div>
  );
}
