"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { MotionConfig, motion } from "framer-motion";
import { Aurora } from "@/components/reactbits/aurora";
import { BlurText } from "@/components/reactbits/blur-text";
import { createClient } from "@/lib/supabase/client";
import { CalendarCheck2, CreditCard, NotebookPen, Pause, Play } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import { LegalFooter } from "@/components/layout/legal-footer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type UserOption = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

// Maps `?error=<code>` returned by /auth/callback to a user-facing message.
// `access_denied` covers the most common failure: Google OAuth succeeds but
// the email has no User/Employee/Parent record yet (UAT 2026-05-12 teacher
// blocker — silent redirect with no UX).
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Login gagal. Silakan coba lagi.",
  access_denied: "Akun belum terdaftar. Hubungi admin sekolah untuk akses.",
};

const CAPABILITIES = [
  {
    icon: CalendarCheck2,
    title: "Kehadiran harian",
    detail: "Tercatat rapi, terlihat orang tua",
  },
  {
    icon: NotebookPen,
    title: "Jurnal & perkembangan",
    detail: "Catatan guru sampai ke rumah",
  },
  {
    icon: CreditCard,
    title: "Tagihan sekolah",
    detail: "Bayar dan lihat riwayatnya",
  },
] as const;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9.003 18z" fill="#34A853"/>
      <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0 5.48 0 2.438 2.017.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
    </svg>
  );
}

export default function LoginPageWrapper() {
  const isSupabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <Suspense
      fallback={
        <div
          className={
            isSupabaseConfigured
              ? "min-h-screen bg-background"
              : "min-h-screen bg-sidebar"
          }
        />
      }
    >
      {isSupabaseConfigured ? (
        // `reducedMotion="user"` drops the card's slide-up for reduced-motion users while the
        // server and client keep rendering the same `initial` state. The slide used to be skipped
        // with `initial={prefersReducedMotion ? false : …}`, which hydrated differently from the
        // server HTML (the server cannot know the preference) and logged a hydration error.
        <MotionConfig reducedMotion="user">
          <SignInPage />
        </MotionConfig>
      ) : (
        <DemoLoginPage />
      )}
    </Suspense>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Google-only sign-in. Access to Talib is invitation-only — accounts are
 * provisioned by the school, never self-served — so this screen offers exactly
 * one action and states that rule before the failure instead of after it.
 *
 * The magic-link form that used to live here was removed 2026-08-12. The
 * Supabase Email provider stays enabled by owner decision, so /auth/v1/otp is
 * still reachable with the public anon key: this is a UI-level change only,
 * not an access-control change. See docs/cycles/2026-08-12-login-redesign.md.
 * ──────────────────────────────────────────────────────────────────────────── */
function SignInPage() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");

  const [loading, setLoading] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [authError, setAuthError] = useState(
    errorCode ? (LOGIN_ERROR_MESSAGES[errorCode] ?? "") : "",
  );

  async function handleGoogleLogin() {
    setLoading(true);
    setAuthError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setAuthError(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[1fr_auto]">
      {/*
        Sign-in is FIRST in the DOM so it is first on mobile — thumb-reachable,
        with no scrolling past the pitch to reach the only action — and first
        for keyboard and screen-reader users at every width. On desktop the
        three cells are placed explicitly (`lg:col-start-*` / `lg:row-start-*`),
        so the DOM order never changes: sign-in, brand panel, legal footer.
        On a phone that same order stacks them top to bottom, which puts the
        footer at the end of the page; on desktop it is the bottom row of the
        right-hand column. One footer element, never duplicated.
      */}
      <section className="flex flex-col justify-center bg-card px-6 py-10 lg:col-start-2 lg:row-start-1 lg:px-12 lg:py-12">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
          className="mx-auto w-full max-w-sm"
        >
          {/* Brand presence above the fold on mobile; on desktop the brand panel owns it. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image
              src="/logo.png"
              alt=""
              width={44}
              height={44}
              className="rounded-[13px] outline -outline-offset-1 outline-black/10"
            />
            <TalibWordmark size="md" showSublabel />
          </div>

          {authError && (
            <Alert
              variant="destructive"
              className="mb-5 border-destructive/30 bg-destructive-subtle"
            >
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          <h1 className="text-h1 tracking-tight text-balance">
            Masuk ke Talib
          </h1>
          <p className="mt-1.5 max-w-[36ch] text-body leading-relaxed text-muted-foreground text-pretty">
            Akses hanya untuk staf dan orang tua yang diundang sekolah.
          </p>

          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleLogin}
            disabled={loading}
            // min-h-12 = 48px; this action used to be h-9 (36px), under the
            // 44px touch minimum on a phone-first product. The focus ring uses
            // --primary-text (5.0:1 on white) because the default --ring
            // measures 2.36:1 and fails the 3:1 non-text contrast floor.
            className="mt-6 h-auto min-h-12 w-full gap-3 rounded-xl border-border bg-card font-semibold shadow-xs hover:bg-muted focus-visible:border-primary-text focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            {loading ? <Spinner aria-hidden /> : <GoogleMark />}
            Masuk dengan Google
          </Button>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Gunakan akun Google yang terdaftar di sekolah. Belum punya akses?
            Hubungi admin sekolah.
          </p>
        </motion.div>
      </section>

      {/* Brand panel — below the action on mobile, left column (both rows) on desktop. */}
      <section className="relative isolate overflow-hidden bg-secondary px-6 py-10 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:justify-center lg:gap-8 lg:px-12 lg:py-12">
        {/* Soft drifting aurora (React Bits port). Curves only — no tiled or angular shapes. */}
        <Aurora paused={motionPaused} />
        {/*
          WCAG 2.2.2: the drift never ends, so there must be a way to stop it.
          `motion-reduce:hidden` (CSS, not useReducedMotion) because nothing moves for
          those users, and branching in JS would mismatch server and client HTML.
          size-11 = 44px hit area; the focus ring uses --primary-text like the Google button.
        */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setMotionPaused((paused) => !paused)}
          aria-label={motionPaused ? "Putar animasi" : "Jeda animasi"}
          className="absolute right-3 bottom-3 size-11 rounded-full text-muted-foreground hover:bg-card/60 focus-visible:border-primary-text focus-visible:ring-2 focus-visible:ring-primary-text motion-reduce:hidden"
        >
          {motionPaused ? <Play /> : <Pause />}
        </Button>

        <div className="mb-6 hidden items-center gap-3 lg:mb-0 lg:flex">
          <Image
            src="/logo.png"
            alt=""
            width={44}
            height={44}
            className="rounded-[13px] outline -outline-offset-1 outline-black/10"
          />
          <TalibWordmark size="md" showSublabel />
        </div>

        <div>
          <BlurText
            as="h2"
            text="Sahabat belajar anak"
            delay={150}
            className="max-w-[16ch] text-h1 leading-tight font-semibold tracking-tight text-balance lg:text-display"
          />
          <p className="mt-2 max-w-[38ch] text-body leading-relaxed text-muted-foreground text-pretty">
            Kehadiran, jurnal harian, dan tagihan sekolah dalam satu pintu.
          </p>
        </div>

        <ul className="mt-6 grid gap-3 lg:mt-0">
          {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-[18px] shrink-0 text-primary-text" />
              <span>
                <span className="block text-body font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Legal links — last on a phone (after the pitch), bottom of the sign-in column on desktop. */}
      <div className="bg-background px-6 pt-6 pb-8 lg:col-start-2 lg:row-start-2 lg:bg-card lg:px-12 lg:pt-4 lg:pb-8">
        <LegalFooter tone="onLight" className="mx-auto mt-0 max-w-sm" />
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Demo mode — no Supabase configured (local dev + every Playwright spec, which
 * run with DEMO_MODE=true). Deliberately left on the original dark shell: it is
 * a developer surface, and restyling it would put 33 e2e specs at risk for no
 * user-facing gain. Behaviour and markup are unchanged by the redesign.
 * ──────────────────────────────────────────────────────────────────────────── */
function DemoLoginPage() {
  const router = useRouter();
  const [demoUsers, setDemoUsers] = useState<UserOption[]>([]);
  const [demoLoading, setDemoLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/users")
      .then((r) => r.json())
      .then((data) => { setDemoUsers(data); setDemoLoading(false); });
  }, []);

  async function handleDemoLogin(userId: string) {
    setLoginLoading(userId);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.ok) router.push(data.redirectUrl);
  }

  const admins = demoUsers.filter((u) => u.role === "SCHOOL_ADMIN");
  const teachers = demoUsers.filter((u) => u.role === "TEACHER");

  return (
    <main className="min-h-screen flex items-center justify-center bg-sidebar px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        {/* Logo & Title */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="flex flex-col items-center"
          >
            <Image src="/logo.png" alt="An Nisaa' Sekolahku" width={64} height={64} className="mb-4 rounded-2xl" />
            <TalibWordmark size="lg" showSublabel tone="onDark" className="items-center" />
          </motion.div>
          <p className="text-sidebar-foreground mt-3 text-sm">
            Sahabat belajar anak — kehadiran, jurnal, tagihan dalam satu pintu.
          </p>
        </div>

        <Card className="border-white/5 bg-login-card-bg py-0 text-white">
          <CardContent className="p-6">
            <p className="text-sidebar-foreground text-xs uppercase tracking-wider font-semibold mb-4">
              Demo Mode — Pilih Akun
            </p>

            {demoLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl bg-white/5" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {admins.map((user) => (
                  <motion.div
                    key={user.id}
                    whileTap={{ scale: 0.98 }}
                  >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDemoLogin(user.id)}
                    disabled={loginLoading !== null}
                    className="h-auto w-full justify-start gap-3 rounded-xl border border-primary/20 bg-primary/10 p-3 text-left hover:border-primary/40 hover:bg-primary/15"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="text-white text-sm font-bold">{user.name?.[0] ?? "A"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm truncate">{user.name ?? user.email}</p>
                      <p className="text-sidebar-foreground text-xs">Admin Sekolah</p>
                    </div>
                    {loginLoading === user.id && <Spinner aria-hidden className="text-white" />}
                  </Button>
                  </motion.div>
                ))}

                <p className="text-sidebar-foreground text-xs uppercase tracking-wider font-semibold pt-2">Guru ({teachers.length})</p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {teachers.map((user, i) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.03 * i }}
                      whileTap={{ scale: 0.98 }}
                    >
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleDemoLogin(user.id)}
                      disabled={loginLoading !== null}
                      className="h-auto w-full justify-start gap-3 rounded-xl p-2.5 text-left text-white/90 hover:bg-white/5"
                    >
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                        <span className="text-white/70 text-xs font-medium">{user.name?.[0] ?? "?"}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white/90 text-sm truncate">{user.name}</p>
                        <p className="text-sidebar-foreground text-xs truncate">{user.email}</p>
                      </div>
                      {loginLoading === user.id && <Spinner aria-hidden className="text-white" />}
                    </Button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sidebar-foreground text-xs mt-6">
          Demo mode — Supabase Auth belum dikonfigurasi
        </p>
        <LegalFooter />
      </motion.div>
    </main>
  );
}
