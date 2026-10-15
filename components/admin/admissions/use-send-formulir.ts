"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, readApiError } from "@/lib/api/client-errors";
import type { SendFormulirResult } from "./send-formulir-dialog";
import type { Admission } from "./types";

/**
 * "Kirim Formulir" / "Kirim ulang tautan" in one tap (cycle 2026-10-15-pendaftaran-pay-after-form).
 *
 * `send(admission)` posts the invite straight away (no program, no price: the parent chooses and
 * pays after the form) and, on success, hands the link back as `sent` for the result card. Each
 * row is single-flight (a double tap sends once) but rows are independent: tapping row B while
 * row A is still in flight sends B. `sendingIds` is what the buttons and the live region show.
 *
 * Lives in a hook of its own, not in the page: the page passes `send` into the memoised columns,
 * and keeping the in-flight refs in here keeps them out of that render path.
 */

const SEND_FALLBACK = "Gagal mengirim formulir. Coba lagi.";

/** What `POST /api/enrollments/invite` answers. */
type InviteResponse = { id?: string; formUrl?: string; emailed?: boolean; hasEmail?: boolean };

export type SentFormulir = {
  admission: Admission;
  result: SendFormulirResult;
  /** The lead already had a link, which this send replaced. */
  resend: boolean;
};

export function useSendFormulir({ onChanged }: { onChanged: () => void | Promise<unknown> }) {
  const [sendingIds, setSendingIds] = useState<string[]>([]);
  const [sent, setSent] = useState<SentFormulir | null>(null);
  // `sendingIds` only reaches the button on the next render, so a fast second tap needs this.
  const inFlight = useRef<Set<string>>(new Set());
  // `send` stays stable (it sits in the memoised columns), so it reads the list refresh through a ref.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  const send = useCallback(async (a: Admission) => {
    if (inFlight.current.has(a.id)) return;
    inFlight.current.add(a.id);
    setSendingIds((ids) => [...ids, a.id]);

    const post = async () => {
      const res = await fetch("/api/enrollments/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admissionId: a.id }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          // LEAD_CLOSED / ALREADY_IN_PROGRESS: nothing to retry, so say why and show the row as it is now.
          const d = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error(d.message || "Formulir tidak bisa dikirim untuk calon siswa ini.");
          void changed.current();
          return;
        }
        if (res.status === 429) throw new ApiError("Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.", { status: 429 });
        throw await readApiError(res, SEND_FALLBACK);
      }
      const d = (await res.json().catch(() => ({}))) as InviteResponse;
      if (!d.formUrl || !d.id) {
        toast.error("Formulir disiapkan, tetapi tautannya tidak terbaca. Muat ulang lalu coba lagi.");
        void changed.current();
        return;
      }
      setSent({
        admission: a,
        result: { id: d.id, formUrl: d.formUrl, emailed: !!d.emailed, hasEmail: !!d.hasEmail },
        resend: a.stage === "FORMULIR_DIKIRIM",
      });
      void changed.current();
    };

    // No try/finally: React Compiler does not support `finally`, and a component it cannot compile
    // silently loses the react-hooks lint rules. `post` holds every early return and the catch
    // handles every failure, so the cleanup below always runs.
    try {
      await post();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : SEND_FALLBACK);
    }
    inFlight.current.delete(a.id);
    setSendingIds((ids) => ids.filter((id) => id !== a.id));
  }, []);

  const clearSent = useCallback(() => setSent(null), []);

  return { send, sendingIds, sent, clearSent };
}
