import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Absensi Kelas");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
