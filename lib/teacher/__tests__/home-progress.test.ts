import { describe, expect, it } from "vitest";
import { BULK_ABSENCE_LABELS } from "@/components/student-journal/class-bulk-sheet";
import { getJournalProgress, isJournalAbsentStatus, resolveTeacherDate, teacherSlotRank, compareTeacherClasses } from "../home-progress";
describe("teacher work summaries", () => {
  it("requires every active indicator for each active student, ignoring duplicate and retired ticks", () => {
    const input = {studentIds:["a","b"],indicatorIds:["i","j"],entries:[
      {studentId:"a",indicatorId:"i",checked:true},{studentId:"a",indicatorId:"j",checked:true},
      {studentId:"a",indicatorId:"j",checked:true},{studentId:"b",indicatorId:"i",checked:true},
      {studentId:"b",indicatorId:"retired",checked:true},{studentId:"withdrawn",indicatorId:"j",checked:true}]};
    expect(getJournalProgress(input)).toEqual({configured:true,totalStudents:2,completeStudents:1,completed:false,absentCount:0});
    expect(getJournalProgress({...input, entries:[...input.entries,{studentId:"b",indicatorId:"j",checked:true}]}).completed).toBe(true);
  });
  it("does not claim completion with no indicators or no pupils", () => {
    expect(getJournalProgress({studentIds:["a"],indicatorIds:[],entries:[]}).configured).toBe(false);
    expect(getJournalProgress({studentIds:[],indicatorIds:["i"],entries:[]}).completed).toBe(false);
  });
  it("rejects impossible and noncanonical dates", () => {
    for (const date of ["2026-02-30","2026-13-01","2026-1-01","","foo"]) expect(resolveTeacherDate(date,"2026-09-25")).toBe("2026-09-25");
    expect(resolveTeacherDate("2024-02-29", "fallback")).toBe("2024-02-29");
  });
  it("prioritizes afternoon sessions in school afternoon", () => {
    expect(teacherSlotRank("AFTERNOON",14)).toBeLessThan(teacherSlotRank("MORNING",14));
    expect(teacherSlotRank("MORNING",8)).toBeLessThan(teacherSlotRank("AFTERNOON",8));
  });
});

it("defaults to homeroom when no class has a timetable, while preserving effective-session priority", () => {
 const homeroom = {slot:null,isHomeroom:true};
 const assistant = {slot:null,isHomeroom:false};
 expect(compareTeacherClasses(homeroom,assistant,9)).toBeLessThan(0);
 expect(compareTeacherClasses({...assistant,slot:"MORNING"},homeroom,9)).toBeLessThan(0);
 expect(compareTeacherClasses({...assistant,slot:"AFTERNOON"},{...homeroom,slot:"MORNING"},14)).toBeLessThan(0);
 expect(compareTeacherClasses({...homeroom,slot:"MORNING"},{...assistant,slot:"MORNING"},9)).toBeLessThan(0);
});

describe("journal progress with absent pupils (R2-T-5)", () => {
  const base = {studentIds:["a","b","c"],indicatorIds:["i"],entries:[{studentId:"a",indicatorId:"i",checked:true},{studentId:"b",indicatorId:"i",checked:true}]};
  it("drops Sakit/Izin/Alpa pupils from numerator and denominator so the day can complete", () => {
    expect(getJournalProgress(base)).toMatchObject({totalStudents:3,completeStudents:2,completed:false});
    expect(getJournalProgress({...base,excludedStudentIds:["c"]})).toEqual({configured:true,totalStudents:2,completeStudents:2,completed:true,absentCount:1});
  });
  it("does not count ticks on an absent pupil", () => {
    const r = getJournalProgress({...base,excludedStudentIds:new Set(["a"])});
    expect(r).toMatchObject({totalStudents:2,completeStudents:1,completed:false,absentCount:1});
  });
  it("treats a class where everyone is absent as nothing left to fill, but an empty class is still not done", () => {
    expect(getJournalProgress({...base,excludedStudentIds:["a","b","c"]})).toMatchObject({totalStudents:0,completeStudents:0,completed:true,absentCount:3});
    expect(getJournalProgress({studentIds:[],indicatorIds:["i"],entries:[],excludedStudentIds:["x"]}).completed).toBe(false);
  });
  it("ignores excluded ids that are not on the roster", () => {
    expect(getJournalProgress({...base,excludedStudentIds:["ghost"]}).absentCount).toBe(0);
  });
  it("uses the same absence statuses as the bulk sheet", () => {
    for (const status of Object.keys(BULK_ABSENCE_LABELS)) expect(isJournalAbsentStatus(status)).toBe(true);
    for (const status of ["PRESENT","LATE",null,undefined,""]) expect(isJournalAbsentStatus(status)).toBe(false);
  });
});
