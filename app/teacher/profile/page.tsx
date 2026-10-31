import { UserAvatar } from "@/components/ui/user-avatar";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { User, Mail, Phone, Building2, Briefcase, CreditCard, Wallet, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/portal/page-header";
import { maskBankAccount } from "@/lib/format";

export default async function TeacherProfilePage() {
  const session = await getSession();
  if (!session?.employeeId) redirect("/");

  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    include: { campus: { select: { name: true } } },
  });

  if (!employee) redirect("/");

  const fields = [
    { icon: User, label: "Nama lengkap", value: employee.formalName ?? employee.nama },
    { icon: Briefcase, label: "Jabatan", value: employee.jabatan },
    { icon: Building2, label: "Kampus", value: employee.campus.name },
    { icon: Mail, label: "Email", value: employee.email },
    { icon: Phone, label: "Nomor handphone", value: employee.noHp ?? "—" },
    { icon: CreditCard, label: "Nomor rekening", value: employee.bankAccountNo ? `${employee.bankName} ${maskBankAccount(employee.bankAccountNo)}` : "—" },
  ];

  return (
    <div>
      <PageHeader title="Profil saya" />

      {/* Avatar + Name */}
      <div className="flex items-center gap-4 mb-6">
        <UserAvatar name={employee.nama} size="lg" tone="primary" />
        <div>
          <h2 className="text-base font-semibold">{employee.nama}</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className="text-xs font-currency">{employee.kode}</Badge>
            <StatusBadge status="ACTIVE" />
          </div>
        </div>
      </div>

      {/* Quick links */}
      <Card className="p-0 overflow-hidden mb-4">
        <Link
          href="/teacher/slips"
          className="flex min-h-11 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Wallet size={16} className="text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Slip gaji</p>
            <p className="text-xs text-muted-foreground mt-0.5">Lihat slip gaji bulanan</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </Link>
      </Card>

      {/* Info Card */}
      <Card className="p-0 overflow-hidden">
        {fields.map((f, i) => {
          const Icon = f.icon;
          return (
            <div
              key={f.label}
              className={`flex items-center gap-3 px-4 py-3.5 ${i < fields.length - 1 ? "border-b border-border" : ""}`}
            >
              <Icon size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {/*
                  These are field labels, not section labels. Wearing the
                  uppercase letter-spaced eyebrow treatment (at weight 400, a
                  fourth rank on top of the portal's other three) made the label
                  out-shout the value it describes.
                */}
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="text-sm font-medium mt-0.5 truncate">{f.value}</p>
              </div>
            </div>
          );
        })}
      </Card>

      <p className="text-xs text-muted-foreground text-center mt-6">
        Hubungi admin untuk mengubah data profil.
      </p>
    </div>
  );
}
