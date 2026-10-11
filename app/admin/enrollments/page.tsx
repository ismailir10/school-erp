import { redirect } from "next/navigation";

/**
 * The formulir list is retired: one unified Pendaftaran list lives at
 * /admin/admissions (cycle 2026-10-11-pendaftaran-simplify). Old bookmarks and
 * links keep working: the filters they carried are mapped onto the new ones.
 * The detail page `/admin/enrollments/[id]` stays where it is.
 */

const LIST_PATH = "/admin/admissions";

/** Old formulir status filter → the Tahap it is now. */
const STATUS_TO_TAHAP: Record<string, string> = {
  INVITED: "FORMULIR_DIKIRIM",
  SUBMITTED: "FORMULIR_MASUK",
  UNDER_REVIEW: "FORMULIR_MASUK",
  ACCEPTED: "DITERIMA",
  REJECTED: "DITOLAK",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EnrollmentsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();

  const tahap = STATUS_TO_TAHAP[first(params.status)?.toUpperCase() ?? ""];
  if (tahap) next.set("tahap", tahap);
  // Only "unpaid" has a place on the new list; the other payment filters are views of the Pembayaran column.
  if (first(params.payment)?.toLowerCase() === "unpaid") next.set("payment", "unpaid");
  const search = first(params.search)?.trim();
  if (search) next.set("search", search);

  const qs = next.toString();
  redirect(qs ? `${LIST_PATH}?${qs}` : LIST_PATH);
}
