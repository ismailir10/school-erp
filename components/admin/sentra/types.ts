export type SentraRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  sortOrder: number;
  legacyCenter: string | null;
  teachers: { employeeId: string; name: string }[];
};

export type RotationRow = {
  id: string;
  name: string;
  startDate: string;
  cycleDays: number;
  status: "ACTIVE" | "INACTIVE";
  academicYear: { id: string; name: string; status: string };
  classes: { classSectionId: string; name: string }[];
};

export type SentraOptions = {
  employees: { id: string; name: string }[];
  classes: { id: string; name: string; academicYearId: string }[];
  academicYears: { id: string; name: string; status: string }[];
};

export type RotationDetail = {
  id: string;
  name: string;
  campusId: string;
  startDate: string;
  cycleDays: number;
  status: "ACTIVE" | "INACTIVE";
  academicYear: { id: string; name: string; status: string };
  classes: { classSectionId: string; name: string }[];
  slots: { dayIndex: number; classSectionId: string; sentraId: string | null }[];
  sentra: { id: string; name: string; status: "ACTIVE" | "INACTIVE" }[];
};
