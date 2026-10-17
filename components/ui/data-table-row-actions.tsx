"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Ban, Eye, MoreHorizontal, Pencil, Power, PowerOff, XCircle } from "lucide-react";

interface DataTableRowActionsProps {
  /** Human-readable row identity, e.g. "Alya Putri", for distinct screen-reader labels. */
  rowLabel?: string;
  onView?: () => void;
  onEdit?: () => void;
  /** Category A: binary soft-delete entities (Program, Student, Employee, ...). */
  onDeactivate?: () => void;
  onActivate?: () => void;
  isActive?: boolean;
  /** Category B: state-machine entities — Admission uses Cancel as its terminal action. */
  onCancel?: () => void;
  /** Category B: state-machine entities — Invoice uses Void as its terminal action. */
  onVoid?: () => void;
  /** Extra menu items rendered before the terminal action. */
  extraActions?: { label: string; icon?: React.ReactNode; onClick: () => void; destructive?: boolean }[];
}

export function DataTableRowActions({
  rowLabel,
  onView,
  onEdit,
  onDeactivate,
  onActivate,
  isActive = true,
  onCancel,
  onVoid,
  extraActions,
}: DataTableRowActionsProps) {
  const hasTerminal = onDeactivate || onActivate || onCancel || onVoid;
  const hasDropdownItems = onEdit || hasTerminal || (extraActions && extraActions.length > 0);

  return (
    <div className="flex items-center gap-1">
      {onView && (
        <Button size="sm" variant="ghost" onClick={onView} className="h-8 px-2" aria-label={rowLabel ? `Lihat ${rowLabel}` : "Lihat"}>
          <Eye size={14} className="mr-1" />
          <span className="text-xs">Lihat</span>
        </Button>
      )}

      {hasDropdownItems && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={rowLabel ? `Aksi untuk ${rowLabel}` : "Buka menu aksi"} />}>
            <MoreHorizontal size={14} />
          </DropdownMenuTrigger>
          {/* Sizes to content: the anchor is a 32px icon button, so the primitive's w-(--anchor-width) made 128px menus that wrapped labels word by word. */}
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil size={14} className="mr-2" />
                Ubah
              </DropdownMenuItem>
            )}

            {extraActions?.map((action, i) => (
              <DropdownMenuItem
                key={i}
                onClick={action.onClick}
                className={action.destructive ? "text-destructive focus:text-destructive" : ""}
              >
                {action.icon && <span className="mr-2">{action.icon}</span>}
                {action.label}
              </DropdownMenuItem>
            ))}

            {hasTerminal && (onEdit || extraActions?.length) && (
              <DropdownMenuSeparator />
            )}

            {isActive && onDeactivate && (
              <DropdownMenuItem onClick={onDeactivate} className="text-destructive focus:text-destructive">
                <PowerOff size={14} className="mr-2" />
                Nonaktifkan
              </DropdownMenuItem>
            )}

            {!isActive && onActivate && (
              <DropdownMenuItem onClick={onActivate}>
                <Power size={14} className="mr-2" />
                Aktifkan
              </DropdownMenuItem>
            )}

            {onCancel && (
              <DropdownMenuItem onClick={onCancel} className="text-destructive focus:text-destructive">
                <XCircle size={14} className="mr-2" />
                Batalkan
              </DropdownMenuItem>
            )}

            {onVoid && (
              <DropdownMenuItem onClick={onVoid} className="text-destructive focus:text-destructive">
                <Ban size={14} className="mr-2" />
                Batalkan
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
