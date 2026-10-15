"use client";

/**
 * Address block of the public pendaftaran form (child, Ayah, Ibu): kode pos
 * first, region boxes second.
 *
 *   Perumahan / Jalan · Blok / Cluster · RT / RW · Kode pos · [status · "Tidak tahu
 *   kode pos?" + search panel] · Kelurahan / Desa · Kecamatan · Kota / Kabupaten · Provinsi
 *
 * The status line and the search toggle sit right under the kode pos so they stay in view on a
 * phone; the four region boxes then stay together as one group.
 *
 * The kode pos input has no maxlength attribute on purpose: browsers truncate a paste to
 * maxlength BEFORE onChange runs, so "40 115" would arrive as "40 11". The handler strips
 * non-digits and keeps 5.
 *
 * Typing a full 5-digit kode pos asks the token-gated wilayah route
 * (`GET /api/enrollments/token/{token}/wilayah?kodepos=…`): one match fills the
 * four region boxes, several turn Kelurahan / Desa into a dropdown, none (or any
 * failure) leaves every box free to type. "Tidak tahu kode pos?" searches by
 * kelurahan / kecamatan name (`?q=…`, from 3 letters) and fills all five.
 *
 * Rules:
 * - A lookup is an explicit request, so ONE match overwrites all four region
 *   boxes, whatever they held. The boxes stay editable afterwards.
 * - SEVERAL matches fill nothing; the parent picks (the pick overwrites the
 *   region boxes). A stored kelurahan that is not among the options is cleared,
 *   and so are kecamatan / kota / provinsi unless every option shares them, so
 *   the dropdown never hides a value the form holds.
 * - NO match or a failure leaves every box as it is.
 * - Editing the kode pos below 5 digits drops the dropdown but never wipes the
 *   boxes.
 * - No lookup runs on mount: a reloaded draft already holds its values.
 * - A lookup never blocks the form and never throws; the worst case is a quiet
 *   message under the boxes.
 *
 * The kode pos input has no maxlength attribute on purpose: browsers truncate a paste to
 * maxlength BEFORE onChange runs, so "40 115" would arrive as "40 11". The handler strips
 * non-digits and keeps 5.
 *
 * Typing a full 5-digit kode pos asks the token-gated wilayah route
 * (`GET /api/enrollments/token/{token}/wilayah?kodepos=…`): one match fills the
 * four region boxes, several turn Kelurahan / Desa into a dropdown, none (or any
 * failure) leaves every box free to type. "Tidak tahu kode pos?" searches by
 * kelurahan / kecamatan name (`?q=…`, from 3 letters) and fills all five.
 *
 * Rules that keep a parent's own typing safe:
 * - A lookup only overwrites region boxes that are empty or still hold what an
 *   earlier lookup put there (`filledRef`). Anything the parent typed or edited
 *   stays. An explicit pick (dropdown option, search result) replaces the region
 *   boxes, because the parent just chose it.
 * - Editing the kode pos below 5 digits drops the dropdown but never wipes the
 *   boxes.
 * - No lookup runs on mount: a reloaded draft already holds its values.
 * - A lookup never blocks the form and never throws; the worst case is a quiet
 *   message under the boxes.
 *
 * The region data lives on the server (1.9 MB); this file only imports its
 * TYPE, never `lib/wilayah/lookup` itself.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import type { WilayahEntry } from "@/lib/wilayah/lookup";
import { INPUT_CLASS, SELECT_CLASS } from "./field-styles";

export type AddressValue = {
  perumahan: string;
  blokCluster: string;
  rtRw: string;
  kodePos: string;
  kelurahan: string;
  kecamatan: string;
  kotaKab: string;
  provinsi: string;
};

export const EMPTY_ADDRESS: AddressValue = {
  perumahan: "",
  blokCluster: "",
  rtRw: "",
  kodePos: "",
  kelurahan: "",
  kecamatan: "",
  kotaKab: "",
  provinsi: "",
};

const ADDRESS_KEYS = Object.keys(EMPTY_ADDRESS) as (keyof AddressValue)[];
const REGION_KEYS = ["kelurahan", "kecamatan", "kotaKab", "provinsi"] as const;

/** Hydrate from a stored draft / submission blob. Tolerates null, junk and old blobs without the newer keys. */
export function addressFromBlob(raw: unknown): AddressValue {
  const out: AddressValue = { ...EMPTY_ADDRESS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const k of ADDRESS_KEYS) {
    const v = src[k];
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/** Step validation: empty is fine (the address is optional); a partial or non-numeric code is not. */
export function kodePosError(value: Pick<AddressValue, "kodePos">): string | null {
  const code = value.kodePos.trim();
  return code !== "" && !/^\d{5}$/.test(code) ? "Kode pos harus 5 angka." : null;
}

type AddressFieldsProps = {
  /** Form access token; the lookup route is gated on it. */
  token: string;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  /** Accessible name of the group ("Alamat anak", "Alamat Ayah") so three sets of identical labels can be told apart. */
  legend?: string;
  /** Gives the kode pos input `data-field="{idPrefix}.kodePos"` so the form can focus it after a failed Lanjut. */
  idPrefix?: string;
  /** Show the kode pos format error (after a failed Lanjut). It follows the value, so correcting it clears it. */
  showErrors?: boolean;
};

// ── wilayah requests ──────────────────────────────────────────────────────────

type FetchResult = { ok: true; results: WilayahEntry[] } | { ok: false };

const isEntry = (e: unknown): e is WilayahEntry => {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return ["kodePos", "kelurahan", "kecamatan", "kotaKab", "provinsi"].every((k) => typeof o[k] === "string");
};

/** Never throws: a non-2xx, a bad body, a network error or an abort all read as `{ ok: false }`. */
async function fetchRegion(token: string, param: "kodepos" | "q", term: string, signal: AbortSignal): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/enrollments/token/${encodeURIComponent(token)}/wilayah?${param}=${encodeURIComponent(term)}`, { signal });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { results?: unknown };
    if (!Array.isArray(body?.results)) return { ok: false };
    return { ok: true, results: body.results.filter(isEntry) };
  } catch {
    return { ok: false };
  }
}

type Lookup = { code: string; status: "idle" | "loading" | "found" | "none" | "error"; options: WilayahEntry[] };
type Search = { status: "idle" | "loading" | "found" | "none" | "error"; results: WilayahEntry[] };

const NO_LOOKUP: Lookup = { code: "", status: "idle", options: [] };
const NO_SEARCH: Search = { status: "idle", results: [] };

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LETTERS = 3;
const OTHER = "__lainnya";
/** Option for a kelurahan the form holds that is not in the looked-up list (e.g. typed, then "Pilih dari daftar"). */
const CURRENT = "__current";

const letterCount = (q: string) => (q.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Index of the option the form's kelurahan stands for (kecamatan breaks a tie only when kecamatan differ), or -1. */
function optionIndex(options: WilayahEntry[], v: Pick<AddressValue, "kelurahan" | "kecamatan">): number {
  const differs = new Set(options.map((o) => o.kecamatan)).size > 1;
  return options.findIndex((o) => o.kelurahan === v.kelurahan && (!differs || o.kecamatan === v.kecamatan));
}

function lookupMessage(l: Lookup, manual: boolean, selected: boolean): string {
  switch (l.status) {
    case "loading":
      return "Mencari…";
    case "found":
      if (l.options.length === 1 || selected) return `Wilayah terisi dari kode pos ${l.code}. Silakan periksa.`;
      return manual ? "" : `${l.options.length} kelurahan untuk ${l.code} — pilih satu.`;
    case "none":
      return `Kode pos ${l.code} tidak ditemukan. Silakan isi manual.`;
    case "error":
      return "Pencarian kode pos tidak tersedia, silakan isi manual.";
    default:
      return "";
  }
}

function searchMessage(s: Search): string {
  switch (s.status) {
    case "loading":
      return "Mencari…";
    case "found":
      return `${s.results.length} hasil. Pilih salah satu.`;
    case "none":
      return "Tidak ditemukan. Coba nama lain atau isi manual.";
    case "error":
      return "Pencarian tidak tersedia, silakan isi manual.";
    default:
      return "";
  }
}

/** `section-student postal-code`: three address blocks on one page must not share one autofill section. */
function postalAutocomplete(idPrefix?: string): string {
  const section = (idPrefix ?? "").replace(/\.address$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return section ? `section-${section} postal-code` : "postal-code";
}

// ── field ─────────────────────────────────────────────────────────────────────

function AddressTextField({
  label, value, onChange, className, error, fieldKey, autoComplete, inputMode, inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  error?: string | null;
  fieldKey?: string;
  autoComplete?: string;
  inputMode?: "numeric";
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        ref={inputRef}
        value={value}
        className={INPUT_CLASS}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        data-field={fieldKey}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <FieldError id={errId}>{error}</FieldError>}
    </Field>
  );
}

export function AddressFields({ token, value, onChange, legend, idPrefix, showErrors }: AddressFieldsProps) {
  const uid = useId();
  const panelId = `${uid}-cari`;
  const searchInputId = `${uid}-cari-input`;
  const kelSelectId = `${uid}-kel-select`;

  // Latest props for async callbacks (a response lands after the render that started it).
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  /** The code whose answer we already hold (or are waiting for): never fetched twice in a row. */
  const doneCodeRef = useRef<string | null>(null);
  const lookupReqRef = useRef<{ id: number; code: string; controller: AbortController } | null>(null);
  const searchReqRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  /** Where focus goes once the kelurahan control swaps between text box and dropdown. */
  const focusAfterSwapRef = useRef<"input" | "select" | null>(null);
  const kelInputRef = useRef<HTMLInputElement>(null);
  const kelSelectRef = useRef<HTMLSelectElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const [lookup, setLookup] = useState<Lookup>(NO_LOOKUP);
  const [manual, setManual] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>(NO_SEARCH);

  useEffect(() => {
    const target = focusAfterSwapRef.current;
    if (!target) return;
    focusAfterSwapRef.current = null;
    (target === "input" ? kelInputRef : kelSelectRef).current?.focus();
  }, [manual]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const lookupReq = lookupReqRef;
    const searchReq = searchReqRef;
    const timer = searchTimerRef;
    return () => {
      lookupReq.current?.controller.abort();
      searchReq.current?.controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function emit(patch: Partial<AddressValue>) {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    onChangeRef.current(next);
  }

  /** Put an entry's region into the four boxes, replacing what they held. */
  function fillFrom(entry: WilayahEntry, opts: { kodePos?: boolean } = {}) {
    const patch: Partial<AddressValue> = {};
    for (const k of REGION_KEYS) patch[k] = entry[k];
    if (opts.kodePos) patch.kodePos = entry.kodePos;
    emit(patch);
  }

  /**
   * Several matches: keep what already stands for one of the options, otherwise
   * clear the kelurahan (the dropdown must not hide a value it does not list) and
   * any region box the options do not all agree with.
   */
  function reconcileWithOptions(options: WilayahEntry[]) {
    const current = valueRef.current;
    if (optionIndex(options, current) >= 0) return;
    const patch: Partial<AddressValue> = {};
    if (current.kelurahan !== "") patch.kelurahan = "";
    for (const k of ["kecamatan", "kotaKab", "provinsi"] as const) {
      if (current[k] !== "" && !options.every((o) => o[k] === current[k])) patch[k] = "";
    }
    if (Object.keys(patch).length > 0) emit(patch);
  }

  // ── kode pos ────────────────────────────────────────────────────────────────

  function startLookup(code: string) {
    lookupReqRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++seqRef.current;
    lookupReqRef.current = { id, code, controller };
    doneCodeRef.current = null;
    setManual(false);
    setLookup({ code, status: "loading", options: [] });
    void fetchRegion(token, "kodepos", code, controller.signal).then((res) => {
      if (lookupReqRef.current?.id !== id) return; // superseded or cancelled: ignore
      lookupReqRef.current = null;
      if (!res.ok) {
        setLookup({ code, status: "error", options: [] }); // not remembered, so retyping retries
        return;
      }
      doneCodeRef.current = code;
      if (res.results.length === 0) {
        setLookup({ code, status: "none", options: [] });
        return;
      }
      setLookup({ code, status: "found", options: res.results });
      if (res.results.length === 1) fillFrom(res.results[0]);
      else reconcileWithOptions(res.results);
    });
  }

  function onKodePosChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 5);
    emit({ kodePos: digits });
    if (digits.length < 5) {
      if (lookupReqRef.current) {
        lookupReqRef.current.controller.abort();
        lookupReqRef.current = null;
        doneCodeRef.current = null;
        setLookup(NO_LOOKUP);
      }
      return;
    }
    if (digits === doneCodeRef.current || digits === lookupReqRef.current?.code) return;
    startLookup(digits);
  }

  function onPickKelurahan(selected: string) {
    if (selected === OTHER) {
      focusAfterSwapRef.current = "input";
      setManual(true);
      return;
    }
    if (selected === CURRENT) return; // the value the form already holds
    const entry = selected === "" ? undefined : lookup.options[Number(selected)];
    if (!entry) {
      emit({ kelurahan: "" });
      return;
    }
    fillFrom(entry);
  }

  // ── name search ─────────────────────────────────────────────────────────────

  function cancelSearchWork() {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    searchReqRef.current?.controller.abort();
    searchReqRef.current = null;
  }

  function runSearch(q: string) {
    searchReqRef.current?.controller.abort();
    const controller = new AbortController();
    const id = ++seqRef.current;
    searchReqRef.current = { id, controller };
    setSearch({ status: "loading", results: [] });
    void fetchRegion(token, "q", q, controller.signal).then((res) => {
      if (searchReqRef.current?.id !== id) return;
      searchReqRef.current = null;
      if (!res.ok) setSearch({ status: "error", results: [] });
      else setSearch({ status: res.results.length ? "found" : "none", results: res.results });
    });
  }

  function onQueryChange(q: string) {
    setQuery(q);
    cancelSearchWork();
    if (letterCount(q) < MIN_SEARCH_LETTERS) {
      setSearch(NO_SEARCH);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      runSearch(q.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  function closeSearch() {
    cancelSearchWork();
    setSearchOpen(false);
    setQuery("");
    setSearch(NO_SEARCH);
  }

  function pickSearchResult(entry: WilayahEntry) {
    fillFrom(entry, { kodePos: true });
    closeSearch();
    toggleRef.current?.focus();
    // The normal kode pos lookup then runs for that code: one match re-fills the same values; several keep
    // the picked kelurahan selected (it is one of the options) and the other boxes as they are.
    startLookup(entry.kodePos);
  }

  function closeSearchToToggle() {
    closeSearch();
    toggleRef.current?.focus();
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSearchToToggle();
    } else if (e.key === "Enter" && e.target === searchInputRef.current) {
      e.preventDefault();
      // A single, current result is the answer; anything else keeps typing / choosing.
      const settled = searchTimerRef.current === null && searchReqRef.current === null;
      if (settled && search.status === "found" && search.results.length === 1) pickSearchResult(search.results[0]);
    }
  }

  function returnToList() {
    focusAfterSwapRef.current = "select";
    setManual(false);
  }

  // ── render ──────────────────────────────────────────────────────────────────

  const lookupVisible = lookup.code !== "" && lookup.code === value.kodePos;
  const showDropdown = lookupVisible && lookup.status === "found" && lookup.options.length > 1 && !manual;
  const canReturnToList = lookupVisible && lookup.status === "found" && lookup.options.length > 1 && manual;
  const status =
    searchOpen && search.status !== "idle"
      ? searchMessage(search)
      : lookupVisible
        ? lookupMessage(lookup, manual, optionIndex(lookup.options, value) >= 0)
        : "";

  const kecamatanDiffers = new Set(lookup.options.map((o) => o.kecamatan)).size > 1;
  const selectedIndex = optionIndex(lookup.options, value);
  // The select never hides what the form holds: an unlisted kelurahan gets an option of its own.
  const unlisted = value.kelurahan.trim() !== "" && selectedIndex < 0;

  const set = (k: keyof AddressValue) => (v: string) => emit({ [k]: v });
  const kodePosMsg = showErrors ? kodePosError(value) : null;

  return (
    <div role="group" aria-label={legend} className="grid gap-4 sm:grid-cols-2">
      <AddressTextField label="Perumahan / Jalan" className="sm:col-span-2" value={value.perumahan} onChange={set("perumahan")} />
      <AddressTextField label="Blok / Cluster" value={value.blokCluster} onChange={set("blokCluster")} />
      <AddressTextField label="RT / RW" value={value.rtRw} onChange={set("rtRw")} />
      <AddressTextField
        label="Kode pos"
        value={value.kodePos}
        onChange={onKodePosChange}
        inputMode="numeric"
        autoComplete={postalAutocomplete(idPrefix)}
        error={kodePosMsg}
        fieldKey={idPrefix ? `${idPrefix}.kodePos` : undefined}
      />

      <div className="space-y-2 sm:col-span-2">
        {/* One stable polite region for every lookup message; it stays mounted (empty) so changes are announced. */}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {status}
        </p>
        <Button
          ref={toggleRef}
          type="button"
          variant="link"
          className="h-11 px-0 text-base"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? panelId : undefined}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          {searchOpen ? "Tutup pencarian" : "Tidak tahu kode pos?"}
        </Button>
        {searchOpen && (
          <div id={panelId} className="space-y-3 rounded-xl border border-border bg-card p-3" onKeyDown={onSearchKeyDown}>
            <Field>
              <FieldLabel htmlFor={searchInputId}>Cari kelurahan atau kecamatan</FieldLabel>
              <Input
                id={searchInputId}
                ref={searchInputRef}
                value={query}
                className={INPUT_CLASS}
                autoComplete="off"
                enterKeyHint="search"
                onChange={(e) => onQueryChange(e.target.value)}
              />
            </Field>
            {search.results.length > 0 && (
              <ul aria-label="Hasil pencarian" className="max-h-72 space-y-2 overflow-y-auto">
                {search.results.map((r) => (
                  <li key={`${r.kodePos}|${r.kelurahan}|${r.kecamatan}`}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left text-base font-normal"
                      onClick={() => pickSearchResult(r)}
                    >
                      {`${r.kelurahan}, ${r.kecamatan} — ${r.kotaKab} (${r.kodePos})`}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showDropdown ? (
        <Field>
          <FieldLabel htmlFor={kelSelectId}>Kelurahan / Desa</FieldLabel>
          <NativeSelect
            id={kelSelectId}
            className="w-full"
            selectClassName={SELECT_CLASS}
            ref={kelSelectRef}
            value={unlisted ? CURRENT : selectedIndex >= 0 ? String(selectedIndex) : ""}
            onChange={(e) => onPickKelurahan(e.target.value)}
          >
            <NativeSelectOption value="">Pilih kelurahan / desa</NativeSelectOption>
            {unlisted && <NativeSelectOption value={CURRENT}>{value.kelurahan}</NativeSelectOption>}
            {lookup.options.map((o, i) => (
              <NativeSelectOption key={`${o.kelurahan}|${o.kecamatan}`} value={String(i)}>
                {kecamatanDiffers ? `${o.kelurahan} — ${o.kecamatan}` : o.kelurahan}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value={OTHER}>Lainnya (ketik sendiri)</NativeSelectOption>
          </NativeSelect>
        </Field>
      ) : (
        <div className="flex flex-col gap-1">
          <AddressTextField label="Kelurahan / Desa" value={value.kelurahan} onChange={set("kelurahan")} inputRef={kelInputRef} />
          {canReturnToList && (
            <Button type="button" variant="link" className="h-11 justify-start px-0 text-base" onClick={returnToList}>
              Pilih dari daftar
            </Button>
          )}
        </div>
      )}

      <AddressTextField label="Kecamatan" value={value.kecamatan} onChange={set("kecamatan")} />
      <AddressTextField label="Kota / Kabupaten" value={value.kotaKab} onChange={set("kotaKab")} />
      <AddressTextField label="Provinsi" value={value.provinsi} onChange={set("provinsi")} />
    </div>
  );
}
