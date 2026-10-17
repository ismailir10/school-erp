/** Stored checkout URLs identify who owns an existing link; never fetch these URLs. */
export function paymentLinkProvider(url: string | null | undefined): "xendit" | "doku" | "demo-xendit" | "demo-doku" | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  switch (parsed.hostname) {
    case "dev.xen.to":
    case "xen.to":
    case "checkout.xendit.co":
    case "checkout-staging.xendit.co":
      return "xendit";
    case "checkout.doku.com":
    case "checkout-sandbox.doku.com":
    case "sandbox.doku.com":
    case "staging.doku.com":
      return "doku";
    case "demo.xendit.local":
      return "demo-xendit";
    case "demo.doku.local":
      return "demo-doku";
    default:
      return null;
  }
}
