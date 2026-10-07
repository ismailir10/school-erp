import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The per-step action bar (Batal / Lanjutkan / Komit …). The wizard shell
 * passes `footer={null}` to ResponsiveFormDialog because each step owns its
 * own buttons, which left them at the end of the scrolling body — at
 * 1440x900 "Lanjutkan" sat below the visible dialog area. Sticking the bar to
 * the bottom of the dialog's scroll viewport pins it like the docked footer
 * of the manual invoice dialog, without lifting step state into the shell.
 */
export function WizardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mb-2 flex flex-col-reverse gap-2 border-t bg-background pt-3 pb-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
