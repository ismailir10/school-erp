import { defineConfig } from "vitest/config";
import path from "path";
import react from "@vitejs/plugin-react";

const EXCLUDE = ["e2e/**", "node_modules/**", ".worktrees/**", ".claude/worktrees/**"];

// `.test.ts` suites that render React and therefore belong to the jsdom
// project despite the extension. Keep this list short — a suite that renders
// is normally named `.test.tsx`.
const DOM_TS_SUITES = ["components/portal/__tests__/week-grid.test.ts"];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: EXCLUDE,

    // Timeouts are wall-clock ceilings, and CI runners are contended: the
    // `Test & Build` job shares 4 vCPUs between three vitest forks,
    // so a test that takes 900ms on an idle laptop can take 5s there. The
    // stock 5s testTimeout / 1s testing-library asyncUtilTimeout put the
    // slowest component tests barely 3x from the cliff, which is why three
    // *different* tests went red on three unrelated PRs in one day. These
    // values keep every failure mode intact — a genuinely stuck test still
    // fails, just later — while removing the machine-speed lottery.
    // See docs/cycles/2026-08-22-vitest-flake-fix.md.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Environment is chosen by extension, not globally. jsdom construction
    // costs ~2.8s per file and 224 of the 287 suites (lib/**, app/api/**)
    // never touch the DOM — paying it for them made the suite 3x slower
    // (144s → 66s locally) and was the single largest source of the CPU
    // contention above. A `.ts` suite that does render is listed in
    // DOM_TS_SUITES so it gets the jsdom environment *and* the DOM setup file.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: [...EXCLUDE, ...DOM_TS_SUITES],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["**/*.test.tsx", ...DOM_TS_SUITES],
          exclude: EXCLUDE,
          setupFiles: ["./vitest.setup.ts", "./vitest.setup.dom.ts"],
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        ".worktrees/**",
        ".claude/worktrees/**",
        "e2e/**",
        "*.config.ts",
        "vitest.setup.ts",
        "vitest.setup.dom.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
