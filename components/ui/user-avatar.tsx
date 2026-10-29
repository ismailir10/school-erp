/**
 * UserAvatar — a person's avatar: photo when `src` loads, otherwise initials.
 *
 * Wraps the shadcn Avatar so every list row, profile header and table cell
 * shares one circle instead of a hand-rolled `rounded-full bg-muted` div.
 *
 * Props:
 *   name    The person's full name. Initials are the first letters of the
 *           first and last words, uppercased ("Abdullah Faris Siregar" -> "AS").
 *           A single word gives one letter; empty gives "?".
 *   src?    Optional photo URL. Falls back to initials until/unless it loads.
 *   size?   sm (size-8) | md (size-10, default) | lg (size-16). Override a
 *           one-off with `className` (e.g. "size-20").
 *   tone?   muted (default, bg-muted) | primary (bg-primary/10).
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type UserAvatarSize = "sm" | "md" | "lg";

/** "Abdullah Faris Siregar" -> "AS"; "Faris" -> "F"; "" -> "?". */
export function getInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const ends = words.length === 1 ? words : [words[0], words[words.length - 1]];
  return ends
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

const SIZE_CLASS: Record<UserAvatarSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-16",
};

const TEXT_CLASS: Record<UserAvatarSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-xl",
};

export function UserAvatar({
  name,
  src,
  size = "md",
  tone = "muted",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: UserAvatarSize;
  tone?: "muted" | "primary";
  className?: string;
}) {
  return (
    <Avatar className={cn(SIZE_CLASS[size], className)}>
      {src ? <AvatarImage src={src} alt="" loading="lazy" /> : null}
      <AvatarFallback
        className={cn(
          "font-bold text-primary",
          TEXT_CLASS[size],
          tone === "primary" && "bg-primary/10",
        )}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
