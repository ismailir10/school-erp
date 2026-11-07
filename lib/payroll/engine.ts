import { countAttendanceDays } from "./working-days";

export type SalaryComponent = {
  id: string;
  code: string;
  label: string;
  category: "INCOME" | "DEDUCTION";
  calcType: "FIXED" | "PCT_OF_BASE" | "ATTENDANCE_BASED";
  isProRated: boolean;
  sortOrder: number;
};

export type EmployeeSalaryValue = {
  componentDefId: string;
  value: number;
};

export type AttendanceVariables = {
  overtimeHours: number;
  outdoorDays: number;
  holidayWorkedDays: number;
  dcDays: number;
  /**
   * F-14: when true, the `lembur` ATTENDANCE_BASED component follows
   * UU 13/2003 §78(4) tiered rates (1.5× first hour, 2× thereafter on
   * weekdays). When false/undefined, the historical flat formula
   * `perUnitValue * overtimeHours` is used. Sourced from
   * `OrgConfig.lemburCompliant` and threaded through `calculatePayroll`.
   */
  lemburCompliant?: boolean;
};

export type PayrollLineResult = {
  componentDefId: string;
  labelSnapshot: string;
  categorySnapshot: "INCOME" | "DEDUCTION";
  calculatedAmount: number;
  finalAmount: number;
};

export type PayrollItemResult = {
  lines: PayrollLineResult[];
  grossAmount: number;
  deductions: number;
  netAmount: number;
};

/**
 * Calculate payroll for a single employee.
 */
export function calculateEmployeePayroll(
  components: SalaryComponent[],
  salaryValues: EmployeeSalaryValue[],
  daysPresent: number,
  daysLeave: number,
  actualWorkingDays: number,
  variables: AttendanceVariables
): PayrollItemResult {
  const valueMap = new Map<string, number>();
  for (const sv of salaryValues) {
    valueMap.set(sv.componentDefId, sv.value);
  }

  // Sort components by sortOrder
  const sorted = [...components].sort((a, b) => a.sortOrder - b.sortOrder);

  const lines: PayrollLineResult[] = [];
  let gajiPokokAmount = 0;

  // Total present for pro-rating includes leave (paid leave counts)
  const totalPresentForProRating = daysPresent + daysLeave;

  for (const comp of sorted) {
    const baseValue = valueMap.get(comp.id) ?? 0;
    let amount = 0;

    switch (comp.calcType) {
      case "FIXED":
        if (comp.isProRated && actualWorkingDays > 0) {
          amount = baseValue * (totalPresentForProRating / actualWorkingDays);
        } else {
          amount = baseValue;
        }
        break;

      case "PCT_OF_BASE":
        amount = gajiPokokAmount * (baseValue / 100);
        break;

      case "ATTENDANCE_BASED":
        amount = calculateAttendanceBased(comp.code, baseValue, daysPresent, variables);
        break;
    }

    // Capture gaji_pokok BEFORE rounding so PCT_OF_BASE components use the
    // exact base and rounding error does not compound across dependent lines.
    if (comp.code === "gaji_pokok") {
      gajiPokokAmount = amount;
    }

    const finalAmount = Math.round(amount);

    lines.push({
      componentDefId: comp.id,
      labelSnapshot: comp.label,
      categorySnapshot: comp.category,
      calculatedAmount: finalAmount,
      finalAmount,
    });
  }

  const grossAmount = lines
    .filter((l) => l.categorySnapshot === "INCOME")
    .reduce((sum, l) => sum + l.finalAmount, 0);

  const deductions = lines
    .filter((l) => l.categorySnapshot === "DEDUCTION")
    .reduce((sum, l) => sum + l.finalAmount, 0);

  return {
    lines,
    grossAmount,
    deductions,
    netAmount: grossAmount - deductions,
  };
}

/**
 * Determine the multiplier for ATTENDANCE_BASED components.
 */
function calculateAttendanceBased(
  code: string,
  perUnitValue: number,
  daysPresent: number,
  variables: AttendanceVariables
): number {
  switch (code) {
    case "tunjangan_transport":
      return perUnitValue * daysPresent;
    case "tunjangan_msk":
      return perUnitValue * variables.holidayWorkedDays;
    case "insentif_outdoor":
      return perUnitValue * variables.outdoorDays;
    case "insentif_libur":
      return perUnitValue * variables.holidayWorkedDays;
    case "insentif_dc":
      return perUnitValue * variables.dcDays;
    case "lembur": {
      // COMPLIANCE NOTE: Indonesian labor law (UU 13/2003 Art. 78(4)) requires overtime
      // premium rates: 1.5x hourly rate for the first hour, 2x for subsequent hours on weekdays;
      // 2x hourly rate + daily wage for holiday overtime. The flat formula below is the
      // historical (non-compliant) path; when `OrgConfig.lemburCompliant` is true the engine
      // applies the tiered rates per F-14. Holiday-overtime handling remains a follow-up.
      if (variables.lemburCompliant) {
        const hours = variables.overtimeHours;
        if (hours <= 0) return 0;
        const firstHourPortion = Math.min(hours, 1);
        const remainingHours = Math.max(0, hours - 1);
        return firstHourPortion * perUnitValue * 1.5 + remainingHours * perUnitValue * 2;
      }
      return perUnitValue * variables.overtimeHours;
    }
    default:
      // Generic attendance-based: multiply by days present
      return perUnitValue * daysPresent;
  }
}

/**
 * Validate that `gaji_pokok` precedes every PCT_OF_BASE component in
 * sortOrder. The engine captures `gajiPokokAmount` lazily as it iterates
 * sorted components; if a PCT_OF_BASE row appears before `gaji_pokok`, the
 * percentage is silently computed against 0 and the slip looks plausible
 * (no error, no NaN) but the value is wrong. F-15 closes this trap by
 * failing loud at calculation time.
 */
export function assertGajiPokokSortOrder(components: SalaryComponent[]): void {
  const gajiPokok = components.find((c) => c.code === "gaji_pokok");
  if (!gajiPokok) return; // No gaji_pokok configured — nothing to validate
  for (const c of components) {
    if (c.calcType === "PCT_OF_BASE" && c.sortOrder <= gajiPokok.sortOrder) {
      throw new Error("gaji_pokok must precede all PCT_OF_BASE components in sortOrder");
    }
  }
}

/**
 * Calculate payroll for all employees in a period.
 */
export type CalculatePayrollOptions = {
  /**
   * F-14: when true, propagate `lemburCompliant=true` into every employee's
   * AttendanceVariables so the engine applies UU 13/2003 §78(4) tiered
   * overtime rates. Per-employee `variables.lemburCompliant`, if explicitly
   * set, takes precedence over this org-wide default.
   */
  lemburCompliant?: boolean;
};

export function calculatePayroll(
  employees: {
    id: string;
    salaryValues: EmployeeSalaryValue[];
    attendanceRecords: { status: string; approvalStatus?: string | null }[];
    variables?: AttendanceVariables;
  }[],
  components: SalaryComponent[],
  actualWorkingDays: number,
  options: CalculatePayrollOptions = {}
): Map<string, PayrollItemResult> {
  if (actualWorkingDays <= 0) {
    throw new Error(
      `actualWorkingDays must be > 0, got ${actualWorkingDays}. ` +
      "Check that the payroll period has working days configured and holidays are not covering the entire period."
    );
  }

  assertGajiPokokSortOrder(components);

  const results = new Map<string, PayrollItemResult>();

  const defaultVars: AttendanceVariables = {
    overtimeHours: 0,
    outdoorDays: 0,
    holidayWorkedDays: 0,
    dcDays: 0,
    lemburCompliant: options.lemburCompliant ?? false,
  };

  for (const emp of employees) {
    const { daysPresent, daysLeave } = countAttendanceDays(emp.attendanceRecords);
    // Per-employee variables (if provided) win, but inherit the org-wide
    // lemburCompliant flag when the caller did not set it explicitly.
    const variables: AttendanceVariables = emp.variables
      ? {
          ...emp.variables,
          lemburCompliant: emp.variables.lemburCompliant ?? options.lemburCompliant ?? false,
        }
      : defaultVars;
    const result = calculateEmployeePayroll(
      components,
      emp.salaryValues,
      daysPresent,
      daysLeave,
      actualWorkingDays,
      variables
    );
    results.set(emp.id, result);
  }

  return results;
}
