import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchoolGallery, SchoolHero } from "../school-photos";

const src = (img: Element) => decodeURIComponent(img.getAttribute("src") ?? "");

describe("SchoolHero", () => {
  it("full variant renders the teachers photo with Indonesian alt text and explicit dimensions", () => {
    render(<SchoolHero />);
    const img = screen.getByRole("img", {
      name: "Para guru An Nisaa' Sekolahku berfoto bersama di ruang kelas",
    });
    expect(src(img)).toContain("/school/guru.webp");
    expect(img).toHaveAttribute("width", "960");
    expect(img).toHaveAttribute("height", "720");
  });

  it("slim variant renders the play-area photo", () => {
    render(<SchoolHero variant="slim" />);
    const img = screen.getByRole("img", {
      name: "Area bermain dalam ruangan yang aman dan berwarna-warni",
    });
    expect(src(img)).toContain("/school/area-bermain.webp");
    expect(img).toHaveAttribute("width", "960");
    expect(img).toHaveAttribute("height", "540");
  });

  it("full variant is 16:9 with a caption; slim is 3:1 with none", () => {
    const { container, unmount } = render(<SchoolHero />);
    const full = container.querySelector("img");
    expect(full?.className).toContain("aspect-[16/9]");
    expect(full?.className).toContain("object-[50%_35%]");
    expect(screen.getByText("Tim pengajar An Nisaa' Sekolahku")).toBeInTheDocument();
    unmount();

    const slim = render(<SchoolHero variant="slim" />);
    const img = slim.container.querySelector("img");
    expect(img?.className).toContain("aspect-[3/1]");
    expect(img?.className).toContain("object-[50%_60%]");
    expect(img?.className).not.toContain("aspect-[16/9]");
    expect(slim.container.querySelector("figcaption")).toBeNull();
  });
});

describe("SchoolGallery", () => {
  it("renders exactly three captioned photos with alt text", () => {
    render(<SchoolGallery />);
    expect(
      screen.getByRole("heading", { name: "Sekilas kegiatan di An Nisaa' Sekolahku" }),
    ).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const item of items) {
      const img = within(item).getByRole("img");
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(0);
      expect(item.querySelector("figcaption")?.textContent?.length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Manasik haji")).toBeInTheDocument();
    expect(screen.getByText("Kegiatan TK A")).toBeInTheDocument();
    expect(screen.getByText("Area bermain")).toBeInTheDocument();
  });

  it("serves local files only, never a remote URL", () => {
    const { container } = render(
      <>
        <SchoolHero />
        <SchoolGallery />
      </>,
    );
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      expect(img.getAttribute("src") ?? "").not.toMatch(/^https?:/);
      expect(src(img)).toContain("/school/");
    }
  });
});
