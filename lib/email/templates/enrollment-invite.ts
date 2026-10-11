import { escapeHtml } from "../escape";

/**
 * Enrollment-form invitation email — transactional, Bu Sari voice. Sent when
 * an admin clicks "Kirim Formulir" on a qualified Admission inquiry. Unlike the
 * admission-submitted confirmation (no CTA), this email's whole purpose IS the
 * CTA: a button to the tokenized form link.
 *
 * Shell mirrors lib/email/templates/admission-submitted.ts so every Talib
 * email feels like one product — any visual change here must be mirrored there
 * and across the Supabase Auth templates (see
 * docs/runbooks/supabase-email-templates.md).
 *
 * `childName` / `parentName` are DB-sourced → HTML-escaped. `formUrl` is
 * server-built from the request origin + the access token (server-issued, not
 * DB-sourced); it carries the secret token so it must never be logged. Both
 * URLs are still escaped, since they land in attribute and text positions.
 */

export type EnrollmentInviteEmailParams = {
  childName: string;
  parentName: string;
  formUrl: string;
  appUrl: string;
};

export function enrollmentInviteEmailHtml({
  childName,
  parentName,
  formUrl,
  appUrl,
}: EnrollmentInviteEmailParams): string {
  // A lead may have no child name yet (child fields are optional).
  const safeChild = escapeHtml(childName.trim());
  const childPhrase = safeChild ? `ananda <strong>${safeChild}</strong>` : "putra/putri Bapak/Ibu";
  const safeParent = escapeHtml(parentName);
  const safeFormUrl = escapeHtml(formUrl);
  const safeAppUrl = escapeHtml(appUrl);
  return `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lengkapi formulir pendaftaran ananda — Talib</title></head>
<body style="margin:0;padding:0;background-color:#F7FAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid #E5E2DE;border-bottom:3px solid #5DB4B8;">
        <tr>
          <td align="center" bgcolor="#FFFFFF" style="padding:24px 28px;background-color:#FFFFFF;">
            <img src="${safeAppUrl}/logo.png" alt="Talib — An Nisaa' Sekolahku" width="48" height="48" style="display:block;border-radius:12px;margin:0 auto 8px auto;" />
            <h1 style="margin:0;color:#1A2E2F;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Talib</h1>
            <p style="margin:2px 0 0 0;color:#57534E;font-size:12px;">by An Nisaa' Sekolahku</p>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E2DE;border-top:none;border-radius:0 0 12px 12px;">
        <tr>
          <td bgcolor="#FFFFFF" style="padding:28px;background-color:#FFFFFF;">

            <p style="margin:0 0 20px 0;color:#1A2E2F;font-size:15px;">
              Assalamu'alaikum warahmatullahi wabarakatuh,
            </p>

            <p style="margin:0 0 20px 0;color:#57534E;font-size:14px;line-height:1.6;">
              Bapak/Ibu <strong>${safeParent}</strong>, alhamdulillah ${childPhrase} melanjutkan proses pendaftaran di An Nisaa' Sekolahku. Mohon melengkapi formulir penerimaan murid baru melalui tautan di bawah ini.
            </p>

            <p style="margin:0 0 24px 0;color:#57534E;font-size:14px;line-height:1.6;">
              Formulir mencakup data ananda, data orang tua, dan surat persetujuan. Tautan ini bersifat pribadi — mohon tidak dibagikan. Tautan berlaku selama <strong>14 hari</strong>.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td bgcolor="#0C5C3F" style="border-radius:8px;background-color:#0C5C3F;">
                  <a href="${safeFormUrl}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">
                    Lengkapi Formulir Pendaftaran
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px 0;color:#6B6B7A;font-size:12px;line-height:1.5;word-break:break-all;">
              Jika tombol tidak berfungsi, salin tautan ini ke peramban:<br>${safeFormUrl}
            </p>

            <p style="margin:0 0 4px 0;color:#1A2E2F;font-size:14px;">Wassalamu'alaikum warahmatullahi wabarakatuh,</p>
            <p style="margin:0 0 20px 0;color:#1A2E2F;font-size:14px;">Tim Penerimaan Talib</p>

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
