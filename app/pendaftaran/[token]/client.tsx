"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Check, Copy, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { BlurText } from "@/components/reactbits/blur-text";
import { DrawCheck } from "@/components/reactbits/draw-check";
import { Stagger, StaggerItem } from "@/components/reactbits/stagger";
import { StepTransition } from "@/components/reactbits/step-transition";
import { usePrefersReducedMotion } from "@/components/reactbits/use-prefers-reduced-motion";
import { SignaturePad } from "@/components/enrollment/signature-pad";
import { DocumentsStep, useDocumentUploads } from "@/components/enrollment/documents-step";
import { AddressFields, EMPTY_ADDRESS, addressFromBlob, kodePosError, type AddressValue } from "@/components/enrollment/address-fields";
import { AREA_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/components/enrollment/field-styles";
import { formatAddress } from "@/lib/enrollment/address";
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
  CONSENT_VERSION,
} from "@/lib/enrollment/consent-clauses";
import { formatDateShort, formatRupiah } from "@/lib/format";
import { computeEnrollmentFee } from "@/lib/enrollment/fee";
import {
  STEPS,
  STEP_CONSENT,
  describeServerIssue,
  isWaived,
  parentContactIssues,
  resumeStep,
  stepLabel,
  type ContactFieldKey,
  type OnlyParent,
  type ParentSide,
} from "./form-logic";
import { BringList, withoutWaivedParentDocs } from "./bring-list";
import { PaymentPanel } from "./payment-panel";
import type { PublicFeeView } from "@/lib/enrollment/fee-view";

// `code` + `enrollmentFee` price the pendaftaran fee shown on Tinjau; the
// server recomputes it on submit and never trusts what this form displays.
type Program = { id: string; name: string; code?: string; enrollmentFee?: number };
type Prefill = {
  programId: string | null;
  dcareAddon: boolean;
  studentData: unknown;
  ayahData: unknown;
  ibuData: unknown;
  /** `{ agreed, version, ayah: {name, signed}, ibu: {name, signed} }` — never raw tokens. */
  consentData: unknown;
  documents: PublicDocuments;
};

type ParentState = {
  name: string;
  birthPlace: string;
  dateOfBirth: string;
  agama: string;
  phone: string;
  email: string;
  address: AddressValue;
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
  address: AddressValue;
  priorFamilyAttendees: PriorFamily[];
};
type ConsentState = {
  agreed: boolean;
  ayahName: string;
  ibuName: string;
  /** Signature PNGs live server-side; the browser only knows whether one is saved. */
  ayahSigned: boolean;
  ibuSigned: boolean;
  /** R2-P-10: the one parent / wali filling alone ("" = both parents). Saved inside consentData. */
  onlyParent: OnlyParent;
};

const EMPTY_PARENT: ParentState = {
  name: "", birthPlace: "", dateOfBirth: "", agama: "", phone: "", email: "",
  address: { ...EMPTY_ADDRESS }, education: "", occupation: "", employerName: "",
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
    address: addressFromBlob(s.address),
    priorFamilyAttendees: pf.slice(0, MAX_PRIOR_FAMILY_ATTENDEES).map((r) => ({ name: str(obj(r).name), yearEntered: str(obj(r).yearEntered) })),
  };
}
function initParent(p: unknown): ParentState {
  const s = obj(p);
  return {
    name: str(s.name), birthPlace: str(s.birthPlace), dateOfBirth: str(s.dateOfBirth), agama: str(s.agama),
    phone: str(s.phone), email: str(s.email),
    address: addressFromBlob(s.address),
    education: str(s.education), occupation: str(s.occupation), employerName: str(s.employerName),
    employerAddress: str(s.employerAddress), employerPhone: str(s.employerPhone), income: str(s.income),
  };
}
function initConsent(p: unknown): ConsentState {
  const c = obj(p);
  const ayah = obj(c.ayah);
  const ibu = obj(c.ibu);
  return {
    // The tick belongs to the letter the parent saw. A draft saved under another
    // version (or none) must be ticked again on the current wording; names,
    // signatures and onlyParent stay as stored.
    agreed: c.agreed === true && c.version === CONSENT_VERSION,
    ayahName: str(ayah.name), ayahSigned: ayah.signed === true,
    ibuName: str(ibu.name), ibuSigned: ibu.signed === true,
    onlyParent: c.onlyParent === "ayah" || c.onlyParent === "ibu" ? c.onlyParent : "",
  };
}

/** `data-field` of an input the form can flag and focus: a parent contact, or the kode pos of an address block. */
type AddressFieldKey = "student.address.kodePos" | "ayah.address.kodePos" | "ibu.address.kodePos";
type FieldKey = ContactFieldKey | AddressFieldKey;
type FieldIssue = { key: FieldKey; message: string };

/** A malformed kode pos is the only address rule; everything else in the address is optional. */
function kodePosIssues(key: AddressFieldKey, a: AddressValue): FieldIssue[] {
  const message = kodePosError(a);
  return message ? [{ key, message }] : [];
}

/** Every flaggable input on a parent step that fails, in on-screen order (contacts, address, office phone). */
function parentFieldIssues(side: ParentSide, p: ParentState): FieldIssue[] {
  const contact = parentContactIssues(side, p);
  return [
    ...contact.filter((c) => c.key !== `${side}.employerPhone`),
    ...kodePosIssues(`${side}.address.kodePos`, p.address),
    ...contact.filter((c) => c.key === `${side}.employerPhone`),
  ];
}

/**
 * One line in the step alert. `step` is set for issues that belong to another
 * step (a rejected submit); the alert then offers a button that jumps there.
 */
type FormIssue = { text: string; step?: number; field?: FieldKey };

const plain = (texts: string[]): FormIssue[] => texts.map((text) => ({ text }));
const sameIssues = (a: FormIssue[], b: FormIssue[]) =>
  a.length === b.length && a.every((x, i) => x.text === b[i].text && x.step === b[i].step);

// Public-form controls: 44px / 16px, scoped here so the shared ui/* stay as-is.
// Press feedback is pure CSS: a compositor-only transform, off under reduced motion. The Button base
// already has transition-all, which covers `scale`; adding transition-transform here would drop its
// colour and ring easing. aria-disabled buttons stay put, because they read as unavailable.
const BTN_CLASS =
  "h-11 min-w-28 px-5 text-base motion-safe:active:scale-[0.97] aria-disabled:active:scale-100";
// The shared Button fill (#5DB4B8 + dark text) reads as disabled on a white card; --primary-text carries
// white text at >= 4.5:1. Same pairing as the /daftar CTA.
const PRIMARY_CLASS =
  "bg-primary-text text-white hover:bg-primary-text/90 aria-disabled:pointer-events-none aria-disabled:opacity-50";

export default function PendaftaranClient({
  token,
  programs,
  prefill,
  requiredDocuments = [],
  initialStep,
}: {
  token: string;
  programs: Program[];
  prefill: Prefill;
  /** Documents the school requires uploaded before submit (empty = all optional). */
  requiredDocuments?: DocumentKey[];
  /** Overrides the resume calculation (tests). */
  initialStep?: number;
}) {
  // The draft stores no step index, so a returning parent resumes at the first
  // step that still lacks required data rather than tapping through from 1.
  const [startStep] = useState(
    () =>
      initialStep ??
      resumeStep({
        student: initStudent(prefill.studentData),
        ayah: initParent(prefill.ayahData),
        ibu: initParent(prefill.ibuData),
        programId: prefill.programId ?? "",
        documents: prefill.documents ?? {},
        requiredDocuments,
        consent: initConsent(prefill.consentData),
      }),
  );
  const [step, setStep] = useState(startStep);
  // Direction of travel for the step transition: +1 forward, -1 when going back or jumping to an
  // earlier step. Derived during render from the previous step (React's "adjust state on prop change"
  // pattern), so it is right on the very render that swaps the step, whoever called setStep.
  const [prevStep, setPrevStep] = useState(startStep);
  const [direction, setDirection] = useState<1 | -1>(1);
  if (step !== prevStep) {
    setPrevStep(step);
    setDirection(step < prevStep ? -1 : 1);
  }
  // Furthest step reached; the stepper lets the parent tap back to any of them.
  const [reached, setReached] = useState(startStep);
  const [student, setStudent] = useState<StudentState>(() => initStudent(prefill.studentData));
  const [ayah, setAyah] = useState<ParentState>(() => ({ ...EMPTY_PARENT, ...initParent(prefill.ayahData) }));
  const [ibu, setIbu] = useState<ParentState>(() => ({ ...EMPTY_PARENT, ...initParent(prefill.ibuData) }));
  const [programId, setProgramId] = useState(prefill.programId ?? "");
  const [dcareAddon, setDcareAddon] = useState(prefill.dcareAddon);
  const [consent, setConsent] = useState<ConsentState>(() => initConsent(prefill.consentData));
  const [errors, setErrors] = useState<FormIssue[]>([]);
  // Contact inputs whose format error is showing. The message itself is derived
  // from the current value, so it clears the moment the parent corrects it.
  const [flagged, setFlagged] = useState<FieldKey[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The pendaftaran fee the server priced at submit; null when the program is free.
  const [fee, setFee] = useState<PublicFeeView | null>(null);
  // The consent letter's reveal (stagger) plays the first time this visit reaches the step,
  // not again after Kembali or a jump. ConsentStep reports in once it has mounted.
  const [consentSeen, setConsentSeen] = useState(false);
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
    const cleanAddr = (a: AddressValue) => ({ ...a });
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
        // Omitted (not "") when both parents fill, so the draft blob carries no stale flag.
        ...(consent.onlyParent ? { onlyParent: consent.onlyParent } : {}),
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
    if (s === 1 && !isWaived(consent.onlyParent, "ayah") && !ayah.name.trim()) e.push("Nama ayah wajib diisi.");
    if (s === 2 && !isWaived(consent.onlyParent, "ibu") && !ibu.name.trim()) e.push("Nama ibu wajib diisi.");
    if (s === 3 && !programId) e.push("Program wajib dipilih.");
    // Step 4 (Berkas): only the school-configured required list blocks; the
    // rest stays optional.
    if (s === 4) e.push(...documentErrors(missingUploads(documents, required)));
    if (s === STEP_CONSENT) {
      if (!consent.agreed) e.push("Persetujuan orang tua wajib dicentang.");
      if (!isWaived(consent.onlyParent, "ayah")) {
        if (!consent.ayahName.trim()) e.push("Nama jelas ayah wajib diisi.");
        if (!consent.ayahSigned) e.push("Tanda tangan ayah wajib disimpan.");
      }
      if (!isWaived(consent.onlyParent, "ibu")) {
        if (!consent.ibuName.trim()) e.push("Nama jelas ibu wajib diisi.");
        if (!consent.ibuSigned) e.push("Tanda tangan ibu wajib disimpan.");
      }
    }
    return e;
  }

  // Inputs with a format rule (phone, email, kode pos): flagged inline and focused, not listed in the alert.
  function contactIssuesFor(s: number): FieldIssue[] {
    if (s === 0) return kodePosIssues("student.address.kodePos", student.address);
    if (s === 1 && !isWaived(consent.onlyParent, "ayah")) return parentFieldIssues("ayah", ayah);
    if (s === 2 && !isWaived(consent.onlyParent, "ibu")) return parentFieldIssues("ibu", ibu);
    return [];
  }

  // While a step's required-field alert is showing, keep it honest: fixing (or
  // uploading) something updates the list, and the Alert disappears once nothing
  // is left. An effect, not an onChange callback, so it also covers the state
  // change from a rejected submit. Issues that belong to other steps (a rejected
  // submit) are left alone; they clear when their step is opened.
  useEffect(() => {
    if (step > STEP_CONSENT) return;
    setErrors((prev) => {
      if (!prev.some((i) => i.step === undefined)) return prev;
      const next = [...plain(validateStep(step)), ...prev.filter((i) => i.step !== undefined)];
      return sameIssues(prev, next) ? prev : next;
    });
    // validateStep/documentErrors read the state listed here and constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, student, ayah, ibu, programId, consent, documents, requiredKey]);

  function focusField(key: FieldKey) {
    document.querySelector<HTMLElement>(`[data-field="${key}"]`)?.focus();
  }

  /** Open a step without validating the current one (stepper, "Buka langkah"). */
  function go(i: number, flag: FieldKey[] = []) {
    // Drop the alert lines for the step being left and the one being opened;
    // lines for other steps stay so the parent can still jump to them.
    setErrors((prev) => prev.filter((x) => x.step !== undefined && x.step !== i));
    setFlagged(flag);
    setStep(i);
    setReached((r) => Math.max(r, i));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (step === STEP_CONSENT && (sigSaving.ayah || sigSaving.ibu)) return;
    const e = validateStep(step);
    const contact = contactIssuesFor(step);
    if (e.length || contact.length) {
      setErrors(plain(e));
      setFlagged(contact.map((c) => c.key));
      if (contact.length) focusField(contact[0].key);
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErrors([]);
    setFlagged([]);
    scheduleSave();
    const to = Math.min(step + 1, STEPS.length - 1);
    setStep(to);
    setReached((r) => Math.max(r, to));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setErrors([]);
    setFlagged([]);
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
    // A parent can reach Tinjau by tapping the stepper without ever pressing
    // Lanjut on a step, so name the step and offer a way back to it.
    const all: FormIssue[] = [0, 1, 2, 3, 4, 5].flatMap((s) => [
      ...validateStep(s).map((text) => ({ text: `${stepLabel(s)} — ${text}`, step: s })),
      ...contactIssuesFor(s).map((c) => ({ text: `${stepLabel(s)} — ${c.message}`, step: s, field: c.key })),
    ]);
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
        // The submit succeeded whatever the body says; a missing or odd `fee`
        // just means no payment step is shown (the thank-you card still is).
        const created = (await res.json().catch(() => null)) as { fee?: { baseAmount?: unknown; amount?: unknown } | null } | null;
        const amount = Number(created?.fee?.amount);
        if (created?.fee && Number.isFinite(amount) && amount > 0) {
          const base = Number(created.fee.baseAmount);
          setFee({
            amount,
            baseAmount: Number.isFinite(base) && base >= amount ? base : amount,
            discountPercent: 0,
            status: "UNPAID",
            paidAt: null,
            started: false,
          });
        }
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
          setErrors(plain(documentErrors(gone)));
          setStep(4);
          setReached((r) => Math.max(r, 4));
        } else {
          // Name the step ("Langkah 2 · Data Ayah — …") and keep a way back to it.
          const entries = Object.entries(d.fields ?? {});
          const issues: FormIssue[] = entries.map(([path, message]) => {
            const x = describeServerIssue(path, message);
            return x.step === null ? { text: x.text } : { text: x.text, step: x.step, field: x.field };
          });
          setErrors(issues.length ? issues : plain(["Mohon periksa kembali isian formulir."]));
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
    const missing = withoutWaivedParentDocs(missingRequiredDocuments(documents), consent.onlyParent);
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <DrawCheck size={56} className="mx-auto mb-3 text-primary-text" />
        <BlurText as="h2" text="Jazakumullah khairan, Bapak/Ibu" className="text-xl font-semibold text-foreground" />
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Formulir pendaftaran ananda <strong>{student.childName}</strong> sudah kami terima. Tim
          penerimaan An Nisaa&apos; Sekolahku akan menghubungi Bapak/Ibu untuk proses selanjutnya.
        </p>
        {fee && (
          <div className="mt-5">
            {/* The card's own heading is an h2, so the panel sits one level below it. */}
            <PaymentPanel token={token} childName={student.childName} fee={fee} headingLevel={3} />
          </div>
        )}
        <BringList keys={missing} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Stepper step={step} reached={reached} onGo={(i) => go(i)} />

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.text}
                  {e.step !== undefined && e.step !== step && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                        onClick={() => go(e.step as number, e.field ? [e.field] : [])}
                      >
                        Buka langkah {e.step + 1}
                      </button>
                    </>
                  )}
                </li>
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

      {/* overflow-x-clip: the 12px enter slide must not add transient horizontal scroll on phones. The
          card's own padding keeps input focus rings inside the clip. */}
      <div className="overflow-x-clip rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <StepTransition stepKey={step} direction={direction}>
        {step === 0 && <StudentStep token={token} flagged={flagged} value={student} onChange={(v) => { setStudent(v); scheduleSave(); }} />}
        {step === 1 && (
          <ParentStep
            title="Data Ayah" side="ayah" token={token} flagged={flagged} value={ayah} onChange={(v) => { setAyah(v); scheduleSave(); }}
            onlyParent={consent.onlyParent} onOnlyParent={(v) => { setConsent((c) => ({ ...c, onlyParent: v })); scheduleSave(); }}
          />
        )}
        {step === 2 && (
          <ParentStep
            title="Data Ibu" side="ibu" token={token} flagged={flagged} value={ibu} onChange={(v) => { setIbu(v); scheduleSave(); }}
            onlyParent={consent.onlyParent} onOnlyParent={(v) => { setConsent((c) => ({ ...c, onlyParent: v })); scheduleSave(); }}
          />
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
            reveal={!consentSeen}
            onRevealed={() => setConsentSeen(true)}
          />
        )}
        {step === 6 && <ReviewStep student={student} ayah={ayah} ibu={ibu} programs={programs} programId={programId} dcareAddon={dcareAddon} consent={consent} documents={documents} uploading={uploadsInFlight} signatureSaving={signatureSavingNow} />}
        </StepTransition>
      </div>

      {/* Phones and desktop alike: step 1 has one full-width action, later steps split the row. */}
      <div className="grid grid-cols-2 gap-3">
        {step > 0 && (
          <Button type="button" variant="outline" className={BTN_CLASS} onClick={back} disabled={submitting}>
            Kembali
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={next}
            className={cn(BTN_CLASS, PRIMARY_CLASS, step === 0 && "col-span-2")}
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
            className={cn(BTN_CLASS, PRIMARY_CLASS)}
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
      <p className="text-center text-xs text-muted-foreground">
        Data ananda kami jaga sesuai{" "}
        <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-text underline underline-offset-2">
          Kebijakan Privasi
        </a>{" "}
        dan{" "}
        <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-text underline underline-offset-2">
          Syarat &amp; Ketentuan
        </a>{" "}
        (terbuka di tab baru).
      </p>
    </div>
  );
}

function Stepper({ step, reached, onGo }: { step: number; reached: number; onGo: (i: number) => void }) {
  const reduced = usePrefersReducedMotion();
  // Steps already completed when the form opened (resumed draft) show their check at rest; only a step
  // completed during this visit pops.
  const [openedAt] = useState(step);
  const progress = (step + 1) / STEPS.length;
  const listRef = useRef<HTMLOListElement>(null);
  // Phones scroll one row of pills sideways; keep the current step centred in it.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo?.({
      left: current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [step, reduced]);
  return (
    <div className="space-y-3">
      {/* Phones: where you are in words. Decorative twin of the list below. */}
      <p aria-hidden="true" className="flex items-baseline justify-between gap-3 text-sm sm:hidden">
        <span className="font-semibold text-foreground">
          Langkah {step + 1} dari {STEPS.length}
        </span>
        <span className="text-muted-foreground">{STEPS[step]}</span>
      </p>
      {/* Decorative: the list below carries the state for assistive tech. scaleX, never width. */}
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-border">
        <motion.div
          data-testid="stepper-progress"
          data-step={step}
          className="h-full origin-left rounded-full bg-primary-text"
          initial={false}
          animate={{ scaleX: progress }}
          transition={reduced ? { duration: 0 } : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {/* One row at every width: a sideways-scrolling strip on phones, seven equal columns from `sm`. */}
      <ol
        ref={listRef}
        aria-label="Langkah formulir"
        className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-7 sm:gap-1.5 sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {STEPS.map((label, i) => {
          const pill = cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
            "sm:h-full sm:w-full sm:flex-col sm:gap-0.5 sm:rounded-lg sm:px-1.5 sm:py-1.5 sm:text-center sm:text-xs sm:leading-tight sm:whitespace-normal",
          );
          const text = `${i + 1}. ${label}`;
          const item = "shrink-0 sm:flex sm:min-w-0 sm:shrink";
          if (i === step) {
            return (
              <li key={label} aria-current="step" className={item}>
                <span className={cn(pill, "border-transparent bg-primary-text font-medium text-white")}>{text}</span>
              </li>
            );
          }
          if (i <= reached) {
            const completed = i < step;
            // Already-visited steps are real buttons: bordered, darker text, focus ring.
            return (
              <li key={label} className={item}>
                <button
                  type="button"
                  onClick={() => onGo(i)}
                  className={cn(
                    pill,
                    "border-primary-text/40 bg-primary/10 font-medium text-foreground hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary-text focus-visible:ring-offset-2 focus-visible:outline-none [@media(pointer:coarse)]:min-h-11",
                  )}
                >
                  {completed && (
                    <motion.span
                      aria-hidden="true"
                      className="inline-flex shrink-0 text-primary-text"
                      initial={reduced || i < openedAt ? false : { scale: 0.4 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <Check className="size-3.5 sm:size-3" aria-hidden="true" />
                    </motion.span>
                  )}
                  {text}
                </button>
              </li>
            );
          }
          return (
            <li key={label} className={item}>
              <span className={cn(pill, "border-transparent bg-muted text-muted-foreground")}>{text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TextField({
  label, value, onChange, type = "text", placeholder, description, required, error, fieldKey, className,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; description?: string; required?: boolean;
  /** Format error to show under the input. */
  error?: string | null;
  /** `data-field` hook so the form can focus this input. */
  fieldKey?: string;
  /** Layout hook for the field wrapper (e.g. `sm:col-span-2` to fill an odd row). */
  className?: string;
}) {
  const id = useId();
  const descId = `${id}-desc`;
  const errId = `${id}-err`;
  const describedBy = [description ? descId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        className={INPUT_CLASS}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        data-field={fieldKey}
        onChange={(e) => onChange(e.target.value)}
      />
      {description && <FieldDescription id={descId}>{description}</FieldDescription>}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </Field>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} className={AREA_CLASS} value={value} onChange={(e) => onChange(e.target.value)} rows={2} />
    </Field>
  );
}

function SelectField({
  label, value, onChange, options, required, placeholder = "Pilih…", className,
}: {
  label: string; value: string; onChange: (v: string) => void; options: Option[]; required?: boolean; placeholder?: string;
  /** Layout hook for the field wrapper (e.g. `sm:col-span-2` to fill an odd row). */
  className?: string;
}) {
  const id = useId();
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </FieldLabel>
      <NativeSelect
        id={id}
        className="w-full"
        selectClassName={SELECT_CLASS}
        aria-required={required || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
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

function StudentStep({
  token, flagged, value, onChange,
}: {
  token: string; flagged: FieldKey[]; value: StudentState; onChange: (v: StudentState) => void;
}) {
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
      <h2 className="text-lg font-semibold text-foreground">Data Anak</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama lengkap" value={value.childName} onChange={(v) => set("childName", v)} required />
        <TextField label="Nama panggilan" value={value.nickname} onChange={(v) => set("nickname", v)} />
        <SelectField label="Jenis kelamin" value={value.childGender} onChange={(v) => set("childGender", v as StudentState["childGender"])} options={[{ value: "L", label: "Laki-laki" }, { value: "P", label: "Perempuan" }]} required />
        <TextField label="Tempat lahir" value={value.birthPlace} onChange={(v) => set("birthPlace", v)} required />
        <TextField label="Tanggal lahir" type="date" value={value.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} required />
        <SelectField label="Agama" value={value.agama} onChange={(v) => set("agama", v)} options={AGAMA_OPTIONS} required />
        <SelectField label="Kewarganegaraan" value={value.kewarganegaraan} onChange={(v) => set("kewarganegaraan", v)} options={KEWARGANEGARAAN_OPTIONS} required />
        <SelectField label="Tinggal bersama" value={value.livingWith} onChange={(v) => set("livingWith", v)} options={LIVING_WITH_OPTIONS} />
        <TextField label="Bahasa sehari-hari di rumah" className="sm:col-span-2" value={value.homeLanguage} onChange={(v) => set("homeLanguage", v)} />
      </div>

      <Separator />
      <h3 className="text-sm font-semibold text-foreground">Jumlah saudara</h3>
      {/* Short numeric fields: three across, then two across, so a phone does not scroll five full-width boxes. */}
      <div className="grid grid-cols-3 items-end gap-3 sm:gap-4">
        <TextField label="Saudara kandung" type="number" value={value.siblingsKandung} onChange={(v) => set("siblingsKandung", v)} />
        <TextField label="Saudara tiri" type="number" value={value.siblingsTiri} onChange={(v) => set("siblingsTiri", v)} />
        <TextField label="Saudara angkat" type="number" value={value.siblingsAngkat} onChange={(v) => set("siblingsAngkat", v)} />
      </div>
      <div className="grid grid-cols-2 items-end gap-3 sm:gap-4">
        <TextField label="Anak ke-" type="number" value={value.childOrder} onChange={(v) => set("childOrder", v)} />
        <TextField label="Dari (jumlah bersaudara)" type="number" value={value.siblingsTotal} onChange={(v) => set("siblingsTotal", v)} />
      </div>

      <Separator />
      <h3 className="text-sm font-semibold text-foreground">Alamat</h3>
      <AddressFields
        token={token}
        legend="Alamat anak"
        idPrefix="student.address"
        showErrors={flagged.includes("student.address.kodePos")}
        value={value.address}
        onChange={(v) => set("address", v)}
      />

      <Separator />
      <h3 className="text-sm font-semibold text-foreground">Kelahiran &amp; kesehatan</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Jalan lahir" value={value.birthDelivery} onChange={(v) => set("birthDelivery", v)} options={BIRTH_DELIVERY_OPTIONS} />
        <SelectField label="Bulan lahir" value={value.birthTerm} onChange={(v) => set("birthTerm", v)} options={BIRTH_TERM_OPTIONS} />
        <TextField label="Berat badan (kg)" type="number" value={value.weightKg} onChange={(v) => set("weightKg", v)} />
        <TextField label="Tinggi badan (cm)" type="number" value={value.heightCm} onChange={(v) => set("heightCm", v)} />
        <TextField label="Lingkar kepala (cm)" type="number" value={value.headCircumferenceCm} onChange={(v) => set("headCircumferenceCm", v)} />
        <SelectField label="Golongan darah" value={value.bloodType} onChange={(v) => set("bloodType", v)} options={BLOOD_TYPE_OPTIONS} />
      </div>
      <TextAreaField label="Alergi makanan" value={value.foodAllergy} onChange={(v) => set("foodAllergy", v)} />
      <TextAreaField label="Penyakit berat yang pernah diderita" value={value.seriousIllness} onChange={(v) => set("seriousIllness", v)} />

      <Separator />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Keluarga yang pernah bersekolah di An Nisaa&apos;</h3>
        <Button type="button" variant="outline" size="sm" className="h-11 px-4 text-base" onClick={addFamily} disabled={value.priorFamilyAttendees.length >= MAX_PRIOR_FAMILY_ATTENDEES}>
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

/**
 * R2-P-10: lets a single-parent / wali-only family finish the form. Ticking it on
 * one parent's step waives that parent (name, contact checks, consent name and
 * signature); the other step then shows a note with a way to undo it.
 */
function SingleParentToggle({
  side, onlyParent, onChange,
}: {
  side: ParentSide; onlyParent: OnlyParent; onChange: (v: OnlyParent) => void;
}) {
  const other: ParentSide = side === "ayah" ? "ibu" : "ayah";
  if (onlyParent === side) {
    return (
      <div className="space-y-1 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
        <p>
          Hanya satu orang tua / wali yang mengisi, jadi data {other} dilewati.
        </p>
        <Button type="button" variant="link" className="h-11 px-0 text-base" onClick={() => onChange("")}>
          Isi data {other} juga
        </Button>
      </div>
    );
  }
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card p-3">
      <Checkbox
        className="mt-0.5 size-5"
        checked={onlyParent === other}
        onCheckedChange={(c) => onChange(c === true ? other : "")}
      />
      <span className="text-sm text-foreground">
        <span className="font-medium">Hanya satu orang tua / wali yang mengisi</span>
        <span className="mt-0.5 block text-muted-foreground">
          Centang bila tidak ada data {side}, misalnya orang tua tunggal. Bila wali yang mengisi, isi data wali
          di langkah Data {other === "ayah" ? "Ayah" : "Ibu"}.
        </span>
      </span>
    </label>
  );
}

function ParentStep({
  title, side, token, flagged, value, onChange, onlyParent, onOnlyParent,
}: {
  title: string; side: ParentSide; token: string; flagged: FieldKey[]; value: ParentState; onChange: (v: ParentState) => void;
  onlyParent: OnlyParent; onOnlyParent: (v: OnlyParent) => void;
}) {
  const set = <K extends keyof ParentState>(k: K, v: ParentState[K]) => onChange({ ...value, [k]: v });
  // Only inputs the parent has already been told about show a message, and it
  // follows the current value, so correcting the field clears it immediately.
  const issues = parentContactIssues(side, value);
  const err = (k: "phone" | "email" | "employerPhone") => {
    const key: ContactFieldKey = `${side}.${k}`;
    return flagged.includes(key) ? (issues.find((i) => i.key === key)?.message ?? null) : null;
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <SingleParentToggle side={side} onlyParent={onlyParent} onChange={onOnlyParent} />
      {!isWaived(onlyParent, side) && (
        <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama" value={value.name} onChange={(v) => set("name", v)} required />
        <TextField label="Tempat lahir" value={value.birthPlace} onChange={(v) => set("birthPlace", v)} />
        <TextField label="Tanggal lahir" type="date" value={value.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} />
        <SelectField label="Agama" value={value.agama} onChange={(v) => set("agama", v)} options={AGAMA_OPTIONS} />
        <TextField label="No. HP" type="tel" value={value.phone} onChange={(v) => set("phone", v)} error={err("phone")} fieldKey={`${side}.phone`} />
        <TextField label="Email" type="email" value={value.email} onChange={(v) => set("email", v)} error={err("email")} fieldKey={`${side}.email`} />
        <SelectField label="Pendidikan terakhir" value={value.education} onChange={(v) => set("education", v)} options={EDUCATION_OPTIONS} />
        <SelectField label="Pekerjaan" value={value.occupation} onChange={(v) => set("occupation", v)} options={OCCUPATION_OPTIONS} />
        <SelectField label="Penghasilan" className="sm:col-span-2" value={value.income} onChange={(v) => set("income", v)} options={INCOME_OPTIONS} />
      </div>
      <Separator />
      <h3 className="text-sm font-semibold text-foreground">Alamat</h3>
      <AddressFields
        token={token}
        legend={side === "ayah" ? "Alamat Ayah" : "Alamat Ibu"}
        idPrefix={`${side}.address`}
        showErrors={flagged.includes(`${side}.address.kodePos`)}
        value={value.address}
        onChange={(v) => set("address", v)}
      />
      <Separator />
      <h3 className="text-sm font-semibold text-foreground">Pekerjaan</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nama kantor" value={value.employerName} onChange={(v) => set("employerName", v)} />
        <TextField label="Telepon kantor" type="tel" value={value.employerPhone} onChange={(v) => set("employerPhone", v)} error={err("employerPhone")} fieldKey={`${side}.employerPhone`} />
      </div>
      <TextAreaField label="Alamat kantor" value={value.employerAddress} onChange={(v) => set("employerAddress", v)} />
        </>
      )}
    </div>
  );
}

function ProgramStep({
  programs, programId, dcareAddon, onProgram, onDcare,
}: {
  programs: Program[]; programId: string; dcareAddon: boolean; onProgram: (v: string) => void; onDcare: (v: boolean) => void;
}) {
  const programSelectId = useId();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Pilihan Program</h2>
      <Field>
        <FieldLabel htmlFor={programSelectId}>
          Program <span className="text-destructive" aria-hidden>*</span>
        </FieldLabel>
        <NativeSelect
          id={programSelectId}
          className="w-full"
          selectClassName={SELECT_CLASS}
          aria-required
          aria-describedby={programs.length === 0 ? `${programSelectId}-err` : undefined}
          value={programId}
          onChange={(e) => onProgram(e.target.value)}
        >
          <NativeSelectOption value="">Pilih program…</NativeSelectOption>
          {programs.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {programs.length === 0 && <FieldError id={`${programSelectId}-err`}>Belum ada program tersedia. Mohon hubungi sekolah.</FieldError>}
      </Field>
      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card p-3">
        <Checkbox className="size-5" checked={dcareAddon} onCheckedChange={(c) => onDcare(c === true)} />
        <span className="text-sm text-foreground">Tambahan Dcare (penitipan)</span>
      </label>
    </div>
  );
}

const subscribeNoop = () => () => {};

function ConsentStep({
  value, onChange, onUpload, onRefresh, saving, reveal: revealProp = false, onRevealed,
}: {
  value: ConsentState;
  onChange: (v: ConsentState) => void;
  onUpload: (which: "ayah" | "ibu", blob: Blob) => void;
  saving: { ayah: boolean; ibu: boolean };
  onRefresh: () => Promise<"changed" | "unchanged" | "error">;
  /** First arrival at this step in this visit: play the clause reveal. */
  reveal?: boolean;
  /** Called once after mount so the parent can switch `reveal` off for later visits to the step. */
  onRevealed?: () => void;
}) {
  // Captured at mount so the parent flipping `reveal` off mid-animation cannot cut the reveal short.
  // Off while hydrating (a hard load straight onto this step shows the letter at once, like Stagger) and
  // under reduced motion, so the page is the same static letter as before.
  const isHydrating = useSyncExternalStore(subscribeNoop, () => false, () => true);
  const reduced = usePrefersReducedMotion();
  const [reveal] = useState(() => revealProp && !isHydrating && !reduced);
  useEffect(() => {
    onRevealed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once, on mount
  }, []);
  const set =<K extends keyof ConsentState>(k: K, v: ConsentState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Surat Persetujuan Orang Tua</h2>
      <p className="text-sm text-muted-foreground">{CONSENT_INTRO}</p>
      <Stagger
        as="ol"
        count={CONSENT_CLAUSES.length}
        enabled={reveal}
        data-reveal={reveal ? "true" : "false"}
        className="list-decimal space-y-2 rounded-xl border border-border bg-muted p-4 pl-8 text-sm text-foreground"
      >
        {CONSENT_CLAUSES.map((c, i) => (
          <StaggerItem key={i} as="li">
            {c}
          </StaggerItem>
        ))}
      </Stagger>

      {/* The checkbox sentence is the closing statement; saying it twice only added scroll. */}
      <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card p-3">
        <Checkbox checked={value.agreed} onCheckedChange={(c) => set("agreed", c === true)} className="mt-0.5 size-5" />
        <span className="text-sm text-foreground">
          Kami sudah membaca, memahami, dan menyetujui seluruh isi surat persetujuan ini.
        </span>
      </label>

      <Separator />
      {/* Above the pads so it is on screen right after the first parent saves. */}
      {/* Nobody to hand over to when only one parent / wali signs. */}
      <HandoverNote ayahSigned={value.ayahSigned} ibuSigned={value.ibuSigned} onRefresh={onRefresh} single={value.onlyParent !== ""} />
      <div className={value.onlyParent ? "grid gap-5" : "grid gap-5 sm:grid-cols-2"}>
        {!isWaived(value.onlyParent, "ayah") && (
          <div className="space-y-2">
            <TextField label="Nama jelas Ayah" value={value.ayahName} onChange={(v) => set("ayahName", v)} required />
            <SignaturePad label="Tanda tangan Ayah" saved={value.ayahSigned} saving={saving.ayah} onSave={(b) => onUpload("ayah", b)} />
          </div>
        )}
        {!isWaived(value.onlyParent, "ibu") && (
          <div className="space-y-2">
            <TextField label="Nama jelas Ibu" value={value.ibuName} onChange={(v) => set("ibuName", v)} required />
            <SignaturePad label="Tanda tangan Ibu" saved={value.ibuSigned} saving={saving.ibu} onSave={(b) => onUpload("ibu", b)} />
          </div>
        )}
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
  ayahSigned, ibuSigned, onRefresh, single = false,
}: {
  ayahSigned: boolean; ibuSigned: boolean; onRefresh: () => Promise<"changed" | "unchanged" | "error">;
  /** One parent / wali signs alone: there is no other parent to wait for. */
  single?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (fallbackUrl) urlRef.current?.select();
  }, [fallbackUrl]);

  const exactlyOne = !single && ayahSigned !== ibuSigned;
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
              <Button type="button" variant="outline" size="sm" className="h-11 px-4 text-base" onClick={copy}>
                <Copy size={14} aria-hidden /> Salin link
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-11 px-4 text-base aria-disabled:pointer-events-none aria-disabled:opacity-50" onClick={check} aria-disabled={checking} aria-busy={checking}>
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
                className={INPUT_CLASS + " mt-3"}
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
        className={status ? "text-sm text-muted-foreground outline-none" : "sr-only"}
      >
        {status}
      </p>
    </div>
  );
}

/** The date input yields `YYYY-MM-DD`; the review step reads it as "15 Mar 2022". */
function reviewDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDateShort(value) : value;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
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
  const fee = computeEnrollmentFee({
    programs: programs.map((p) => ({ id: p.id, code: p.code ?? "", enrollmentFee: p.enrollmentFee ?? 0 })),
    programId,
    dcareAddon,
  });
  const uploaded = Object.keys(documents).length;
  const missing = missingRequiredDocuments(documents).map(
    (k) => DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k,
  );
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Tinjau &amp; Kirim</h2>
      <p className="text-sm text-muted-foreground">
        Mohon periksa kembali data berikut sebelum mengirim. Setelah dikirim, data tidak dapat
        diubah sendiri — hubungi sekolah bila ada koreksi.
      </p>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Data Anak</h3>
        <Row label="Nama lengkap" value={student.childName} />
        <Row label="Jenis kelamin" value={student.childGender === "L" ? "Laki-laki" : student.childGender === "P" ? "Perempuan" : ""} />
        <Row label="Tempat, tanggal lahir" value={[student.birthPlace, reviewDate(student.dateOfBirth)].filter(Boolean).join(", ")} />
        <Row label="Alamat" value={formatAddress(student.address) ?? ""} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Orang Tua</h3>
        {!isWaived(consent.onlyParent, "ayah") && (
          <>
            <Row label="Ayah" value={ayah.name} />
            <Row label="Alamat Ayah" value={formatAddress(ayah.address) ?? ""} />
          </>
        )}
        {!isWaived(consent.onlyParent, "ibu") && (
          <>
            <Row label="Ibu" value={ibu.name} />
            <Row label="Alamat Ibu" value={formatAddress(ibu.address) ?? ""} />
          </>
        )}
        {consent.onlyParent && <Row label="Pengisi" value="Satu orang tua / wali" />}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Program</h3>
        <Row label="Program" value={programName} />
        <Row label="Day Care" value={dcareAddon ? "Ya" : ""} />
      </section>
      {fee.amount > 0 && (
        <section aria-label="Biaya pendaftaran">
          <h3 className="mb-1 text-sm font-semibold text-foreground">Biaya pendaftaran</h3>
          <Row label={programName} value={formatRupiah(fee.programFee)} />
          <Row label="Tambahan Day Care" value={fee.dcareAddonFee > 0 ? formatRupiah(fee.dcareAddonFee) : ""} />
          <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 text-sm">
            <span className="font-medium text-foreground">Total</span>
            <span className="text-right text-base font-semibold text-foreground tabular-nums">{formatRupiah(fee.amount)}</span>
          </div>
          <p className="py-1 text-sm text-muted-foreground">
            Biaya dibayar setelah formulir dikirim, lewat halaman pembayaran DOKU. Bapak/Ibu bisa
            membayarnya nanti dengan tautan yang sama.
          </p>
        </section>
      )}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Berkas</h3>
        <Row label="Berkas terunggah" value={String(uploaded)} />
        {uploading > 0 && (
          <>
            <Row label="Sedang diunggah" value={String(uploading)} />
            <p role="status" className="py-1 text-sm text-muted-foreground">
              Masih ada berkas yang sedang diunggah. Mohon tunggu sebentar.
            </p>
          </>
        )}
        {missing.length > 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Belum diunggah — mohon dibawa ke sekolah: {missing.join(", ")}
          </p>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">Semua berkas wajib sudah diunggah.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Persetujuan</h3>
        <Row label="Disetujui" value={consent.agreed ? "Ya" : "Belum"} />
        {!isWaived(consent.onlyParent, "ayah") && <Row label="Tanda tangan Ayah" value={consent.ayahSigned ? "Tersimpan" : "Belum"} />}
        {!isWaived(consent.onlyParent, "ibu") && <Row label="Tanda tangan Ibu" value={consent.ibuSigned ? "Tersimpan" : "Belum"} />}
        {signatureSaving && (
          <p role="status" className="py-1 text-sm text-muted-foreground">
            Tanda tangan sedang disimpan. Mohon tunggu sebentar.
          </p>
        )}
      </section>
    </div>
  );
}
