import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import LoginPageWrapper from "../page"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: vi.fn() } }),
}))

// The visitor's motion preference as `useReducedMotion()` reports it. framer-motion caches the real
// answer in a module-level singleton on first call, so a per-test `matchMedia` stub cannot vary it
// between the server render and the client render; this seam can. Production: the server has no
// window, so it reports `null`, while a reduced-motion browser reports `true`.
const motionPref = vi.hoisted(() => ({ value: null as boolean | null }))

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motionPref.value,
}))

describe("Login page (Google sign-in screen)", () => {
  beforeEach(() => {
    // SignInPage only renders when Supabase is configured; DemoLoginPage otherwise.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    motionPref.value = null
  })

  it("hydrates a reduced-motion client against server HTML without a mismatch", async () => {
    // The server cannot know the visitor's motion preference, so it always renders the same
    // markup. A client that branches its first render on that preference hydrates differently.
    motionPref.value = null
    const html = renderToString(<LoginPageWrapper />)

    motionPref.value = true
    const container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)

    const recoverable = vi.fn()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    // Only `useReducedMotion` is controllable here, so this guards "the first render branches on
    // the preference via that hook" (the original bug). It would not notice `<MotionConfig>` being
    // deleted or a branch built on `matchMedia` directly; the browser run in the cycle doc covers those.
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, <LoginPageWrapper />, { onRecoverableError: recoverable })
      })

      expect(recoverable).not.toHaveBeenCalled()
      const hydrationLogs = consoleError.mock.calls.filter((args) =>
        args.some((a) => typeof a === "string" && /hydrat/i.test(a)),
      )
      expect(hydrationLogs).toEqual([])
    } finally {
      // A failed assertion must not leave a second copy of the page in the document, or the
      // tests below fail with "multiple elements" and bury the real failure.
      await act(async () => root?.unmount())
      container.remove()
    }
  })

  it("lets the user pause and resume the aurora; the control carries the CSS hook that hides it under reduced motion", async () => {
    render(<LoginPageWrapper />)
    const user = userEvent.setup()

    const pause = screen.getByRole("button", { name: "Jeda animasi" })
    // jsdom applies no CSS, so this asserts the class, not the computed `display`. The computed
    // `display: none` under reduced motion was checked in a real browser (see the cycle doc).
    expect(pause.className).toContain("motion-reduce:hidden")
    const layer = document.querySelector('[data-slot="aurora"]')!
    expect(layer).toHaveAttribute("data-paused", "false")

    await user.click(pause)
    expect(layer).toHaveAttribute("data-paused", "true")
    const play = screen.getByRole("button", { name: "Putar animasi" })

    await user.click(play)
    expect(layer).toHaveAttribute("data-paused", "false")
    expect(screen.getByRole("button", { name: "Jeda animasi" })).toBeInTheDocument()
  })

  it("keeps the single sign-in action and no tiled SVG motif", () => {
    render(<LoginPageWrapper />)
    expect(screen.getByRole("button", { name: /Masuk dengan Google/ })).toBeInTheDocument()
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      expect(el.style.backgroundImage).not.toContain("data:image/svg")
    }
  })
})
