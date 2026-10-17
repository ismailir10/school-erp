/**
 * Human-readable label for a gateway rail, from the raw channel id the gateway
 * reports (DOKU `channel.id`: "VIRTUAL_ACCOUNT_BANK_MANDIRI" → "Virtual Account
 * Bank Mandiri"). Single owner: the invoice payment list, the payments ledger
 * and the admin activity card all render it, so the wording cannot drift.
 */

// Bank/channel acronyms that stay uppercase rather than being title-cased into
// "Bca".
const CHANNEL_ACRONYMS = new Set(["BCA", "BRI", "BNI", "BTN", "BNC", "BSI", "BJB", "CIMB", "DOKU", "QRIS", "OVO", "DANA"]);

const VA_PREFIX = "VIRTUAL_ACCOUNT_";

function titleCaseChannelWord(word: string): string {
  if (CHANNEL_ACRONYMS.has(word)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function paymentChannelLabel(raw: string): string {
  const isVa = raw.startsWith(VA_PREFIX);
  const words = (isVa ? raw.slice(VA_PREFIX.length) : raw)
    .split("_")
    .filter(Boolean)
    .map(titleCaseChannelWord);
  return isVa ? `Virtual Account ${words.join(" ")}` : words.join(" ");
}
