import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Buku Penghubung Kelas");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
