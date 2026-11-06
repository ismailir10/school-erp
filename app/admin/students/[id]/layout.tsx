import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Detail Siswa");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
