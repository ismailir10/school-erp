import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Jam Kerja");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
