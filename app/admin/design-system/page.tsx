"use client";

import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileCode2 } from "lucide-react";

/**
 * Live Design System reference page.
 *
 * Renders the canonical Claude Design export via an <iframe> pointing at
 * /admin/design-system-reference.html (served from /public/admin/). The
 * static HTML is the single source of truth — see
 * .claude/standards/design-system.html for the governance copy.
 *
 * This page exists so humans and LLMs can inspect tokens, recipes, and
 * overlays in-app without leaving the ERP. It is also the anchor target
 * for the Playwright visual-regression test in e2e/design-system.spec.ts.
 */
export default function DesignSystemPage() {
  const referenceUrl = "/admin/design-system-reference.html";
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Design System"
        description="Canonical visual reference — tokens, recipes, overlays, portal shells, voice & tone. Read this before touching frontend code."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={referenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="mr-2 size-4" />
              Buka di tab baru
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href="https://github.com/ismailir10/school-erp/blob/staging/.claude/standards/design-system.html"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <FileCode2 className="mr-2 size-4" />
              Sumber di GitHub
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
        <iframe
          src={referenceUrl}
          title="Talib Design System reference"
          className="block h-[calc(100vh-200px)] w-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
