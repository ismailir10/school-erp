import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Tahun Ajaran");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
