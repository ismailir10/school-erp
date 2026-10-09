import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchoolGallery, SchoolHero } from "../school-photos";

const src = (img: Element) => decodeURIComponent(img.getAttribute("src") ?? "");

describe("SchoolHero", () => {
  it("renders the classroom photo with Indonesian alt text and explicit dimensions", () => {
    render(<SchoolHero />);
    const img = screen.getByRole("img", {
      name: "Guru dan murid kelas Taman Aster menunjukkan kaos hasil lukisan mereka",
    });
    expect(src(img)).toContain("/school/suasana-kelas.webp");
    expect(img).toHaveAttribute("width", "960");
    expect(img).toHaveAttribute("height", "540");
  });

  it("full variant is 16:9 with a caption; slim is 3:1 with none", () => {
    const { container, unmount } = render(<SchoolHero />);
    expect(container.querySelector("img")?.className).toContain("aspect-[16/9]");
    expect(screen.getByText("Suasana belajar di An Nisaa' Sekolahku")).toBeInTheDocument();
    unmount();

    const slim = render(<SchoolHero variant="slim" />);
    const img = slim.container.querySelector("img");
    expect(img?.className).toContain("aspect-[3/1]");
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
    expect(screen.getByText("Fun cooking")).toBeInTheDocument();
    expect(screen.getByText("Manasik haji")).toBeInTheDocument();
    expect(screen.getByText("Hari profesi")).toBeInTheDocument();
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
