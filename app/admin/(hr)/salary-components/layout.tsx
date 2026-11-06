import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Komponen Gaji");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
