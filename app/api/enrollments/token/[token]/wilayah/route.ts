// @public — tokenized address lookup for the open enrollment form. NO session; the
// unguessable accessToken is the credential (it must resolve to an open form) and the
// response is static region data only. See proxy.ts public allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess } from "@/lib/enrollment/resolve-token";
import { denyTokenAccess } from "@/lib/enrollment/access-response";
import { lookupKodePos, searchWilayah, normalizeQuery, MIN_QUERY_LENGTH, MAX_QUERY_LENGTH } from "@/lib/wilayah/lookup";

const RATE_LIMIT_PER_MIN = 60; // typing in the "Tidak tahu kode pos?" search fires a few requests
const RATE_WINDOW_MS = 60_000;
const SEARCH_LIMIT = 20;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * GET ?kodepos=40115 → exact kode pos lookup; GET ?q=citarum → name search.
 * Exactly one of the two. Answers `{ results: WilayahEntry[] }` and nothing from
 * the application row; the token only proves the form is open.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = rateLimit(`enroll-wilayah:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const { access } = await resolveEnrollmentAccess(token, new Date());
  const denied = denyTokenAccess(access);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const hasKodePos = sp.has("kodepos");
  const hasQuery = sp.has("q");
  if (hasKodePos === hasQuery) return bad("Isi salah satu: kode pos atau nama wilayah.");

  let results;
  if (hasKodePos) {
    const kodePos = (sp.get("kodepos") ?? "").trim();
    if (!/^\d{5}$/.test(kodePos)) return bad("Kode pos harus 5 angka.");
    results = lookupKodePos(kodePos);
  } else {
    const q = sp.get("q") ?? "";
    const normalized = normalizeQuery(q.slice(0, MAX_QUERY_LENGTH * 2));
    if (normalized.length > MAX_QUERY_LENGTH) return bad(`Nama wilayah maksimal ${MAX_QUERY_LENGTH} huruf.`);
    if (normalized.replace(/ /g, "").length < MIN_QUERY_LENGTH) return bad(`Ketik minimal ${MIN_QUERY_LENGTH} huruf.`);
    results = searchWilayah(q, SEARCH_LIMIT);
  }

  // Static public data; the same answer for every parent. `private` keeps it out of shared caches.
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
