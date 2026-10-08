import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));
vi.mock("@/components/student-journal/class-day-grid", () => ({ ClassDayGrid: ({ students, onToggle, state }: { students: Array<{ id: string; name: string }>; onToggle:(s:string,i:string)=>void; state:Record<string,Record<string,boolean>> }) => <div data-testid="grid">{students.map((s) => `${s.id}:${s.name}`).join(",")}<button onClick={()=>onToggle(students[0].id,"i1")}>Toggle {String(state[students[0].id]?.i1 ?? false)}</button></div> }));
vi.mock("@/components/student-journal/note-compose-dialog", () => ({ NoteComposeDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import Page from "../page";
const ok = (data: unknown) => ({ ok: true, json: async () => data });
describe("journal entry recovery", () => {
 it("shows picker recovery for missing params", () => { nav.params = new URLSearchParams(); vi.stubGlobal("fetch", vi.fn()); render(<Page />); expect(screen.getByText("Kelas dan tanggal belum dipilih")).toBeInTheDocument(); });
 it("retries rejected grid fetch", async () => { nav.params = new URLSearchParams("classId=c&date=2026-08-03"); let call=0; vi.stubGlobal("fetch", vi.fn(() => ++call === 1 ? Promise.reject(new Error()) : Promise.resolve(ok({ data: { students: [{ id:"s",name:"A",nickname:null }], categories: [], entries: [] } })))); render(<Page />); await screen.findByText("Data kelas tidak bisa dimuat"); expect(screen.queryByTestId("grid")).toBeNull(); fireEvent.click(screen.getByRole("button", { name:"Coba lagi" })); await waitFor(() => expect(screen.getByTestId("grid")).toBeInTheDocument()); });
 it("names the class the grid belongs to, next to the day", async () => { nav.params = new URLSearchParams("classId=c&date=2026-08-03"); vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ data: { students: [{ id:"s",name:"A",nickname:null }], categories: [], entries: [], classSection: { id: "c", name: "DCARE" } } })))); render(<Page />); await screen.findByTestId("grid"); expect(screen.getByText("DCARE · Senin, 3 Agustus 2026")).toBeInTheDocument(); });
 it("shows how much of the class is done and offers a way back to the picker", async () => { nav.params = new URLSearchParams("classId=c&date=2026-08-03"); vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ok({ data: { students: [{ id:"s",name:"A",nickname:null }], categories: [{ id:"cat", name:"Ibadah", order:1, indicators:[{ id:"i1", label:"Doa", order:1 }] }], entries: [], classSection: { id: "c", name: "DCARE" } } })))); render(<Page />); await screen.findByTestId("grid"); expect(screen.getByTestId("class-progress")).toHaveTextContent("0/1 siswa lengkap"); expect(screen.getByRole("link", { name: "Ganti kelas atau tanggal" })).toHaveAttribute("href", "/teacher/student-journal?pick=1&classId=c&date=2026-08-03"); });
 it("keeps newer grid response when an older request resolves later", async () => { let resolveA: (v: unknown) => void = () => {}; let call=0; nav.params=new URLSearchParams("classId=a&date=2026-08-03"); vi.stubGlobal("fetch",vi.fn(()=>++call===1?new Promise(r=>{resolveA=r}):Promise.resolve(ok({data:{students:[{id:"b",name:"B",nickname:null}],categories:[],entries:[]}})))); const view=render(<Page/>); nav.params=new URLSearchParams("classId=b&date=2026-08-03"); view.rerender(<Page/>); await waitFor(()=>expect(screen.getByTestId("grid")).toHaveTextContent("b:B")); resolveA(ok({data:{students:[],categories:[],entries:[]}})); await waitFor(()=>expect(screen.getByTestId("grid")).toHaveTextContent("b:B")); });
});

const grid = {students:[{id:"s",name:"A",nickname:null}],categories:[{id:"cat",name:"School",order:1,indicators:[{id:"i1",label:"Doa",order:1}]}],entries:[]};
it("retries the intended journal value after failure, then confirms persistence",async()=>{
 nav.params=new URLSearchParams("classId=c&date=2026-09-25"); let saves=0;
 vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("class-grid")?Promise.resolve(ok({data:grid})):url.includes("student-attendance")?Promise.resolve(ok([])):++saves===1?Promise.reject(Error("offline")):Promise.resolve(ok({}))));
 render(<Page/>); fireEvent.click(await screen.findByRole("button",{name:"Toggle false"}));
 expect(screen.getByRole("status")).toHaveTextContent("Menyimpan jurnal");
 expect(await screen.findByRole("alert")).toHaveTextContent("Sebagian perubahan belum tersimpan");
 expect(screen.getByRole("button",{name:"Toggle false"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Coba simpan lagi"}));
 await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("Jurnal tersimpan"));
 expect(screen.getByRole("button",{name:"Toggle true"})).toBeInTheDocument();
 expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url])=>String(url).includes("batch")).map(([,init])=>JSON.parse(init.body).entries[0].checked)).toEqual([true,true]);
});
it("ignores an old class-day save failure after navigating to another date",async()=>{
 nav.params=new URLSearchParams("classId=c&date=2026-09-25"); let rejectSave!: (e:Error)=>void; let saves=0;
 vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("class-grid")?Promise.resolve(ok({data:grid})):url.includes("student-attendance")?Promise.resolve(ok([])):(saves++,new Promise((_,reject)=>{rejectSave=reject;}))));
 const view=render(<Page/>);fireEvent.click(await screen.findByRole("button",{name:"Toggle false"}));
 await waitFor(()=>expect(saves).toBe(1));
 nav.params=new URLSearchParams("classId=c&date=2026-09-24");view.rerender(<Page/>);
 await screen.findByRole("button",{name:"Toggle false"});
 await act(async()=>{rejectSave(Error("old failure"));});
 expect(screen.queryByRole("alert")).toBeNull();
 expect(screen.queryByRole("button",{name:"Coba simpan lagi"})).toBeNull();
});
