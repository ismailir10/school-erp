import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Templat Buku Penghubung");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
