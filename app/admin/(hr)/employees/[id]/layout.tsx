import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Detail Karyawan");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
