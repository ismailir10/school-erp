import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Slip Gaji");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
