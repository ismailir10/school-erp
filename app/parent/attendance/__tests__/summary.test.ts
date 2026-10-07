import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const mocks=vi.hoisted(()=>({session:vi.fn(),family:vi.fn(),rows:vi.fn(),sessions:vi.fn(),notes:vi.fn()}));
vi.mock("@/lib/auth",()=>({getSession:mocks.session}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(`redirect:${url}`);}}));
vi.mock("@/lib/parent-helpers",()=>({getParentWithChildren:mocks.family,resolveSelectedChild:(children:Array<{studentId:string}>,id:string)=>children.find(c=>c.studentId===id)??children[0]}));
vi.mock("@/lib/db",()=>({prisma:{studentAttendance:{findMany:mocks.rows},classSession:{findMany:mocks.sessions},studentJournalNote:{findMany:mocks.notes}}}));
vi.mock("@/components/parent/child-selector-tabs",()=>({ChildSelectorTabs:()=>null}));
import Page from "../page";
const child={studentId:"child",studentName:"Alya Putri",studentNickname:"Alya",className:"TK A",programName:"TK"};
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({role:"GUARDIAN",tenantId:"tenant"});mocks.family.mockResolvedValue({parent:{id:"parent"},children:[child]});mocks.rows.mockResolvedValue([]);mocks.sessions.mockResolvedValue([]);mocks.notes.mockResolvedValue([]);});
describe("parent attendance mixed-day recovery",()=>{
 it("shows both class/status identities instead of a false all-present banner",async()=>{
  const rows=["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25"].map(date=>({studentId:"child",classSectionId:"school",sessionId:null,date,status:"PRESENT",notes:null,classSection:{name:"TK A"}}));
  mocks.rows.mockResolvedValue([...rows,{...rows[4],classSectionId:"care",status:"SICK",notes:"Istirahat",classSection:{name:"Daycare"}}]);
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2026-09-21"})}));
  expect(html).toContain("Catatan berbeda");expect(html).toContain("TK A: Hadir");expect(html).toContain("Daycare: Sakit");expect(html).not.toContain("Istirahat");expect(html).not.toContain("Hadir 5 dari 5 hari");expect(html).not.toContain("hadir penuh pekan ini");
 });
 it("queries only actual teacher notes and never labels another guardian as Anda",async()=>{
  const notes=[{id:"teacher",date:"2026-09-25",body:"Teacher message",authorRole:"TEACHER"},{id:"guardian",date:"2026-09-25",body:"Other guardian message",authorRole:"GUARDIAN"},{id:"admin",date:"2026-09-25",body:"Admin message",authorRole:"SCHOOL_ADMIN"}];
  mocks.notes.mockImplementation(async ({where})=>notes.filter(note=>note.authorRole===where.authorRole));
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2026-09-21"})}));
  expect(mocks.notes).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:"tenant",studentId:"child",status:"ACTIVE",authorRole:"TEACHER"})}));
  expect(html).toContain("Teacher message");expect(html).not.toContain("Other guardian message");expect(html).not.toContain("Admin message");expect(html).not.toContain("Anda");
 });
 it("preserves a truly missing week without claiming conflicting records",async()=>{
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2025-09-22"})}));
  expect(html).toContain("Belum ada catatan kehadiran");expect(html).not.toContain("Catatan berbeda");
  expect(mocks.rows).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({studentId:{in:["child"]},student:{tenantId:"tenant"}})}));
 });
 it("keeps the get-well line for Sakit and drops it for Alpa-only and Izin-only weeks (TCH-12 / X-7)",async()=>{
  const week=["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25"];
  const rowsWith=(fifth:string)=>week.map((date,i)=>({studentId:"child",classSectionId:"school",sessionId:null,date,status:i===4?fifth:"PRESENT",notes:null,classSection:{name:"TK A"}}));
  const render=async()=>renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2026-09-21"})}));
  mocks.rows.mockResolvedValue(rowsWith("SICK"));
  expect(await render()).toContain("semoga lekas sehat");
  mocks.rows.mockResolvedValue(rowsWith("ABSENT"));
  const alpa=await render();
  expect(alpa).not.toContain("lekas sehat");expect(alpa).toContain("tanpa keterangan");
  mocks.rows.mockResolvedValue(rowsWith("PERMISSION"));
  const izin=await render();
  expect(izin).not.toContain("lekas sehat");expect(izin).toContain("sedang izin pekan ini");
 });
 it("leads with the unexplained absence when Alpa and Sakit share a week (PARX-4)",async()=>{
  const week=["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25"];
  const statuses=["PRESENT","SICK","ABSENT","PRESENT","PRESENT"];
  mocks.rows.mockResolvedValue(week.map((date,i)=>({studentId:"child",classSectionId:"school",sessionId:null,date,status:statuses[i],notes:null,classSection:{name:"TK A"}})));
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2026-09-21"})}));
  expect(html).toContain("tanpa keterangan");expect(html).toContain("Hubungi Ustadzah jika ada kabar");expect(html).not.toContain("lekas sehat");
 });
 it("prints DD/MM headers, labels the status row Status and offers a way back off the current week (X-12/X-13/PARX-12)",async()=>{
  const week=["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25"];
  mocks.rows.mockResolvedValue(week.map(date=>({studentId:"child",classSectionId:"school",sessionId:null,date,status:"PRESENT",notes:null,classSection:{name:"TK A"}})));
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({child:"child",week:"2026-09-21"})}));
  expect(html).toContain("21/09");expect(html).not.toContain("09/21");
  expect(html).toContain(">Status<");expect(html).not.toContain(">Hadir</td>");
  expect(html).toContain("Kembali ke pekan ini");expect(html).toContain("bg-background");
 });
});
