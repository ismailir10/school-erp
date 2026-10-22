// @public — demo-only user selector, gated at request time by DEMO_MODE.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDemoAuthEnabled } from "@/lib/security/demo-mode";

// Demo-only: list users for login selector — only when DEMO_MODE=true
export async function GET() {
  if (!isDemoAuthEnabled()) {
    return NextResponse.json(
      { error: "Demo user list disabled." },
      { status: 404 }
    );
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      employeeId: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(users);
}
