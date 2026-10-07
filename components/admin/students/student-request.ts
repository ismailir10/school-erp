"use client";

import { toast } from "sonner";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { ApiError } from "@/lib/api/client-errors";
import { applyServerErrors, FIELD_ERRORS_MESSAGE } from "@/lib/forms/server-errors";

/**
 * `sendJson` for the student create/edit forms. Same contract (throws an
 * `ApiError` on a non-2xx), but the 409 body's machine code is kept so the
 * form can react to it: `NIS_TAKEN` (inline error on the NIS field) and
 * `DUPLICATE_STUDENT` (confirm step carrying `existingId`).
 */
export class StudentRequestError extends ApiError {
  readonly code?: string;
  readonly existingId?: string;

  constructor(
    message: string,
    options: ConstructorParameters<typeof ApiError>[1] & { code?: string; existingId?: string } = {},
  ) {
    super(message, options);
    this.name = "StudentRequestError";
    this.code = options.code;
    this.existingId = options.existingId;
  }
}

export async function sendStudentJson<T = unknown>(
  url: string,
  { method, body }: { method: "POST" | "PUT"; body: unknown },
  fallback: string,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof d?.error === "string" && d.error.trim() ? d.error : fallback;
    const fieldErrors = Array.isArray(d?.errors)
      ? (d.errors as unknown[]).filter(
          (e): e is { field: string; message: string } =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as { field?: unknown }).field === "string" &&
            typeof (e as { message?: unknown }).message === "string",
        )
      : [];
    throw new StudentRequestError(message, {
      fieldErrors,
      status: res.status,
      code: typeof d?.code === "string" ? d.code : undefined,
      existingId: typeof d?.existingId === "string" ? d.existingId : undefined,
    });
  }
  return (await res.json().catch(() => null)) as T;
}

/**
 * `applyServerErrors` plus the NIS conflict: a 409 `NIS_TAKEN` lands on the
 * NIS field itself (the server message already says which student holds it)
 * instead of the form-level banner.
 */
export function applyStudentErrors<T extends FieldValues>(
  form: { setError: UseFormSetError<T>; getValues: () => unknown },
  err: unknown,
  fallback: string,
): void {
  if (err instanceof StudentRequestError && err.code === "NIS_TAKEN") {
    form.setError("nis" as FieldPath<T>, { type: "server", message: err.message }, { shouldFocus: true });
    toast.error(FIELD_ERRORS_MESSAGE);
    return;
  }
  applyServerErrors(form, err, fallback);
}
