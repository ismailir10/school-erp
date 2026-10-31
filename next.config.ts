import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return [
      // The product tours shipped at Indonesian slugs (2026-10-09, 2026-10-31) and moved to English ones, per the
      // English-only route rule. Shared links (/panduan#5) keep working: the browser carries the #slide across.
      { source: "/panduan", destination: "/guide", permanent: true },
      { source: "/panduan/orang-tua", destination: "/guide/parents", permanent: true },
      {
        source: "/admin/academic",
        destination: "/admin/academic-years",
        permanent: true,
      },
      {
        source: "/admin/curriculum/semesters",
        destination: "/admin/semesters",
        permanent: true,
      },
      {
        source: "/admin/curriculum/semesters/:path*",
        destination: "/admin/semesters/:path*",
        permanent: true,
      },
      {
        // Penilaian consolidation: legacy AssessmentTemplate/StudentAssessment
        // admin surfaces retired → single new monitor, now at /admin/assessments
        // (renamed from /admin/penilaian on 2026-09-25 — English-only route
        // slugs; see /admin/penilaian → /admin/assessments rules below).
        //
        // As of 2026-07-31 the page files behind these paths are deleted, so
        // these rules are no longer masking dead code — they ARE the handler.
        // Kept deliberately: staff bookmarks from the pre-consolidation UI
        // would otherwise 404, and a redirect rule costs nothing.
        //
        // NOTE: /admin/assessments and /admin/assessments/:path* are NOT
        // redirect sources here — since 2026-09-25 that path IS the real
        // monitor page, not a legacy alias.
        source: "/admin/assessment-templates",
        destination: "/admin/assessments",
        permanent: true,
      },
      {
        source: "/admin/assessment-templates/:path*",
        destination: "/admin/assessments",
        permanent: true,
      },
      {
        // English-only URL slugs (2026-09-25): old Indonesian admin routes.
        source: "/admin/penilaian",
        destination: "/admin/assessments",
        permanent: true,
      },
      {
        source: "/admin/penilaian/:path*",
        destination: "/admin/assessments/:path*",
        permanent: true,
      },
      {
        source: "/admin/raport",
        destination: "/admin/report-cards",
        permanent: true,
      },
      {
        source: "/admin/raport/:path*",
        destination: "/admin/report-cards/:path*",
        permanent: true,
      },
      {
        // Legacy teacher template-scoring route retired → back to the hub.
        source: "/teacher/assessments/:classSectionId/:templateId/:period",
        destination: "/teacher/assessments",
        permanent: true,
      },
      {
        source: "/admin/attendance",
        destination: "/admin/employee-attendance",
        permanent: true,
      },
      {
        source: "/admin/attendance/:path*",
        destination: "/admin/employee-attendance/:path*",
        permanent: true,
      },
      {
        source: "/admin/leave",
        destination: "/admin/leave-requests",
        permanent: true,
      },
      {
        source: "/admin/settings/salary-components",
        destination: "/admin/salary-components",
        permanent: true,
      },
      {
        source: "/admin/settings/config",
        destination: "/admin/settings/work-hours",
        permanent: true,
      },
    ];
  },
  async headers() {
    // Content-Security-Policy in REPORT-ONLY mode — logs violations to the
    // browser console without blocking. To graduate to enforcing, rename the
    // header key to "Content-Security-Policy" once violations are clean.
    //
    // 'unsafe-inline' + 'unsafe-eval' are required by Next.js 16 client
    // bundles today; harden later via per-request nonces or sha256 hashes.
    // Allowlist:
    //   - Supabase realtime (wss + https)
    //   - Xendit Checkout SDK (js.xendit.co)
    //   - Google Fonts (fonts.googleapis.com / fonts.gstatic.com)
    //   - Vercel Analytics + Speed Insights (vitals.vercel-insights.com)
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.xendit.co https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.xendit.co https://vitals.vercel-insights.com https://va.vercel-scripts.com",
      // 'self' (not 'none') so /admin/design-system can embed the static
      // /admin/design-system-reference.html via <iframe>. Same-origin only —
      // external sites still cannot frame the app.
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          // SAMEORIGIN (not DENY) so /admin/design-system can embed the
          // static /admin/design-system-reference.html via <iframe>.
          // Aligns with the matching CSP frame-ancestors 'self' above.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
