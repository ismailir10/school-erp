import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "../headers";

describe("applySecurityHeaders", () => {
  it("sets CSP-Report-Only with required directives", () => {
    const res = applySecurityHeaders(new NextResponse(null, { status: 200 }));
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("includes Supabase HTTPS + WSS + Xendit + Resend + Vercel Insights in connect-src", () => {
    const res = applySecurityHeaders(new NextResponse(null));
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain("wss://*.supabase.co");
    expect(csp).toContain("https://api.xendit.co");
    expect(csp).toContain("https://api.resend.com");
    expect(csp).toContain("https://vitals.vercel-insights.com");
  });

  it("sets HSTS with 2-year max-age + includeSubDomains (no preload)", () => {
    const res = applySecurityHeaders(new NextResponse(null));
    // preload deferred to post-launch +30d (irreversible if shipped early)
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("sets clickjacking + content-type + referrer + permissions headers", () => {
    const res = applySecurityHeaders(new NextResponse(null));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Permissions-Policy")).toContain("microphone=()");
    expect(res.headers.get("Permissions-Policy")).toContain("geolocation=(self)");
  });

  it("allows only the canonical static design reference in a same-origin frame", () => {
    const reference = applySecurityHeaders(new NextResponse(null), "/admin/design-system-reference.html");
    expect(reference.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(reference.headers.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'self'");

    for (const path of ["/admin/design-system", "/admin/design-system-reference.html/extra", "/parent"]) {
      const response = applySecurityHeaders(new NextResponse(null), path);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
    }
  });

  it("returns the same response (mutates in place)", () => {
    const res = new NextResponse(null);
    expect(applySecurityHeaders(res)).toBe(res);
  });
});
