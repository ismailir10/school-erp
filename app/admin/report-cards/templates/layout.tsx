import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Bank Narasi Rapor");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
