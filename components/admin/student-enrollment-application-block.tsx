"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateShort } from "@/lib/format";
import {
  EnrollmentApplicationView,
  type EnrollmentApplicationBlobs,
} from "@/components/admin/enrollment-application-view";
import { EnrollmentDocumentsCard } from "@/components/admin/enrollment-documents-card";
import type { AdminDocuments } from "@/lib/enrollment/documents";

/**
 * Pendaftaran block of the student dossier — the original paper form, read-only.
 *
 * The convert route copies a subset of the form onto Student and Parent rows;
 * the rest (employer blocks, birth circumstances, the signed consent letter)
 * stayed in `EnrollmentApplication` and was reachable only by an admin who
 * already knew the application existed. This section is what un-orphans it.
 *
 * Owns its lazy fetch over `GET /api/students/[id]/enrollment-application`,
 * which 404s for a hand-entered student — the page only renders this section
 * when the overview aggregate has already said an application exists, so a 404
 * here means the form was deleted between the two calls and is reported as a
 * failure rather than an empty state.
 */

type Application = EnrollmentApplicationBlobs & {
  status: string;
  childName: string;
  parentEmail: string | null;
  dcareAddon: boolean;
  submittedAt: string | null;
  /**
   * Redacted by the API: file presence + names, never storage tokens. `null`
   * when the viewer lacks `admissions.view`; the card is then not shown.
   */
  documents?: AdminDocuments | null;
  /** `admissions.edit` — gates the "Diterima fisik" tick on the card. */
  canEditDocuments?: boolean;
  program: { id: string; name: string } | null;
  admission: {
    id: string;
    parentName: string;
    parentPhone: string | null;
    parentRelationship: string | null;
  } | null;
};

export const StudentEnrollmentApplicationBlock = memo(
  function StudentEnrollmentApplicationBlock({
    studentId,
    active,
    onDocumentsChange,
  }: {
    studentId: string;
    active: boolean;
    /** A "Diterima fisik" tick was saved; the rail's document count is now stale. */
    onDocumentsChange?: () => void;
  }) {
    const [application, setApplication] = useState<Application | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/students/${encodeURIComponent(studentId)}/enrollment-application`,
        );
        if (!res.ok) {
          setError(true);
          return;
        }
        const json = await res.json();
        const data = json?.data as Application | undefined;
        if (!data) {
          setError(true);
          return;
        }
        setApplication(data);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }, [studentId]);

    useEffect(() => {
      if (!active || application !== null || loading || error) return;
      load();
      // `application`/`loading`/`error` are the guard, not inputs to re-run on.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    if (loading || (active && application === null && !error)) {
      return (
        <div className="grid gap-4">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Gagal memuat formulir pendaftaran.</p>
          <button
            type="button"
            onClick={load}
            className="rounded-md text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Coba lagi
          </button>
        </div>
      );
    }

    if (!application) return null;

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {[
            application.program?.name,
            application.dcareAddon ? "+ Dcare" : null,
            application.submittedAt
              ? `dikirim ${formatDateShort(application.submittedAt)}`
              : "belum dikirim",
            application.admission?.parentName
              ? `pendaftar ${application.admission.parentName}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {application.documents && (
          <EnrollmentDocumentsCard
            applicationId={application.id}
            documents={application.documents}
            canEdit={application.canEditDocuments === true}
            onChange={onDocumentsChange}
          />
        )}

        {/* One column: the dossier's main column is already narrower than the
            enrollment page, and two columns of label/value rows inside it
            wrapped every value onto its own line. */}
        <EnrollmentApplicationView application={application} columns={1} />

        <Link
          href={`/admin/enrollments/${application.id}`}
          className="inline-block text-sm text-primary-text hover:underline"
        >
          Buka formulir di modul Pendaftaran →
        </Link>
      </div>
    );
  },
);
