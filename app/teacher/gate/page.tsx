import type { Metadata } from "next";
import { BackLink } from "@/components/portal/back-link";
import { PageHeader } from "@/components/portal/page-header";
import { GateClient } from "./client";

export const metadata: Metadata = { title: "Gerbang" };

// Design-system cross-check: §14 Portal Shell + §16 Attendance Flows. Teacher
// layout already restricts this route to the teacher portal; the API enforces
// tenant + employee scoping.
export default function GatePage() {
  return (
    <div>
      <BackLink href="/teacher" label="Beranda" />
      <PageHeader
        title="Gerbang"
        subtitle="Catat anak masuk dan pulang, cukup satu ketukan."
      />
      <GateClient />
    </div>
  );
}
