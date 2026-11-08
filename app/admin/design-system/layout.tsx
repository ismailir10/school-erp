import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Design System");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
