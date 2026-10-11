import { describe, expect, it } from "vitest";
import { enrollmentInviteEmailHtml } from "../templates/enrollment-invite";

const base = { childName: "Aisyah", parentName: "Ibu Fatimah", formUrl: "https://talib.test/pendaftaran/tok", appUrl: "https://talib.test" };

describe("enrollmentInviteEmailHtml", () => {
  it("links the button and the fallback text to the form", () => {
    const html = enrollmentInviteEmailHtml(base);
    expect(html).toContain('href="https://talib.test/pendaftaran/tok"');
    expect(html).toContain("<br>https://talib.test/pendaftaran/tok");
    expect(html).toContain('src="https://talib.test/logo.png"');
  });

  it("escapes both URLs so they cannot break out of an attribute or inject markup", () => {
    const html = enrollmentInviteEmailHtml({
      ...base,
      formUrl: 'https://x.test/p?a=1&b="><script>alert(1)</script>',
      appUrl: 'https://x.test/"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("a=1&amp;b=&quot;&gt;&lt;script&gt;");
    expect(html).toContain("https://x.test/&quot;&gt;&lt;img src=x");
  });

  it("names the child, or speaks of putra/putri when no child is named yet", () => {
    expect(enrollmentInviteEmailHtml(base)).toContain("ananda <strong>Aisyah</strong>");
    const blank = enrollmentInviteEmailHtml({ ...base, childName: "  " });
    expect(blank).toContain("putra/putri Bapak/Ibu");
    expect(blank).not.toContain("<strong></strong>");
  });
});
