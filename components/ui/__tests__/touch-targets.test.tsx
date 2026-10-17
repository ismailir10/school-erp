import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList } from "@/components/ui/breadcrumb";
import { Accordion, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// jsdom can't evaluate `(pointer: coarse)`, so these pin the class that carries
// the 44px touch floor. The real geometry is asserted in e2e/mobile-layout.spec.ts.
const COARSE_FLOOR = "[@media(pointer:coarse)]:min-h-11";

describe("touch-target floor on shared controls", () => {
  it("Input", () => {
    render(<Input aria-label="Nama" />);
    expect(screen.getByLabelText("Nama").className).toContain(COARSE_FLOOR);
  });

  it("NativeSelect, with 16px text on phones so iOS doesn't zoom on focus", () => {
    render(
      <NativeSelect aria-label="Kelas">
        <option>A</option>
      </NativeSelect>,
    );
    const select = screen.getByLabelText("Kelas");
    expect(select.className).toContain(COARSE_FLOOR);
    expect(select.className).toContain("text-base");
  });

  it("Tabs grow to 44px on touch (the list wraps its triggers instead of fixing a height)", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole("tablist").className).toContain("[@media(pointer:coarse)]:h-auto");
    expect(screen.getByRole("tab", { name: "A" }).className).toContain(COARSE_FLOOR);
  });

  it("BreadcrumbLink grows its hit area without changing layout", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Dasbor</BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    const link = screen.getByRole("link", { name: "Dasbor" });
    expect(link.className).toContain("relative");
    expect(link.className).toContain("[@media(pointer:coarse)]:after:-inset-y-3");
  });

  it("AccordionTrigger", () => {
    render(
      <Accordion>
        <AccordionItem value="a">
          <AccordionTrigger>Bagian</AccordionTrigger>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByRole("button", { name: /Bagian/ }).className).toContain(COARSE_FLOOR);
  });
});
