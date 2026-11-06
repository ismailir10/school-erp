import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Isi Buku Penghubung");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
