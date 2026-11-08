import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(()=>({teachingAssignment:{findFirst:vi.fn(),findMany:vi.fn()},sentraRotationClass:{findFirst:vi.fn().mockResolvedValue(null)},classSection:{findFirst:vi.fn()},classSession:{findMany:vi.fn()},studentEnrollment:{findMany:vi.fn()},studentAttendance:{findMany:vi.fn(),count:vi.fn()}}));
const auth = vi.hoisted(()=>({getSession:vi.fn()}));
vi.mock("@/lib/db",()=>({prisma:db}));
vi.mock("@/lib/auth",()=>({...auth,isAdminRole:(role:string)=>["SUPER_ADMIN","SCHOOL_ADMIN"].includes(role)}));
import { GET } from "../student-attendance/route";
import { GET as myClasses } from "../teaching-assignments/my/route";
const session={id:"teacher",role:"TEACHER",tenantId:"tenant-a",employeeId:"employee-a"};
const req=(query:string)=>new NextRequest(`http://localhost/api/student-attendance?${query}`);
beforeEach(()=>{vi.resetAllMocks();auth.getSession.mockResolvedValue(session);db.classSection.findFirst.mockResolvedValue({id:"assigned"});db.studentEnrollment.findMany.mockResolvedValue([{student:{id:"child"}}]);db.studentAttendance.findMany.mockResolvedValue([]);db.classSession.findMany.mockResolvedValue([]);});
describe("teacher roster authorization",()=>{
 it("permits own historical assignment and enforces tenant on the actual access query",async()=>{
  db.teachingAssignment.findFirst.mockResolvedValue({id:"assignment"});
  const result=await GET(req("classSectionId=assigned&date=2025-01-02"));expect(result.status).toBe(200);
  expect(db.teachingAssignment.findFirst).toHaveBeenCalledWith({where:{employeeId:"employee-a",classSectionId:"assigned",classSection:{tenantId:"tenant-a"}},select:{id:true}});
  expect(await result.json()).toEqual([{student:{id:"child"},attendance:null}]);
 });
 it.each(["unassigned-same-tenant","foreign-tenant"])("rejects forged %s before reading children",async(id)=>{
  db.teachingAssignment.findFirst.mockResolvedValue(null);
  expect((await GET(req(`classSectionId=${id}&date=2026-09-25`))).status).toBe(403);
  expect(db.studentEnrollment.findMany).not.toHaveBeenCalled();expect(db.studentAttendance.findMany).not.toHaveBeenCalled();
 });
 it("denies a teacher requesting the unrestricted admin list",async()=>{
  expect((await GET(req("mode=list"))).status).toBe(403);expect(db.studentAttendance.findMany).not.toHaveBeenCalled();
 });
 it("denies guardian access to teacher roster and employee-less teachers",async()=>{
  auth.getSession.mockResolvedValue({...session,role:"GUARDIAN"});expect((await GET(req("classSectionId=assigned"))).status).toBe(403);
  auth.getSession.mockResolvedValue({...session,employeeId:null});expect((await GET(req("classSectionId=assigned"))).status).toBe(403);
 });
 it("rejects impossible dates without a roster read",async()=>{
  expect((await GET(req("classSectionId=assigned&date=2026-02-30"))).status).toBe(400);expect(db.studentAttendance.findMany).not.toHaveBeenCalled();
 });
 it("returns 404 for an admin requesting a foreign tenant class",async()=>{
  auth.getSession.mockResolvedValue({...session,role:"SCHOOL_ADMIN"});db.classSection.findFirst.mockResolvedValue(null);
  expect((await GET(req("classSectionId=foreign"))).status).toBe(404);
  expect(db.classSection.findFirst).toHaveBeenCalledWith({where:{id:"foreign",tenantId:"tenant-a"}});
 });
 it("scopes assignment choices to the current teacher and preserves historical assignments",async()=>{
  db.teachingAssignment.findMany.mockResolvedValue([]);expect((await myClasses()).status).toBe(200);
  expect(db.teachingAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{employeeId:"employee-a",classSection:{tenantId:"tenant-a"}}}));
 });
 it("rejects non-teachers from assignment choices",async()=>{
  auth.getSession.mockResolvedValue({...session,role:"GUARDIAN"});expect((await myClasses()).status).toBe(403);expect(db.teachingAssignment.findMany).not.toHaveBeenCalled();
 });
});
