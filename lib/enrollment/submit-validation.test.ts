import { describe, it, expect } from "vitest";
import { submitEnrollmentSchema, flattenSubmitErrors, STAFF_EDITABLE_KEYS } from "./submit-validation";
import { CONSENT_VERSION } from "./consent-clauses";

const PROGRAM_ID = "c" + "a".repeat(24); // valid cuid shape

function validPayload() {
  return {
    programId: PROGRAM_ID,
    dcareAddon: true,
    studentData: {
      childName: "Aisyah Putri",
      childGender: "P",
      birthPlace: "Bekasi",
      dateOfBirth: "2021-03-15",
      agama: "ISLAM",
      kewarganegaraan: "WNI",
      bloodType: "O",
      livingWith: "ORANG_TUA",
      weightKg: 14,
      heightCm: 95,
      siblingsKandung: 2,
      childOrder: 1,
      address: { perumahan: "Taman Aster", kecamatan: "Cikarang Barat", kodePos: "17530" },
      priorFamilyAttendees: [{ name: "Kakak Putri", yearEntered: "2023" }],
    },
    ayahData: {
      name: "Bapak Ahmad",
      agama: "ISLAM",
      phone: "081234567890",
      email: "ahmad@example.com",
      education: "S1_D4",
      occupation: "KARYAWAN_SWASTA",
      income: "4793_7000",
    },
    ibuData: {
      name: "Ibu Fatimah",
      agama: "ISLAM",
      education: "SMA",
      occupation: "LAINNYA",
    },
    consentData: {
      agreed: true,
      version: CONSENT_VERSION,
      ayah: { name: "Bapak Ahmad", signatureToken: "supabase:v1:enrollment/abc/ayah-sig-0011.png" },
      ibu: { name: "Ibu Fatimah", signatureToken: "supabase:v1:enrollment/abc/ibu-sig-0022.png" },
    },
  };
}

describe("submitEnrollmentSchema", () => {
  it("accepts a valid full payload", () => {
    const result = submitEnrollmentSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentData.childName).toBe("Aisyah Putri");
      expect(result.data.dcareAddon).toBe(true);
      expect(result.data.studentData.priorFamilyAttendees).toHaveLength(1);
    }
  });

  it("defaults dcareAddon to false when omitted", () => {
    const p = validPayload();
    delete (p as Record<string, unknown>).dcareAddon;
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dcareAddon).toBe(false);
  });

  it("rejects missing required child name", () => {
    const p = validPayload();
    p.studentData.childName = "";
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs["studentData.childName"]).toBe("Nama lengkap anak wajib diisi");
    }
  });

  it("caps height at 250 cm and weight at 200 kg with Indonesian messages (ADM-14)", () => {
    const p = validPayload();
    (p.studentData as Record<string, unknown>).heightCm = 9999;
    (p.studentData as Record<string, unknown>).weightKg = 201;
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs["studentData.heightCm"]).toBe("Tinggi maksimal 250 cm");
      expect(errs["studentData.weightKg"]).toBe("Berat maksimal 200 kg");
    }
  });

  it("accepts the ceilings themselves, string input from the form, and blanks", () => {
    const p = validPayload();
    (p.studentData as Record<string, unknown>).heightCm = "250";
    (p.studentData as Record<string, unknown>).weightKg = 200;
    expect(submitEnrollmentSchema.safeParse(p).success).toBe(true);
    (p.studentData as Record<string, unknown>).heightCm = "";
    (p.studentData as Record<string, unknown>).weightKg = "";
    expect(submitEnrollmentSchema.safeParse(p).success).toBe(true);
  });

  it("rejects a bad option value (agama not in set)", () => {
    const p = validPayload();
    p.studentData.agama = "ATHEIS";
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs["studentData.agama"]).toBe("Pilih agama");
    }
  });

  it("rejects a bad income bracket on a parent block", () => {
    const p = validPayload();
    p.ayahData.income = "999_billion";
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(flattenSubmitErrors(result.error)["ayahData.income"]).toBe("Penghasilan tidak valid");
    }
  });

  it("rejects when consent is not agreed", () => {
    const p = validPayload();
    (p.consentData as { agreed: boolean }).agreed = false;
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(flattenSubmitErrors(result.error)["consentData.agreed"]).toBe(
        "Persetujuan orang tua wajib dicentang",
      );
    }
  });

  it("rejects a missing parent signature (dual-signature requirement)", () => {
    const p = validPayload();
    p.consentData.ibu.signatureToken = "";
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(flattenSubmitErrors(result.error)["consentData.ibu.signatureToken"]).toBe(
        "Tanda tangan wajib diisi",
      );
    }
  });

  it("rejects a stale consent version", () => {
    const p = validPayload();
    p.consentData.version = "annisaa-2025-v0";
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(flattenSubmitErrors(result.error)["consentData.version"]).toBe(
        "Versi surat persetujuan kedaluwarsa — muat ulang halaman",
      );
    }
  });

  it("accepts a prefixed (non-cuid) programId — prod Program ids aren't all cuid()-shaped", () => {
    const p = { ...validPayload(), programId: "program_ab57fd0432e25d5b3013" };
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.programId).toBe("program_ab57fd0432e25d5b3013");
    }
  });

  describe("address keys", () => {
    const full = {
      perumahan: "Jl. Citarum 5", blokCluster: "B", rtRw: "01/02", kelurahan: "Citarum",
      kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat", kodePos: "40115",
    };
    const withAddress = (address: Record<string, unknown>) => {
      const p = validPayload() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      p.studentData.address = address;
      p.ayahData.address = address;
      return submitEnrollmentSchema.safeParse(p);
    };

    it("accepts and keeps kelurahan, kotaKab and provinsi for the child and a parent", () => {
      const r = withAddress(full);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.studentData.address).toEqual(full);
        expect(r.data.ayahData?.address).toEqual(full);
      }
    });

    it("still accepts an old five-key address", () => {
      const r = withAddress({ perumahan: "Taman Aster", blokCluster: "A3", rtRw: "02/05", kecamatan: "Cikarang", kodePos: "17530" });
      expect(r.success).toBe(true);
    });

    it("strips unknown address keys", () => {
      const r = withAddress({ ...full, negara: "ID", tenantId: "evil" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.studentData.address).toEqual(full);
    });

    it("stays lenient on kode pos so an old draft never blocks submit (the form enforces 5 digits)", () => {
      expect(withAddress({ kodePos: "4011" }).success).toBe(true);
      expect(withAddress({ kodePos: "x".repeat(11) }).success).toBe(false);
    });

    it("caps the new keys", () => {
      expect(withAddress({ kelurahan: "k".repeat(81) }).success).toBe(false);
      expect(withAddress({ kotaKab: "k".repeat(81) }).success).toBe(false);
      expect(withAddress({ provinsi: "p".repeat(61) }).success).toBe(false);
      expect(withAddress({ kelurahan: "k".repeat(80), kotaKab: "k".repeat(80), provinsi: "p".repeat(60) }).success).toBe(true);
    });

    it("makes them staff-editable", () => {
      expect(STAFF_EDITABLE_KEYS.address).toEqual(expect.arrayContaining(["kelurahan", "kotaKab", "provinsi"]));
    });
  });

  it("strips unknown server-owned keys (status, tenantId)", () => {
    const p = { ...validPayload(), status: "ACCEPTED", tenantId: "evil", accessToken: "x" };
    const result = submitEnrollmentSchema.safeParse(p);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("status" in result.data).toBe(false);
      expect("tenantId" in result.data).toBe(false);
    }
  });

  // R2-P-10: a single parent / wali may fill the form alone.
  describe("onlyParent (single parent / wali)", () => {
    function onlyIbuPayload() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payload is mutated freely
      const p = validPayload() as Record<string, any>;
      delete p.ayahData;
      delete p.consentData.ayah;
      p.consentData.onlyParent = "ibu";
      return p;
    }

    it("accepts only the ibu's block, name and signature when ayah is waived", () => {
      const result = submitEnrollmentSchema.safeParse(onlyIbuPayload());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.consentData.onlyParent).toBe("ibu");
    });

    // The parent form always sends BOTH blocks (`ayahData: { name: "", … }`), so a
    // waived side arrives as a blank object, not as a missing key. It must be
    // ignored, not validated: this is what the real client submits.
    it("ignores a waived parent's blank block, as the form sends it", () => {
      const p = onlyIbuPayload();
      p.ayahData = { name: "", phone: "", email: "", address: { perumahan: "" } };
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(true);
    });

    it("ignores a waived parent's half-typed, invalid block and does not keep it", () => {
      const p = onlyIbuPayload();
      p.ayahData = { name: "Bapak", phone: "abc", email: "bukan-email" };
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ayahData).toBeUndefined();
    });

    it("does the same for a waived ibu", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payload is mutated freely
      const p = validPayload() as Record<string, any>;
      delete p.consentData.ibu;
      p.consentData.onlyParent = "ayah";
      p.ibuData = { name: "", phone: "" };
      expect(submitEnrollmentSchema.safeParse(p).success).toBe(true);
    });

    it("still validates the filling parent's block when the other is waived", () => {
      const p = onlyIbuPayload();
      p.ayahData = { name: "" };
      p.ibuData = { name: "Ibu", phone: "abc" };
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errs = flattenSubmitErrors(result.error);
        expect(errs["ibuData.phone"]).toBe("Nomor telepon tidak valid");
        expect(errs["ayahData.name"]).toBeUndefined();
      }
    });

    it("accepts only the ayah's block when ibu is waived", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payload is mutated freely
      const p = validPayload() as Record<string, any>;
      delete p.ibuData;
      delete p.consentData.ibu;
      p.consentData.onlyParent = "ayah";
      expect(submitEnrollmentSchema.safeParse(p).success).toBe(true);
    });

    it("still requires the filling parent's name and signature", () => {
      const p = onlyIbuPayload();
      p.ibuData.name = "";
      p.consentData.ibu.signatureToken = "";
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errs = flattenSubmitErrors(result.error);
        expect(errs["ibuData.name"]).toBe("Nama wajib diisi");
        expect(errs["consentData.ibu.signatureToken"]).toBe("Tanda tangan wajib diisi");
      }
    });

    it("without the flag a missing parent block / signer is reported field by field", () => {
      const p = onlyIbuPayload();
      delete p.consentData.onlyParent;
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errs = flattenSubmitErrors(result.error);
        expect(errs["ayahData.name"]).toBe("Nama wajib diisi");
        expect(errs["consentData.ayah.name"]).toBe("Nama penandatangan wajib diisi");
        expect(errs["consentData.ayah.signatureToken"]).toBe("Tanda tangan wajib diisi");
      }
    });

    it("treats an empty-string flag as 'both parents'", () => {
      const p = onlyIbuPayload();
      p.consentData.onlyParent = "";
      expect(submitEnrollmentSchema.safeParse(p).success).toBe(false);
    });

    it("rejects an unknown flag value", () => {
      const p = onlyIbuPayload();
      p.consentData.onlyParent = "wali";
      const result = submitEnrollmentSchema.safeParse(p);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(flattenSubmitErrors(result.error)["consentData.onlyParent"]).toBe(
          "Pilihan orang tua yang mengisi tidak valid",
        );
      }
    });
  });
});
