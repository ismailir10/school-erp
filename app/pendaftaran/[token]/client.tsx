"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { SignaturePad } from "@/components/enrollment/signature-pad";
import { DocumentsStep, useDocumentUploads } from "@/components/enrollment/documents-step";
import {
  DOCUMENT_ITEMS,
  isDocumentKey,
  missingRequiredDocuments,
  missingUploads,
  type DocumentKey,
  type PublicDocuments,
} from "@/lib/enrollment/documents";
import {
  AGAMA_OPTIONS,
  KEWARGANEGARAAN_OPTIONS,
  LIVING_WITH_OPTIONS,
  BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS,
  BLOOD_TYPE_OPTIONS,
  EDUCATION_OPTIONS,
  OCCUPATION_OPTIONS,
  INCOME_OPTIONS,
  MAX_PRIOR_FAMILY_ATTENDEES,
  type Option,
} from "@/lib/enrollment/constants";
import {
  CONSENT_CLAUSES,
  CONSENT_INTRO,
  CONSENT_CLOSING,
  CONSENT_VERSION,
} from "@/lib/enrollment/consent-clauses";

type Program = { id: string; name: string };
type Prefill = {
  programId: string | null;
  dcareAddon: boolean;
  studentData: unknown;
  ayahData: unknown;
  ibuData: unknown;
  /** `{ agreed, ayah: {name, signed}, ibu: {name, signed} }` — never raw tokens. */
  consentData: unknown;
  documents: PublicDocuments;
};

type AddressState = { perumahan: string; blokCluster: string; rtRw: string; kecamatan: string; kodePos: string };
type ParentState = {
  name: string;
  birthPlace: string;
  dateOfBirth: string;
  agama: string;
  phone: string;
  email: string;
  address: AddressState;
  education: string;
  occupation: string;
  employerName: string;
  employerAddress: string;
  employerPhone: string;
  income: string;
};
type PriorFamily = { name: string; yearEntered: string };
type StudentState = {
  childName: string;
  nickname: string;
  childGender: "" | "L" | "P";
  birthPlace: string;
  dateOfBirth: string;
  agama: string;
  kewarganegaraan: string;
  bloodType: string;
  livingWith: string;
  birthDelivery: string;
  birthTerm: string;
  homeLanguage: string;
  foodAllergy: string;
  seriousIllness: string;
  weightKg: string;
  heightCm: string;
  headCircumferenceCm: string;
  siblingsKandung: string;
  siblingsTiri: string;
  siblingsAngkat: string;
  childOrder: string;
  siblingsTotal: string;
  address: AddressState;
  priorFamilyAttendees: PriorFamily[];
};
type ConsentState = {
  agreed: boolean;
  ayahName: string;
  ibuName: string;
  /** Signature PNGs live server-side; the browser only knows whether one is saved. */
  ayahSigned: boolean;
  ibuSigned: boolean;
};

const EMPTY_ADDR: AddressState = { perumahan: "", blokCluster: "", rtRw: "", kecamatan: "", kodePos: "" };
const EMPTY_PARENT: ParentState = {
  name: "", birthPlace: "", dateOfBirth: "", agama: "", phone: "", email: "",
  address: { ...EMPTY_ADDR }, education: "", occupation: "", employerName: "",
  employerAddress: "", employerPhone: "", income: "",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function initStudent(p: unknown): StudentState {
  const s = obj(p);
  const a = obj(s.address);
  const pf = Array.isArray(s.priorFamilyAttendees) ? (s.priorFamilyAttendees as unknown[]) : [];
  return {
    childName: str(s.childName), nickname: str(s.nickname), childGender: (s.childGender === "L" || s.childGender === "P" ? s.childGender : ""),
    birthPlace: str(s.birthPlace), dateOfBirth: str(s.dateOfBirth), agama: str(s.agama),
    kewarganegaraan: str(s.kewarganegaraan), bloodType: str(s.bloodType), livingWith: str(s.livingWith),
    birthDelivery: str(s.birthDelivery), birthTerm: str(s.birthTerm), homeLanguage: str(s.homeLanguage),
    foodAllergy: str(s.foodAllergy), seriousIllness: str(s.seriousIllness),
    weightKg: str(s.weightKg), heightCm: str(s.heightCm), headCircumferenceCm: str(s.headCircumferenceCm),
    siblingsKandung: str(s.siblingsKandung), siblingsTiri: str(s.siblingsTiri), siblingsAngkat: str(s.siblingsAngkat),
    childOrder: str(s.childOrder), siblingsTotal: str(s.siblingsTotal),
    address: { perumahan: str(a.perumahan), blokCluster: str(a.blokCluster), rtRw: str(a.rtRw), kecamatan: str(a.kecamatan), kodePos: str(a.kodePos) },
    priorFamilyAttendees: pf.slice(0, MAX_PRIOR_FAMILY_ATTENDEES).map((r) => ({ name: str(obj(r).name), yearEntered: str(obj(r).yearEntered) })),
  };
}
function initParent(p: unknown): ParentState {
  const s = obj(p);
  const a = obj(s.address);
  return {
    name: str(s.name), birthPlace: str(s.birthPlace), dateOfBirth: str(s.dateOfBirth), agama: str(s.agama),
    phone: str(s.phone), email: str(s.email),
    address: { perumahan: str(a.perumahan), blokCluster: str(a.blokCluster), rtRw: str(a.rtRw), kecamatan: str(a.kecamatan), kodePos: str(a.kodePos) },
    education: str(s.education), occupation: str(s.occupation), employerName: str(s.employerName),
    employerAddress: str(s.employerAddress), employerPhone: str(s.employerPhone), income: str(s.income),
  };
}
function initConsent(p: unknown): ConsentState {
  const c = obj(p);
  const ayah = obj(c.ayah);
  const ibu = obj(c.ibu);
  return {
    agreed: c.agreed === true,
    ayahName: str(ayah.name), ayahSigned: ayah.signed === true,
    ibuName: str(ibu.name), ibuSigned: ibu.signed === true,
  };
}

const STEPS = ["Data Anak", "Data Ayah", "Data Ibu", "Program", "Berkas", "Persetujuan", "Tinjau"] as const;
const STEP_CONSENT = 5;

export default function PendaftaranClient({
  token,
  programs,
  prefill,
  requiredDocuments = [],
}: {
  token: string;
  programs: Program[];
  prefill: Prefill;
  /** Documents the school requires uploaded before submit (empty = all optional). */
  requiredDocuments?: DocumentKey[];
}) {
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState<StudentState>(() => initStudent(prefill.studentData));
  const [ayah, setAyah] = useState<ParentState>(() => ({ ...EMPTY_PARENT, ...initParent(prefill.ayahData) }));
  const [ibu, setIbu] = useState<ParentState>(() => ({ ...EMPTY_PARENT, ...initParent(prefill.ibuData) }));
  const [programId, setProgramId] = useState(prefill.programId ?? "");
  const [dcareAddon, setDcareAddon] = useState(prefill.dcareAddon);
  const [consent, setConsent] = useState<ConsentState>(() => initConsent(prefill.consentData));
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // A signature POST in flight per parent. Moving on or submitting meanwhile
  // would close the row and the late POST would 409, silently losing it.
  const [sigSaving, setSigSaving] = useState({ ayah: false, ibu: false });
  // Owned here (not by the Berkas step) so an in-flight upload still shows as
  // busy if the parent steps away and comes back.
  const docs = useDocumentUploads(token, prefill.documents ?? {});
  // Keys the server rejected as missing count as required from then on, even
  // if the page was loaded before the school's list changed; otherwise Lanjut
  // would pass and the next submit would bounce again.
  const [serverRequired, setServerRequired] = useState<DocumentKey[]>([]);
  const required = [...new Set([...requiredDocuments, ...serverRequired])];
  // `requiredDocuments` defaults to a fresh [] each render; key the effect on
  // content so it doesn't re-run (and re-set errors) forever.
  const requiredKey = required.join(",");
  const documents = docs.documents;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePending = useRef(false);

  // Rebuilt every render; the ref lets the debounced timer (and the page-hide
  // flush) read the state as of *fire* time instead of the render that
  // scheduled them. The old `setX(v); scheduleSave()` closure sent the
  // previous keystroke's state.
  const buildPayload = () => {
    const cleanAddr = (a: AddressState) => ({ ...a });
    const cleanParent = (p: ParentState) => ({ ...p, address: cleanAddr(p.address) });
    return {
      programId,
      dcareAddon,
      studentData: {
        ...student,
        address: cleanAddr(student.address),
        priorFamilyAttendees: student.priorFamilyAttendees.filter((r) => r.name || r.yearEntered),
      },
      ayahData: cleanParent(ayah),
      ibuData: cleanParent(ibu),
      // Names only. Signature tokens are persisted by the signature route and
      // read from the row on submit; the draft PATCH ignores them anyway.
      consentData: {
        agreed: consent.agreed,
        version: CONSENT_VERSION,
        ayah: { name: consent.ayahName },
        ibu: { name: consent.ibuName },
      },
    };
  };
  const buildPayloadRef = useRef(buildPayload);
  useEffect(() => {
    buildPayloadRef.current = buildPayload;
  });

  const sendDraft = useCallback(
    (keepalive: boolean) => {
      savePending.current = false;
      void fetch(`/api/enrollments/token/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayloadRef.current()),
        keepalive,
      }).catch(() => undefined);
    },
    [token],
  );

  // Debounced autosave: fire-and-forget draft PATCH. Failures are silent;
  // the parent keeps editing and a later save (or final submit) recovers.
  const scheduleSave = useCallback(() => {
    savePending.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      sendDraft(false);
    }, 1200);
  }, [sendDraft]);

  // A pending edit must not die with the tab (mobile browsers kill it freely).
  useEffect(() => {
    function flush() {
      if (!savePending.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      sendDraft(true);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(); // unmount: don't leave a timer behind that reads a dead component
    };
  }, [sendDraft]);

  // Berkas-step messages for the given keys, in the order given.
  function documentErrors(keys: readonly DocumentKey[]): string[] {
    return keys.map((k) => `${DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k} wajib diunggah.`);
  }

  function validateStep(s: number): string[] {
    const e: string[] = [];
    if (s === 0) {
      if (!student.childName.trim()) e.push("Nama lengkap anak wajib diisi.");
      if (!student.childGender) e.push("Jenis kelamin wajib dipilih.");
      if (!student.birthPlace.trim()) e.push("Tempat lahir wajib diisi.");
      if (!student.dateOfBirth) e.push("Tanggal lahir wajib diisi.");
      if (!student.agama) e.push("Agama wajib dipilih.");
      if (!student.kewarganegaraan) e.push("Kewarganegaraan wajib dipilih.");
    }
    if (s === 1 && !ayah.name.trim()) e.push("Nama ayah wajib diisi.");
    if (s === 2 && !ibu.name.trim()) e.push("Nama ibu wajib diisi.");
    if (s === 3 && !programId) e.push("Program wajib dipilih.");
    // Step 4 (Berkas): only the school-configured required list blocks; the
    // rest stays optional.
    if (s === 4) e.push(...documentErrors(missingUploads(documents, required)));
    if (s === STEP_CONSENT) {
      if (!consent.agreed) e.push("Persetujuan orang tua wajib dicentang.");
      if (!consent.ayahName.trim()) e.push("Nama jelas ayah wajib diisi.");
      if (!consent.ayahSigned) e.push("Tanda tangan ayah wajib disimpan.");
      if (!consent.ibuName.trim()) e.push("Nama jelas ibu wajib diisi.");
      if (!consent.ibuSigned) e.push("Tanda tangan ibu wajib disimpan.");
    }
    return e;
  }

  // While the Berkas errors are showing, keep them honest: uploading (or
  // dropping) a file updates the list, and the Alert disappears once nothing
  // is left. An effect, not an upload callback, so it also covers the state
  // change from a rejected submit.
  useEffect(() => {
    if (step !== 4) return;
    setErrors((prev) =>
      prev.length === 0 ? prev : documentErrors(missingUploads(documents, required)),
    );
    // documentErrors only reads constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, documents, requiredKey]);

  function next() {
    if (step === STEP_CONSENT && (sigSaving.ayah || sigSaving.ibu)) return;
    const e = validateStep(step);
    if (e.length) {
      setErrors(e);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErrors([]);
    scheduleSave();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadSignature(which: "ayah" | "ibu", blob: Blob) {
    if (sigSaving[which]) return;
    setSigSaving((v) => ({ ...v, [which]: true }));
    const fd = new FormData();
    fd.append("file", blob, `${which}-signature.png`);
    try {
      const res = await fetch(`/api/enrollments/token/${token}/signature?which=${which}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        setGlobalError("Gagal menyimpan tanda tangan. Mohon coba lagi.");
        return;
      }
      // The route persists the token on the row itself and answers `{ saved: true }`.
      setConsent((c) => ({ ...c, ...(which === "ayah" ? { ayahSigned: true } : { ibuSigned: true }) }));
      setGlobalError(null);
    } catch {
      setGlobalError("Gagal menyimpan tanda tangan. Mohon coba lagi.");
    } finally {
      setSigSaving((v) => ({ ...v, [which]: false }));
    }
  }

  /**
   * Re-reads which signatures are on the row so a parent who signed from
   * another device shows up without a reload.
   */
  async function refreshSignatures(): Promise<"changed" | "unchanged" | "error"> {
    try {
      const res = await fetch(`/api/enrollments/token/${token}/signature`);
      if (!res.ok) return "error";
      const d = (await res.json()) as { ayah?: boolean; ibu?: boolean; ayahName?: string; ibuName?: string };
      const ayahSigned = d.ayah === true;
      const ibuSigned = d.ibu === true;
      // Fill a name the other parent typed elsewhere, but never overwrite what
      // is already typed here.
      const ayahName = !consent.ayahName && typeof d.ayahName === "string" ? d.ayahName : "";
      const ibuName = !consent.ibuName && typeof d.ibuName === "string" ? d.ibuName : "";
      const changed =
        ayahSigned !== consent.ayahSigned || ibuSigned !== consent.ibuSigned || !!ayahName || !!ibuName;
      if (changed) {
        setConsent((c) => ({
          ...c,
          ayahSigned,
          ibuSigned,
          ayahName: c.ayahName || ayahName,
          ibuName: c.ibuName || ibuName,
        }));
      }
      return changed ? "changed" : "unchanged";
    } catch {
      return "error";
    }
  }

  const uploadsInFlight = Object.keys(docs.busy).length;
  const signatureSavingNow = sigSaving.ayah || sigSaving.ibu;

  async function submit() {
    if (uploadsInFlight > 0 || signatureSavingNow) return; // late writes after submit would 409
    const all = [0, 1, 2, 3, 4, 5].flatMap(validateStep);
    if (all.length) {
      setErrors(all);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    setGlobalError(null);
    // A late draft PATCH after submit would only 409; don't send it.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    savePending.current = false;
    try {
      const res = await fetch(`/api/enrollments/token/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (res.status === 201) {
        setDone(true);
        return;
      }
      if (res.status === 422) {
        const d = (await res.json()) as { fields?: Record<string, string>; missingDocuments?: unknown };
        // The server's view of the files wins over this tab's: reset those
        // rows and send the parent to Berkas, where they can fix it.
        const gone = Array.isArray(d.missingDocuments) ? d.missingDocuments.filter(isDocumentKey) : [];
        if (gone.length > 0) {
          docs.markMissing(gone);
          setServerRequired((prev) => [...new Set([...prev, ...gone])]);
          setErrors(documentErrors(gone));
          setStep(4);
        } else {
          setErrors(Object.values(d.fields ?? { _: "Mohon periksa kembali isian formulir." }));
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        scheduleSave(); // submit failed: the latest edits must still reach the draft
        return;
      }
      if (res.status === 409) {
        setGlobalError("Formulir ini sudah diterima sebelumnya.");
        return;
      }
      setGlobalError("Gagal mengirim formulir. Mohon coba lagi.");
      scheduleSave();
    } catch {
      setGlobalError("Gagal mengirim formulir. Periksa koneksi lalu coba lagi.");
      scheduleSave();
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const missing = missingRequiredDocuments(documents);
    return (
      <div className="rounded-2xl border border-emerald-900/10 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto mb-3 text-emerald-600" size={44} />
        <h2 className="text-xl font-semibold text-emerald-950">Jazakumullah khairan, Bapak/Ibu</h2>
        <p className="mt-3 text-sm leading-relaxed text-emerald-900/70">
          Formulir pendaftaran ananda <strong>{student.childName}</strong> sudah kami terima. Tim
          penerimaan An Nisaa&apos; Sekolahku akan menghubungi Bapak/Ibu untuk proses selanjutnya.
        </p>
        {missing.length > 0 && (
          <div className="mt-5 rounded-xl border border-emerald-900/15 bg-emerald-50/50 p-4 text-left">
            <h3 className="text-sm font-semibold text-emerald-950">Berkas yang perlu dibawa ke sekolah</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900/80">
              {missing.map((k) => (
                <li key={k}>{DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {globalError && (
        <Alert variant="destructive">
          <AlertDescription>{globalError}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-2xl border border-emerald-900/10 bg-white p-5 shadow-sm sm:p-6">
        {step === 0 && <StudentStep value={student} onChange={(v) => { setStudent(v); scheduleSave(); }} />}
        {step === 1 && (
          <ParentStep title="Data Ayah" value={ayah} onChange={(v) => { setAyah(v); scheduleSave(); }} />
        )}
        {step === 2 && (
          <ParentStep title="Data Ibu" value={ibu} onChange={(v) => { setIbu(v); scheduleSave(); }} />
        )}
        {step === 3 && (
          <ProgramStep
            programs={programs}
            programId={programId}
            dcareAddon={dcareAddon}
            onProgram={(v) => { setProgramId(v); scheduleSave(); }}
            onDcare={(v) => { setDcareAddon(v); scheduleSave(); }}
          />
        )}
        {step === 4 && (
          <DocumentsStep
            documents={docs.documents}
            required={required}
            busy={docs.busy}
            errors={docs.errors}
            onUpload={docs.upload}
            onRemove={docs.remove}
          />
        )}
        {step === STEP_CONSENT && (
          <ConsentStep
            value={consent}
            onChange={(v) => { setConsent(v); scheduleSave(); }}
            onUpload={uploadSignature}
            saving={sigSaving}
            onRefresh={refreshSignatures}
          />
        )}
        {step === 6 && <ReviewStep student={student} ayah={ayah} ibu={ibu} programs={programs} programId={programId} dcareAddon={dcareAddon} consent={consent} documents={documents} uploading={uploadsInFlight} signatureSaving={signatureSavingNow} />}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={back} disabled={step === 0 || submitting}>
          Kembali
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={next}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={step === STEP_CONSENT && signatureSavingNow}
            aria-busy={step === STEP_CONSENT && signatureSavingNow}
          >
            {step === STEP_CONSENT && signatureSavingNow ? "Menyimpan tanda tangan…" : "Lanjut"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              if (!submitting && uploadsInFlight === 0 && !signatureSavingNow) void submit();
            }}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={submitting || uploadsInFlight > 0 || signatureSavingNow}
            aria-busy={submitting || uploadsInFlight > 0 || signatureSavingNow}
          >
            {submitting
              ? "Mengirim…"
              : uploadsInFlight > 0
                ? "Menunggu unggahan selesai…"
                : signatureSavingNow
                  ? "Menyimpan tanda tangan…"
                  : "Kirim Formulir"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={
            "rounded-full px-3 py-1 " +
            (i === step
              ? "bg-[#0C5C3F] text-white"
              : i < step
                ? "bg-emerald-100 text-emerald-800"
                : "bg-emerald-50 text-emerald-900/50")
          }
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function TextField({
  label, value, onChange, type = "text", placeholder, description, required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; description?: string; required?: boolean;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </FieldLabel>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function SelectField({
  label, value, onChange, options, required, placeholder = "Pilih…",
}: {
  label: string; value: string; onChange: (v: string) => void; options: Option[]; required?: boolean; placeholder?: string;
}) {
  return (
    <Field>
      <FieldLabel>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </FieldLabel>
      <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

function AddressFields({ value, onChange }: { value: AddressState; onChange: (v: AddressState) => void }) {
  const set = (k: keyof AddressState, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Perumahan" value={value.perumahan} onChange={(v) => set("perumahan", v)} />
      <TextField label="Blok / Cluster" value={value.blokCluster} onChange={(v) => set("blokCluster", v)} />
      <TextField label="RT / RW" value={value.rtRw} onChange={(v) => set("rtRw", v)} />
      <TextField label="Kecamatan" value={value.kecamatan} onChange={(v) => set("kecamatan", v)} />
      <TextField label="Kode Pos" value={value.kodePos} onChange={(v) => set("kodePos", v)} />
    </div>
  );
}

function StudentStep({ value, onChange }: { value: StudentState; onChange: (v: StudentState) => void }) {
  const set = <K extends keyof StudentState>(k: K, v: StudentState[K]) => onChange({ ...value, [k]: v });
  const setFamily = (i: number, k: keyof PriorFamily, v: string) => {
    const list = value.priorFamilyAttendees.slice();
    list[i] = { ...list[i], [k]: v };
    onChange({ ...value, priorFamilyAttendees: list });
  };
  const addFamily = () => {
    if (value.priorFamilyAttendees.length >= MAX_PRIOR_FAMILY_ATTENDEES) return;
    onChange({ ...value, priorFamilyAttendees: [...value.priorFamilyAttendees, { name: "", yearEntered: "" }] });
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">Data Anak</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama lengkap" value={value.childName} onChange={(v) => set("childName", v)} required />
        <TextField label="Nama panggilan" value={value.nickname} onChange={(v) => set("nickname", v)} />
        <SelectField label="Jenis kelamin" value={value.childGender} onChange={(v) => set("childGender", v as StudentState["childGender"])} options={[{ value: "L", label: "Laki-laki" }, { value: "P", label: "Perempuan" }]} required />
        <TextField label="Tempat lahir" value={value.birthPlace} onChange={(v) => set("birthPlace", v)} required />
        <TextField label="Tanggal lahir" type="date" value={value.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} required />
        <SelectField label="Agama" value={value.agama} onChange={(v) => set("agama", v)} options={AGAMA_OPTIONS} required />
        <SelectField label="Kewarganegaraan" value={value.kewarganegaraan} onChange={(v) => set("kewarganegaraan", v)} options={KEWARGANEGARAAN_OPTIONS} required />
        <SelectField label="Tinggal bersama" value={value.livingWith} onChange={(v) => set("livingWith", v)} options={LIVING_WITH_OPTIONS} />
        <TextField label="Bahasa sehari-hari di rumah" value={value.homeLanguage} onChange={(v) => set("homeLanguage", v)} />
      </div>

      <Separator />
      <h3 className="text-sm font-semibold text-emerald-900">Jumlah saudara</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Saudara kandung" type="number" value={value.siblingsKandung} onChange={(v) => set("siblingsKandung", v)} />
        <TextField label="Saudara tiri" type="number" value={value.siblingsTiri} onChange={(v) => set("siblingsTiri", v)} />
        <TextField label="Saudara angkat" type="number" value={value.siblingsAngkat} onChange={(v) => set("siblingsAngkat", v)} />
        <TextField label="Anak ke-" type="number" value={value.childOrder} onChange={(v) => set("childOrder", v)} />
        <TextField label="Dari (jumlah bersaudara)" type="number" value={value.siblingsTotal} onChange={(v) => set("siblingsTotal", v)} />
      </div>

      <Separator />
      <h3 className="text-sm font-semibold text-emerald-900">Alamat</h3>
      <AddressFields value={value.address} onChange={(v) => set("address", v)} />

      <Separator />
      <h3 className="text-sm font-semibold text-emerald-900">Kelahiran &amp; kesehatan</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Jalan lahir" value={value.birthDelivery} onChange={(v) => set("birthDelivery", v)} options={BIRTH_DELIVERY_OPTIONS} />
        <SelectField label="Bulan lahir" value={value.birthTerm} onChange={(v) => set("birthTerm", v)} options={BIRTH_TERM_OPTIONS} />
        <TextField label="Berat badan (kg)" type="number" value={value.weightKg} onChange={(v) => set("weightKg", v)} />
        <TextField label="Tinggi badan (cm)" type="number" value={value.heightCm} onChange={(v) => set("heightCm", v)} />
        <TextField label="Lingkar kepala (cm)" type="number" value={value.headCircumferenceCm} onChange={(v) => set("headCircumferenceCm", v)} />
        <SelectField label="Golongan darah" value={value.bloodType} onChange={(v) => set("bloodType", v)} options={BLOOD_TYPE_OPTIONS} />
      </div>
      <Field>
        <FieldLabel>Alergi makanan</FieldLabel>
        <Textarea value={value.foodAllergy} onChange={(e) => set("foodAllergy", e.target.value)} rows={2} />
      </Field>
      <Field>
        <FieldLabel>Penyakit berat yang pernah diderita</FieldLabel>
        <Textarea value={value.seriousIllness} onChange={(e) => set("seriousIllness", e.target.value)} rows={2} />
      </Field>

      <Separator />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-emerald-900">Keluarga yang pernah bersekolah di An Nisaa&apos;</h3>
        <Button type="button" variant="outline" size="sm" onClick={addFamily} disabled={value.priorFamilyAttendees.length >= MAX_PRIOR_FAMILY_ATTENDEES}>
          Tambah
        </Button>
      </div>
      {value.priorFamilyAttendees.map((row, i) => (
        <div key={i} className="grid gap-4 sm:grid-cols-2">
          <TextField label={`Nama (${i + 1})`} value={row.name} onChange={(v) => setFamily(i, "name", v)} />
          <TextField label="Tahun masuk" value={row.yearEntered} onChange={(v) => setFamily(i, "yearEntered", v)} />
        </div>
      ))}
    </div>
  );
}

function ParentStep({ title, value, onChange }: { title: string; value: ParentState; onChange: (v: ParentState) => void }) {
  const set = <K extends keyof ParentState>(k: K, v: ParentState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama" value={value.name} onChange={(v) => set("name", v)} required />
        <TextField label="Tempat lahir" value={value.birthPlace} onChange={(v) => set("birthPlace", v)} />
        <TextField label="Tanggal lahir" type="date" value={value.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} />
        <SelectField label="Agama" value={value.agama} onChange={(v) => set("agama", v)} options={AGAMA_OPTIONS} />
        <TextField label="No. HP" type="tel" value={value.phone} onChange={(v) => set("phone", v)} />
        <TextField label="Email" type="email" value={value.email} onChange={(v) => set("email", v)} />
        <SelectField label="Pendidikan terakhir" value={value.education} onChange={(v) => set("education", v)} options={EDUCATION_OPTIONS} />
        <SelectField label="Pekerjaan" value={value.occupation} onChange={(v) => set("occupation", v)} options={OCCUPATION_OPTIONS} />
        <SelectField label="Penghasilan" value={value.income} onChange={(v) => set("income", v)} options={INCOME_OPTIONS} />
      </div>
      <Separator />
      <h3 className="text-sm font-semibold text-emerald-900">Alamat</h3>
      <AddressFields value={value.address} onChange={(v) => set("address", v)} />
      <Separator />
      <h3 className="text-sm font-semibold text-emerald-900">Pekerjaan</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama kantor" value={value.employerName} onChange={(v) => set("employerName", v)} />
        <TextField label="Telepon kantor" type="tel" value={value.employerPhone} onChange={(v) => set("employerPhone", v)} />
      </div>
      <Field>
        <FieldLabel>Alamat kantor</FieldLabel>
        <Textarea value={value.employerAddress} onChange={(e) => set("employerAddress", e.target.value)} rows={2} />
      </Field>
    </div>
  );
}

function ProgramStep({
  programs, programId, dcareAddon, onProgram, onDcare,
}: {
  programs: Program[]; programId: string; dcareAddon: boolean; onProgram: (v: string) => void; onDcare: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">Pilihan Program</h2>
      <Field>
        <FieldLabel>
          Program <span className="text-destructive">*</span>
        </FieldLabel>
        <NativeSelect className="w-full" value={programId} onChange={(e) => onProgram(e.target.value)}>
          <NativeSelectOption value="">Pilih program…</NativeSelectOption>
          {programs.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {programs.length === 0 && <FieldError>Belum ada program tersedia. Mohon hubungi sekolah.</FieldError>}
      </Field>
      <label className="flex items-center gap-3 rounded-xl border border-emerald-900/15 bg-white p-3">
        <Checkbox checked={dcareAddon} onCheckedChange={(c) => onDcare(c === true)} />
        <span className="text-sm text-emerald-950">Tambahan Dcare (penitipan)</span>
      </label>
    </div>
  );
}

function ConsentStep({
  value, onChange, onUpload, onRefresh, saving,
}: {
  value: ConsentState;
  onChange: (v: ConsentState) => void;
  onUpload: (which: "ayah" | "ibu", blob: Blob) => void;
  saving: { ayah: boolean; ibu: boolean };
  onRefresh: () => Promise<"changed" | "unchanged" | "error">;
}) {
  const set =<K extends keyof ConsentState>(k: K, v: ConsentState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">Surat Persetujuan Orang Tua</h2>
      <p className="text-sm text-emerald-900/70">{CONSENT_INTRO}</p>
      <ol className="list-decimal space-y-2 rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-4 pl-8 text-sm text-emerald-900/90">
        {CONSENT_CLAUSES.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ol>
      <p className="text-sm font-medium text-emerald-950">{CONSENT_CLOSING}</p>

      <label className="flex items-start gap-3 rounded-xl border border-emerald-900/15 bg-white p-3">
        <Checkbox checked={value.agreed} onCheckedChange={(c) => set("agreed", c === true)} className="mt-0.5" />
        <span className="text-sm text-emerald-950">
          Kami sudah membaca, memahami, dan menyetujui seluruh isi surat persetujuan ini.
        </span>
      </label>

      <Separator />
      {/* Above the pads so it is on screen right after the first parent saves. */}
      <HandoverNote ayahSigned={value.ayahSigned} ibuSigned={value.ibuSigned} onRefresh={onRefresh} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <TextField label="Nama jelas Ayah" value={value.ayahName} onChange={(v) => set("ayahName", v)} required />
          <SignaturePad label="Tanda tangan Ayah" saved={value.ayahSigned} saving={saving.ayah} onSave={(b) => onUpload("ayah", b)} />
        </div>
        <div className="space-y-2">
          <TextField label="Nama jelas Ibu" value={value.ibuName} onChange={(v) => set("ibuName", v)} required />
          <SignaturePad label="Tanda tangan Ibu" saved={value.ibuSigned} saving={saving.ibu} onSave={(b) => onUpload("ibu", b)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when exactly one parent has signed: the other can open the same link
 * on their own device. Signatures persist on the server the moment they are
 * saved, so nothing the first parent did is lost.
 */
function HandoverNote({
  ayahSigned, ibuSigned, onRefresh,
}: {
  ayahSigned: boolean; ibuSigned: boolean; onRefresh: () => Promise<"changed" | "unchanged" | "error">;
}) {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (fallbackUrl) urlRef.current?.select();
  }, [fallbackUrl]);

  const exactlyOne = ayahSigned !== ibuSigned;
  const missing = ayahSigned ? "Ibu" : "Ayah";

  async function copy() {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setFallbackUrl(null);
      setStatus("Link disalin.");
    } catch {
      setFallbackUrl(href);
      setStatus("Salin link dari kolom di bawah.");
    }
  }

  async function check() {
    if (checking) return;
    setChecking(true);
    setStatus("");
    const r = await onRefresh();
    setChecking(false);
    // The note (and this button) may unmount once the signature is found.
    // Park focus on the status line, which stays mounted, before that happens.
    if (r === "changed") statusRef.current?.focus();
    setStatus(
      r === "changed"
        ? "Tanda tangan terbaru sudah dimuat."
        : r === "unchanged"
          ? "Belum ada tanda tangan baru."
          : "Gagal memeriksa. Periksa koneksi lalu coba lagi.",
    );
  }

  return (
    <div className="space-y-2">
      {exactlyOne && (
        <Alert role="region" aria-label="Tanda tangan yang belum ada">
          <AlertTitle>Tanda tangan {missing} belum ada</AlertTitle>
          <AlertDescription>
            <p>
              Jika {missing} berada di tempat lain, bagikan link formulir ini. Data yang sudah diisi
              tersimpan otomatis, dan tanda tangan {ayahSigned ? "Ayah" : "Ibu"} tidak akan hilang.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={copy}>
                <Copy size={14} aria-hidden /> Salin link
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8" onClick={check} aria-disabled={checking} aria-busy={checking}>
                <RefreshCw size={14} aria-hidden className={checking ? "animate-spin" : undefined} />{" "}
                {checking ? "Memeriksa…" : "Periksa lagi"}
              </Button>
            </div>
            {fallbackUrl && (
              <Input
                ref={urlRef}
                readOnly
                aria-label="Link formulir"
                value={fallbackUrl}
                className="mt-3"
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </AlertDescription>
        </Alert>
      )}
      {/* Stable live region so repeated results are announced. */}
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={status ? "text-sm text-emerald-900/80 outline-none" : "sr-only"}
      >
        {status}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-emerald-900/60">{label}</span>
      <span className="text-right font-medium text-emerald-950">{value}</span>
    </div>
  );
}

function ReviewStep({
  student, ayah, ibu, programs, programId, dcareAddon, consent, documents, uploading, signatureSaving,
}: {
  student: StudentState; ayah: ParentState; ibu: ParentState; programs: Program[];
  programId: string; dcareAddon: boolean; consent: ConsentState; documents: PublicDocuments; uploading: number; signatureSaving: boolean;
}) {
  const programName = programs.find((p) => p.id === programId)?.name ?? "—";
  const uploaded = Object.keys(documents).length;
  const missing = missingRequiredDocuments(documents).map(
    (k) => DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k,
  );
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">Tinjau &amp; Kirim</h2>
      <p className="text-sm text-emerald-900/70">
        Mohon periksa kembali data berikut sebelum mengirim. Setelah dikirim, data tidak dapat
        diubah sendiri — hubungi sekolah bila ada koreksi.
      </p>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-emerald-900">Data Anak</h3>
        <Row label="Nama lengkap" value={student.childName} />
        <Row label="Jenis kelamin" value={student.childGender === "L" ? "Laki-laki" : student.childGender === "P" ? "Perempuan" : ""} />
        <Row label="Tempat, tanggal lahir" value={[student.birthPlace, student.dateOfBirth].filter(Boolean).join(", ")} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-emerald-900">Orang Tua</h3>
        <Row label="Ayah" value={ayah.name} />
        <Row label="Ibu" value={ibu.name} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-emerald-900">Program</h3>
        <Row label="Program" value={programName} />
        <Row label="Dcare" value={dcareAddon ? "Ya" : ""} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-emerald-900">Berkas</h3>
        <Row label="Berkas terunggah" value={String(uploaded)} />
        {uploading > 0 && (
          <>
            <Row label="Sedang diunggah" value={String(uploading)} />
            <p role="status" className="py-1 text-sm text-emerald-900/80">
              Masih ada berkas yang sedang diunggah. Mohon tunggu sebentar.
            </p>
          </>
        )}
        {missing.length > 0 ? (
          <p className="py-1 text-sm text-emerald-900/80">
            Belum diunggah — mohon dibawa ke sekolah: {missing.join(", ")}
          </p>
        ) : (
          <p className="py-1 text-sm text-emerald-900/80">Semua berkas wajib sudah diunggah.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-emerald-900">Persetujuan</h3>
        <Row label="Disetujui" value={consent.agreed ? "Ya" : "Belum"} />
        <Row label="Tanda tangan Ayah" value={consent.ayahSigned ? "Tersimpan" : "Belum"} />
        <Row label="Tanda tangan Ibu" value={consent.ibuSigned ? "Tersimpan" : "Belum"} />
        {signatureSaving && (
          <p role="status" className="py-1 text-sm text-emerald-900/80">
            Tanda tangan sedang disimpan. Mohon tunggu sebentar.
          </p>
        )}
      </section>
    </div>
  );
}
