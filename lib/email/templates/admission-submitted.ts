import { escapeHtml } from "../escape";

/**
 * Admission-submitted confirmation email — transactional, Bu Sari voice.
 *
 * Shell aligned with `lib/email/templates/salary-slip.ts` and
 * `lib/supabase/email-templates/*.html` (the 5 Supabase Auth templates).
 * Any visual change here MUST be mirrored across all of those so every
 * Talib email feels like one product. See
 * `docs/runbooks/supabase-email-templates.md` for the canonical token
 * table + rationale.
 *
 * Design constraints:
 *   - Indonesian copy, Bu Sari voice (warm, Islamic courtesy layer)
 *     per .claude/standards/voice.md.
 *   - NO CTA button — transactional confirmation, not a CTA email
 *     (Cycle 1.1 spec §7 q4).
 *   - NO tracking pixels, NO unsubscribe footer (not marketing).
 *   - Inline styles only (Gmail / Outlook compatibility).
 *
 * User-controlled strings (childName, parentName) are HTML-escaped to
 * prevent script/markup injection from DB-stored values. appUrl is an
 * env-controlled value (NEXT_PUBLIC_APP_URL) used as the logo image
 * origin — must remain server-controlled; never pass DB-sourced URLs.
 */

export type AdmissionSubmittedEmailParams = {
  /** Empty when the family has not named a child yet (short /daftar lead). */
  childName: string;
  parentName: string;
  appUrl: string;
};

export function admissionSubmittedEmailHtml({
  childName,
  parentName,
  appUrl,
}: AdmissionSubmittedEmailParams): string {
  const safeChild = escapeHtml(childName.trim());
  const safeParent = escapeHtml(parentName);
  const thanks = safeChild
    ? `terima kasih telah mendaftarkan ananda <strong>${safeChild}</strong> di Talib oleh An Nisaa' Sekolahku.`
    : `terima kasih telah menghubungi Talib oleh An Nisaa' Sekolahku.`;
  return `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pendaftaran ananda tercatat — Talib</title></head>
<body style="margin:0;padding:0;background-color:#F7FAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <tr><td>
      <!-- Header card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid #E5E2DE;border-bottom:3px solid #5DB4B8;">
        <tr>
          <td align="center" bgcolor="#FFFFFF" style="padding:24px 28px;background-color:#FFFFFF;">
            <img src="${appUrl}/logo.png" alt="Talib — An Nisaa' Sekolahku" width="48" height="48" style="display:block;border-radius:12px;margin:0 auto 8px auto;" />
            <h1 style="margin:0;color:#1A2E2F;font-size:20px;font-weight:700;letter-spacing:-0.01em;">
              Talib
            </h1>
            <p style="margin:2px 0 0 0;color:#57534E;font-size:12px;">
              by An Nisaa' Sekolahku
            </p>
          </td>
        </tr>
      </table>

      <!-- Body card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E2DE;border-top:none;border-radius:0 0 12px 12px;">
        <tr>
          <td bgcolor="#FFFFFF" style="padding:28px;background-color:#FFFFFF;">

            <p style="margin:0 0 20px 0;color:#1A2E2F;font-size:15px;">
              Assalamu'alaikum warahmatullahi wabarakatuh,
            </p>

            <p style="margin:0 0 20px 0;color:#57534E;font-size:14px;line-height:1.6;">
              Bapak/Ibu <strong>${safeParent}</strong>, ${thanks}
            </p>

            <p style="margin:0 0 20px 0;color:#57534E;font-size:14px;line-height:1.6;">
              InsyaAllah tim kami akan menghubungi Bapak/Ibu dalam <strong>1&ndash;3 hari kerja</strong> untuk menjadwalkan kunjungan dan memberikan informasi lanjutan tentang program yang sesuai.
            </p>

            <p style="margin:0 0 24px 0;color:#57534E;font-size:14px;line-height:1.6;">
              Mohon menunggu konfirmasi dari kami. Apabila Bapak/Ibu memiliki pertanyaan mendesak, silakan menghubungi kantor sekolah secara langsung.
            </p>

            <p style="margin:0 0 4px 0;color:#1A2E2F;font-size:14px;">
              Wassalamu'alaikum warahmatullahi wabarakatuh,
            </p>
            <p style="margin:0 0 20px 0;color:#1A2E2F;font-size:14px;">
              Tim Penerimaan Talib
            </p>

            <p style="margin:0 0 20px 0;color:#57534E;font-size:13px;line-height:1.5;">
              Butuh bantuan? Hubungi <a href="mailto:support@annisaasekolahku.com" style="color:#5DB4B8;text-decoration:none;">support@annisaasekolahku.com</a>.
            </p>

            <hr style="border:none;border-top:1px solid #E5E2DE;margin:0 0 20px 0;">

            <p style="margin:0;color:#6B6B7A;font-size:11px;line-height:1.5;">
              Dokumen resmi &mdash; An Nisaa' Sekolahku<br>
              Taman Aster, Bekasi &middot; Metland Cibitung<br>
              Dikirim otomatis oleh Talib &middot; talib.annisaasekolahku.com
            </p>

          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
