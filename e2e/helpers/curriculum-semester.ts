import { expect, type Page } from "@playwright/test";

/** Isolate week-authoring tests from the seeded semester's occupied weeks. */
export async function createCurriculumSemester(page: Page, headers: Record<string, string> = {}) {
  const response = await page.request.get("/api/academic-years", { headers });
  expect(response.ok()).toBeTruthy();
  const years = await response.json() as Array<{ startDate: string; endDate: string }>;
  let year = 9000;
  while (years.some((existing) => existing.startDate <= `${year}-12-31` && existing.endDate >= `${year}-01-01`)) year++;
  const yearName = `E2E Curriculum ${year}`;
  const createdYear = await page.request.post("/api/academic-years", {
    headers,
    data: { name: yearName, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "PLANNING" },
  });
  expect(createdYear.ok(), await createdYear.text()).toBeTruthy();
  const academicYear = await createdYear.json() as { id: string };
  const createdSemester = await page.request.post("/api/admin/curriculum/semesters", {
    headers,
    data: { academicYearId: academicYear.id, number: 1, startDate: `${year}-01-01`, endDate: `${year}-06-30` },
  });
  expect(createdSemester.ok(), await createdSemester.text()).toBeTruthy();
  const semester = await createdSemester.json() as { id: string };
  const monday = new Date(`${year}-01-01T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7);
  return { semesterId: semester.id, yearName, monday };
}
