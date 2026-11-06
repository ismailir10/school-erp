import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Jurnal");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
