"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/feedback";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from "lucide-react";

export type IndicatorDTO = {
  id: string;
  label: string;
  order: number;
  status: string;
  categoryId: string;
};

export type CategoryDTO = {
  id: string;
  name: string;
  scope: "SCHOOL" | "HOME";
  order: number;
  status: string;
  indicators: IndicatorDTO[];
};

type Props = {
  categories: CategoryDTO[];
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onEditCategory: (cat: CategoryDTO) => void;
  onAddIndicator: (cat: CategoryDTO) => void;
  onEditIndicator: (ind: IndicatorDTO, cat: CategoryDTO) => void;
};

export function CategoryAccordion({
  categories,
  loading,
  onRefresh,
  onEditCategory,
  onAddIndicator,
  onEditIndicator,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "category"; id: string; name: string; activate: boolean }
    | { kind: "indicator"; id: string; label: string; activate: boolean }
    | null
  >(null);

  async function patchCategory(id: string, data: Record<string, unknown>) {
    setPending(`cat:${id}`);
    let errorToasted = false;
    // A failed save stays with "Coba lagi" that re-sends the same payload; the
    // caller already handles the rethrow, so the retry swallows it.
    const toastId = `journal-category-save-${id}`;
    const retry = () => {
      void patchCategory(id, data).catch(() => {});
    };
    try {
      const res = await fetch(`/api/student-journal/categories/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error ?? "Gagal memperbarui kategori";
        errorToasted = true;
        toastError(message, { retry, id: toastId });
        throw new Error(message);
      }
      toast.success("Kategori diperbarui", { id: toastId });
      await onRefresh();
    } catch (error) {
      if (!errorToasted) {
        toastError("Gagal memperbarui kategori. Coba lagi.", { retry, id: toastId });
      }
      throw error instanceof Error
        ? error
        : new Error("Gagal memperbarui kategori");
    } finally {
      setPending(null);
    }
  }

  async function patchIndicator(id: string, data: Record<string, unknown>) {
    setPending(`ind:${id}`);
    let errorToasted = false;
    // A failed save stays with "Coba lagi" that re-sends the same payload; the
    // caller already handles the rethrow, so the retry swallows it.
    const toastId = `journal-indicator-save-${id}`;
    const retry = () => {
      void patchIndicator(id, data).catch(() => {});
    };
    try {
      const res = await fetch(`/api/student-journal/indicators/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error ?? "Gagal memperbarui indikator";
        errorToasted = true;
        toastError(message, { retry, id: toastId });
        throw new Error(message);
      }
      toast.success("Indikator diperbarui", { id: toastId });
      await onRefresh();
    } catch (error) {
      if (!errorToasted) {
        toastError("Gagal memperbarui indikator. Coba lagi.", { retry, id: toastId });
      }
      throw error instanceof Error
        ? error
        : new Error("Gagal memperbarui indikator");
    } finally {
      setPending(null);
    }
  }

  // Swap `order` with the neighbour in the given direction. Arrays are already
  // sorted by order asc, so neighbours are the array neighbours.
  function reorderCategory(idx: number, dir: -1 | 1) {
    const a = categories[idx];
    const b = categories[idx + dir];
    if (!a || !b) return;
    void Promise.all([
      patchCategory(a.id, { order: b.order }),
      patchCategory(b.id, { order: a.order }),
    ]).catch(() => undefined);
  }

  function reorderIndicator(cat: CategoryDTO, idx: number, dir: -1 | 1) {
    const a = cat.indicators[idx];
    const b = cat.indicators[idx + dir];
    if (!a || !b) return;
    void Promise.all([
      patchIndicator(a.id, { order: b.order }),
      patchIndicator(b.id, { order: a.order }),
    ]).catch(() => undefined);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (!categories.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Belum ada kategori"
        description="Tambahkan kategori pertama untuk mulai menyusun templat Buku Penghubung."
      />
    );
  }

  return (
    <>
      <Accordion multiple className="space-y-2">
        {categories.map((cat, idx) => {
          const activeIndicators = cat.indicators.filter((i) => i.status === "ACTIVE").length;
          return (
            <AccordionItem
              key={cat.id}
              value={cat.id}
              className="border rounded-md bg-card"
            >
              <div className="flex items-center pr-2">
                <AccordionTrigger className="flex-1 px-3 py-3 hover:no-underline">
                  <div className="flex items-center gap-2 flex-wrap text-left">
                    <span className="font-medium text-sm">{cat.name}</span>
                    {cat.status !== "ACTIVE" && (
                      <Badge variant="secondary" className="text-xs">Tidak Aktif</Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {activeIndicators} indikator
                    </Badge>
                  </div>
                </AccordionTrigger>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={idx === 0 || pending !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderCategory(idx, -1);
                    }}
                    title="Naik"
                    aria-label={`Naikkan kategori ${cat.name}`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={idx === categories.length - 1 || pending !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderCategory(idx, 1);
                    }}
                    title="Turun"
                    aria-label={`Turunkan kategori ${cat.name}`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                      <span className="sr-only">Buka menu kategori</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditCategory(cat)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      {cat.status === "ACTIVE" ? (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            setConfirm({
                              kind: "category",
                              id: cat.id,
                              name: cat.name,
                              activate: false,
                            })
                          }
                        >
                          <PowerOff className="h-3.5 w-3.5 mr-2" /> Nonaktifkan
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() =>
                            setConfirm({
                              kind: "category",
                              id: cat.id,
                              name: cat.name,
                              activate: true,
                            })
                          }
                        >
                          <Power className="h-3.5 w-3.5 mr-2" /> Aktifkan
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <AccordionContent className="px-3 pb-3 space-y-2">
                {cat.indicators.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Belum ada indikator.
                  </p>
                ) : (
                  cat.indicators.map((ind, iIdx) => (
                    <div
                      key={ind.id}
                      className="flex items-center gap-2 border rounded p-2 bg-muted/30"
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{ind.label}</span>
                        {ind.status !== "ACTIVE" && (
                          <Badge variant="secondary" className="text-xs">
                            Tidak Aktif
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={iIdx === 0 || pending !== null}
                        onClick={() => reorderIndicator(cat, iIdx, -1)}
                        title="Naik"
                        aria-label={`Naikkan indikator ${ind.label}`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={iIdx === cat.indicators.length - 1 || pending !== null}
                        onClick={() => reorderIndicator(cat, iIdx, 1)}
                        title="Turun"
                        aria-label={`Turunkan indikator ${ind.label}`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                          <span className="sr-only">Buka menu indikator</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEditIndicator(ind, cat)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                          {ind.status === "ACTIVE" ? (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() =>
                                setConfirm({
                                  kind: "indicator",
                                  id: ind.id,
                                  label: ind.label,
                                  activate: false,
                                })
                              }
                            >
                              <PowerOff className="h-3.5 w-3.5 mr-2" /> Nonaktifkan
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirm({
                                  kind: "indicator",
                                  id: ind.id,
                                  label: ind.label,
                                  activate: true,
                                })
                              }
                            >
                              <Power className="h-3.5 w-3.5 mr-2" /> Aktifkan
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddIndicator(cat)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Indikator
                </Button>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={
          confirm?.kind === "category"
            ? confirm.activate
              ? `Aktifkan kategori "${confirm.name}"?`
              : `Nonaktifkan kategori "${confirm.name}"?`
            : confirm?.kind === "indicator"
              ? confirm.activate
                ? `Aktifkan indikator "${confirm.label}"?`
                : `Nonaktifkan indikator "${confirm.label}"?`
              : ""
        }
        description={
          confirm?.activate
            ? "Item akan kembali muncul di isian harian."
            : "Item akan disembunyikan dari isian harian, data lama tetap tersimpan."
        }
        destructive={confirm?.activate === false}
        confirmLabel={confirm?.activate ? "Aktifkan" : "Ya, Nonaktifkan"}
        onConfirm={async () => {
          if (!confirm) return;
          const status = confirm.activate ? "ACTIVE" : "INACTIVE";
          if (confirm.kind === "category") {
            await patchCategory(confirm.id, { status });
          } else {
            await patchIndicator(confirm.id, { status });
          }
          setConfirm(null);
        }}
      />
    </>
  );
}
