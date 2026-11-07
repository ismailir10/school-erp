"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookHeart, CalendarDays, CalendarX, CheckCircle2, ClipboardList, DoorOpen, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { TaskList, TaskRow } from "@/components/portal/task-list";
import { SaveStatus } from "@/components/portal/save-status";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { describeFetchFailure, failureFromError, FetchFailureError } from "@/lib/teacher/fetch-error-copy";
import { LEAVE_TYPE_LABEL, type LeaveDecision } from "@/lib/teacher/leave-decisions";
import type { TeacherClassSummary, TeacherSessionSummary } from "@/lib/teacher/home-progress";

/** `minutesLate`: minutes past work start for a LATE check-in; null when it cannot be derived. */
type TodayRecord = { status: string; checkInTime: string | null; checkOutTime: string | null; minutesLate?: number | null; approvalStatus?: string };
type Gps = { lat: number; lng: number; accuracy: number };
/** 422 OUTSIDE_GEOFENCE payload: distance is null when the phone gave no location. */
type OutsideInfo = { distanceMeters: number | null; campusName: string | null };
const MIN_NOTE = 3;
const SLOT_LABEL: Record<string,string> = {FULL_DAY:"Sehari penuh",MORNING:"Pagi",AFTERNOON:"Siang"};

export function nextStateAfterAction(record: TodayRecord | null, action: "check-in" | "check-out", now=new Date().toISOString()): TodayRecord {
  return action === "check-in" ? {status:"PRESENT",checkInTime:record?.checkInTime??now,checkOutTime:record?.checkOutTime??null}
    : {status:record?.status??"PRESENT",checkInTime:record?.checkInTime??now,checkOutTime:record?.checkOutTime??now};
}

export function TeacherHomeClient({userName,todayRecord,today,greeting="datang",classes=[],todaySessions=[],leaveDecisions=[],homeroomClassSectionName,attendanceUnavailable=false,classesUnavailable=false,sessionsUnavailable=false,gateSummary=null}: {
  userName:string; todayRecord:TodayRecord|null; today:string; greeting?:string; classes?:TeacherClassSummary[];
  todaySessions?:TeacherSessionSummary[]; leaveDecisions?:LeaveDecision[]; homeroomClassSectionName?:string|null;
  attendanceUnavailable?:boolean; classesUnavailable?:boolean; sessionsUnavailable?:boolean; gateSummary?:{total:number;arrived:number;pickedUp:number}|null;
}) {
  const router=useRouter();
  const [record,setRecord]=useState(todayRecord);
  // Refresh also reconciles a response lost after a successful server write.
  useEffect(() => { setRecord(todayRecord); }, [todayRecord]);
  const [saving,setSaving]=useState(false);
  const inFlight=useRef(false);
  const [saveError,setSaveError]=useState<string|null>(null);
  const [canRetry,setCanRetry]=useState(true);
  const [saved,setSaved]=useState(false);
  const [locationMessage,setLocationMessage]=useState<string|null>(null);
  // Geofence: set when the server answers 422 OUTSIDE_GEOFENCE; the sheet then asks for a note.
  const [outside,setOutside]=useState<OutsideInfo|null>(null);
  const [note,setNote]=useState("");
  const gpsRef=useRef<Gps|null>(null);
  const noteFormId=useId();
  // Attendance is assignment-only: a sentra-only card never asks for it.
  const attendanceOpen=(c:TeacherClassSummary)=>!c.sentraOnly && (c.attendanceRecorded === null || c.attendanceRecorded < c.rosterCount);
  const primary=classes.find(c => c.rosterCount > 0 && (attendanceOpen(c) || !c.journal?.completed)) ?? classes[0];
  const dateLabel=formatDate(today,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  const classHref=(id:string,journey:"attendance"|"journal")=>`/teacher/${journey==="attendance"?"class-attendance":"student-journal/entry"}?classId=${encodeURIComponent(id)}&date=${today}`;
  const needsAttendance=primary && attendanceOpen(primary);
  const needsJournal=primary && (!primary.journal || !primary.journal.completed);
  const primaryHref=primary ? classHref(primary.id,needsAttendance?"attendance":"journal") : "";
  const sentraBadge=(c:TeacherClassSummary)=>c.sentraTag?<span className="rounded-full bg-primary/10 px-2 py-0.5 text-small font-semibold text-primary-text" data-testid="sentra-tag">{c.sentraTag} · hari ini</span>:null;
  const primaryLabel=primary ? needsAttendance ? primary.attendanceRecorded===null ? "Buka absensi kelas" : `Lanjutkan absensi · ${primary.attendanceRecorded}/${primary.rosterCount}`
    : needsJournal ? "Lanjutkan jurnal harian" : "Periksa jurnal harian" : "";
  const replyRows=[...new Map(classes.flatMap(c=>(c.replies??[]).map(reply=>[reply.studentId,{...reply,className:c.name}] as const))).values()];

  /** `withNote`: the sheet's resubmit — reuses the first fix instead of asking the phone again. */
  async function handleAction(withNote?:string){
    if(inFlight.current || record?.checkOutTime)return;
    inFlight.current=true;setSaving(true);setSaveError(null);setCanRetry(true);setSaved(false);
    const action=record?.checkInTime?"check-out":"check-in";
    try {
      const gps=withNote!==undefined ? gpsRef.current : await new Promise<Gps|null>(resolve=>{
        if(!navigator.geolocation){setLocationMessage("Lokasi tidak tersedia; kehadiran tetap dapat dicatat.");resolve(null);return;}
        navigator.geolocation.getCurrentPosition(p=>{setLocationMessage("Lokasi tercatat.");resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy});},()=>{setLocationMessage("Lokasi tidak tersedia; kehadiran tetap dapat dicatat.");resolve(null);},{timeout:10000,enableHighAccuracy:true});
      });
      gpsRef.current=gps;
      // Mapped copy only: raw API/browser text ("Failed to fetch") never reaches the teacher.
      let response:Response;
      try{response=await fetch(`/api/attendance/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...(gps??{}),...(withNote!==undefined?{note:withNote}:{})})});}
      catch{throw new FetchFailureError(describeFetchFailure({networkError:true,action:"disimpan"}));}
      const body=await response.json().catch(()=>null);
      if(response.status===422 && body?.code==="OUTSIDE_GEOFENCE" && action==="check-in"){
        setOutside({distanceMeters:typeof body.distanceMeters==="number"?body.distanceMeters:null,campusName:typeof body.campusName==="string"?body.campusName:null});
        return;
      }
      const data=response.ok?body:body?.record;
      if(!data)throw new FetchFailureError(describeFetchFailure({status:response.status,action:"disimpan",serverMessage:typeof body?.error==="string"?body.error:undefined}));
      if(!data.checkInTime || (action==="check-out"&&!data.checkOutTime))throw new FetchFailureError({kind:"server",canRetry:true,message:"Konfirmasi kehadiran belum tersedia. Coba lagi ya."});
      setRecord({status:data.status,checkInTime:data.checkInTime,checkOutTime:data.checkOutTime,minutesLate:typeof data.minutesLate==="number"?data.minutesLate:record?.minutesLate??null,approvalStatus:typeof data.approvalStatus==="string"?data.approvalStatus:record?.approvalStatus});setOutside(null);setNote("");setSaved(true);router.refresh();
    }catch(error){const failure=failureFromError(error,"disimpan");setSaveError(failure.kind==="forbidden"?"Akun Anda belum bisa mencatat kehadiran. Hubungi admin sekolah.":failure.message);setCanRetry(failure.canRetry);}
    finally{inFlight.current=false;setSaving(false);}
  }
  // LATE is stored by the server (work start + grace); the minutes are shown when the page could derive them.
  const pending=record?.approvalStatus==="PENDING";
  const trimmedNote=note.trim();
  const outsideCopy=outside?(outside.distanceMeters===null?"Lokasi tidak terbaca. Tambahkan catatan agar admin dapat menyetujui.":`Anda ± ${outside.distanceMeters} m dari ${outside.campusName??"kampus"}. Tambahkan catatan agar admin dapat menyetujui.`):"";
  const lateLabel=record?.status==="LATE" ? record.minutesLate ? ` · Terlambat ${record.minutesLate} menit` : " · Terlambat" : "";
  const personalAttendance=(
    <div className="space-y-2" aria-label="Kehadiran pribadi">
      {attendanceUnavailable ? <EmptyState title="Kehadiran pribadi belum bisa dimuat" description="Muat ulang sebelum mencatat masuk atau pulang." actionLabel="Coba lagi" onAction={()=>router.refresh()} /> : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-small">
          <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {record?.checkInTime ? <CheckCircle2 className="size-4 shrink-0 text-status-present-text" aria-hidden="true"/> : null}
            {record?.checkOutTime ? `Masuk ${formatTime(record.checkInTime)}${lateLabel} · pulang ${formatTime(record.checkOutTime)}` : record?.checkInTime ? `Masuk ${formatTime(record.checkInTime)}${lateLabel} · sudah tercatat` : "Kehadiran pribadi belum dicatat"}
          </p>
          {pending ? <span className="rounded-full bg-status-late-subtle px-2 py-0.5 text-small font-semibold text-status-late-text" data-testid="pending-approval-chip">Menunggu persetujuan</span> : null}
          {!record?.checkOutTime && <Button variant="outline" disabled={saving} onClick={()=>handleAction()} className="min-h-11">{saving?"Menyimpan…":saveError&&canRetry?"Coba lagi":record?.checkInTime?"Catat pulang":"Catat masuk"}</Button>}
        </div>
      )}
      {saving||saveError||saved ? <SaveStatus state={saving?"saving":saveError?"error":"saved"} message={saveError??(saving?"Menyimpan kehadiran…":"Kehadiran tersimpan")} />:null}
      {locationMessage?<p className="text-small text-muted-foreground">{locationMessage}</p>:null}
    </div>
  );
  return <div className="space-y-6">
    <ResponsiveFormDialog open={outside!==null} onOpenChange={o=>{if(!o&&!saving){setOutside(null);setSaveError(null);}}} title="Anda di luar area kampus" description={outsideCopy} size="md"
      footer={<FormDialogFooter formId={noteFormId} pending={saving} disabled={trimmedNote.length<MIN_NOTE} onCancel={()=>{setOutside(null);setSaveError(null);}} submitLabel="Kirim untuk disetujui" pendingLabel="Mengirim…"/>}>
      <form id={noteFormId} onSubmit={e=>{e.preventDefault();if(trimmedNote.length>=MIN_NOTE)void handleAction(trimmedNote);}} className="space-y-2">
        <label htmlFor="checkin-note" className="text-small font-semibold">Catatan untuk admin</label>
        <Textarea id="checkin-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={3} placeholder="Contoh: mengantar siswa ke dokter" className="text-base"/>
        {saveError?<p className="text-small text-destructive">{saveError}</p>:null}
      </form>
    </ResponsiveFormDialog>
    <PageHeader title={`Selamat ${greeting}, ${userName}`} subtitle={dateLabel} className="mb-0"/>
    {/* First in both states so the control the teacher needs on arrival never moves after the tap (R2-T-1). */}
    {personalAttendance}
    {/* Next step after check-in, at both ends of the day; fixed place so it never moves. */}
    <TaskList>
      <TaskRow title="Gerbang" description={gateSummary&&gateSummary.total>0?`${gateSummary.arrived} dari ${gateSummary.total} sudah masuk · ${gateSummary.pickedUp} pulang`:"Catat anak masuk dan pulang di gerbang"} meta="Buka" href="/teacher/gate" icon={<DoorOpen className="size-5"/>}/>
    </TaskList>
    {leaveDecisions.length>0?<section aria-labelledby="leave-decisions" data-testid="leave-decisions"><h2 id="leave-decisions" className="mb-3 text-h2">Keputusan cuti</h2><TaskList>
      {leaveDecisions.map(d=>{const approved=d.status==="APPROVED";const range=d.startDate===d.endDate?formatDateShort(d.startDate):`${formatDateShort(d.startDate)}–${formatDateShort(d.endDate)}`;
        return <TaskRow key={d.id} title={`${LEAVE_TYPE_LABEL[d.leaveType]??d.leaveType} ${approved?"disetujui":"ditolak"}`} description={`${range}${!approved&&d.reviewNote?` · Alasan: ${d.reviewNote}`:""}`} meta="Lihat" href="/teacher/attendance?cuti=1" icon={approved?<CheckCircle2 className="size-5"/>:<CalendarX className="size-5"/>} tone={approved?"teal":"warm"}/>;})}
    </TaskList></section>:null}
    {classesUnavailable ? <EmptyState icon={Users} title="Kelas belum bisa dimuat" description="Periksa koneksi dan coba lagi." actionLabel="Coba lagi" onAction={()=>router.refresh()}/> : primary ? (
      <Card className="gap-4 border-primary/20 bg-secondary p-card" data-testid="current-class">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-small font-semibold text-muted-foreground">Kelas hari ini</p>{primary.slot?<span className="text-small font-semibold text-primary-text">{SLOT_LABEL[primary.slot]??primary.slot}</span>:null}</div>
        <div><h2 className="text-h1 font-bold tracking-tight">{primary.name}</h2>{sentraBadge(primary)}<p className="mt-1 text-body text-muted-foreground">{primary.rosterCount} siswa · {formatDate(today,{day:"numeric",month:"long"})}</p></div>
        {primary.rosterCount>0?<Button nativeButton={false} role="link" render={<Link href={primaryHref}/>} className="h-auto min-h-11 w-full whitespace-normal py-3"><ClipboardList aria-hidden="true"/>{primaryLabel}</Button>:<EmptyState icon={Users} title="Belum ada siswa" description="Minta admin menambahkan siswa ke kelas ini."/>}
      </Card>
    ):<EmptyState icon={Users} title="Belum ada kelas yang ditugaskan" description="Hubungi admin sekolah untuk penugasan kelas."/>}
    {classes.length > 0 ? <section aria-labelledby="class-tasks">
      <h2 id="class-tasks" className="mb-3 text-h2">Yang perlu diselesaikan</h2>
      <TaskList>
        {classes.filter(attendanceOpen).map(c =>
          <TaskRow key={`attendance-${c.id}`} title={`Absensi ${c.name}`} description={c.attendanceRecorded === null ? "Data belum tersedia · buka untuk mencoba lagi" : `${c.attendanceRecorded} dari ${c.rosterCount} siswa tercatat`} meta="Buka" href={classHref(c.id,"attendance")} icon={<CalendarDays className="size-5"/>}/>
        )}
        {classes.filter(c => !c.journal?.completed).map(c =>
          <TaskRow key={`journal-${c.id}`} title={`Jurnal harian ${c.name}${c.sentraTag?` · ${c.sentraTag}`:""}`} description={!c.journal ? "Data belum tersedia · buka untuk mencoba lagi" : !c.journal.configured ? "Indikator sekolah belum disiapkan. Hubungi admin." : `${c.journal.completeStudents} dari ${c.journal.totalStudents} siswa lengkap${c.journal.absentCount?` · ${c.journal.absentCount} tidak hadir`:""}`} meta="Buka" href={classHref(c.id,"journal")} icon={<BookHeart className="size-5"/>} tone="warm"/>
        )}
        <TaskRow title="Buka penilaian" description={homeroomClassSectionName ? `Penilaian pekanan · ${homeroomClassSectionName}` : "Pilih penilaian kelas atau sentra"} href={homeroomClassSectionName ? "/teacher/assessments/weekly" : "/teacher/assessments"} icon={<ClipboardList className="size-5"/>} tone="purple"/>
      </TaskList>
      {classes.some(c => c.rosterCount > 0 && ((!c.sentraOnly && c.attendanceRecorded === c.rosterCount) || c.journal?.completed)) ? <Collapsible className="mt-3">
        <CollapsibleTrigger render={<Button variant="ghost" className="min-h-11"/>}>Pekerjaan yang sudah tersimpan</CollapsibleTrigger>
        <CollapsibleContent>
        <TaskList>
          {classes.filter(c => !c.sentraOnly && c.rosterCount > 0 && c.attendanceRecorded === c.rosterCount).map(c => <TaskRow key={`saved-attendance-${c.id}`} title={`Absensi ${c.name}`} description={`${c.rosterCount} siswa sudah tercatat`} meta="Periksa" href={classHref(c.id,"attendance")} icon={<CheckCircle2 className="size-5"/>}/>) }
          {classes.filter(c => c.journal?.completed).map(c => <TaskRow key={`saved-journal-${c.id}`} title={`Jurnal harian ${c.name}`} description={c.journal?.dayMarkReason ? `Hari tanpa buku penghubung · ${c.journal.dayMarkReason}` : `${c.journal?.completeStudents??c.rosterCount} siswa lengkap${c.journal?.absentCount?` · ${c.journal.absentCount} tidak hadir`:""}`} meta="Periksa" href={classHref(c.id,"journal")} icon={<CheckCircle2 className="size-5"/>}/>) }
        </TaskList>
        </CollapsibleContent>
      </Collapsible> : null}
    </section> : null}
    {replyRows.length>0 || classes.some(c=>c.replies===null)?<section aria-labelledby="guardian-replies"><h2 id="guardian-replies" className="mb-3 text-h2">Balasan dari wali</h2><TaskList>
      {replyRows.map(r=><TaskRow key={r.studentId} title={`Balasan wali ${r.studentName}`} description={r.className} meta={`${r.count} baru`} href={`/teacher/student-journal/students/${encodeURIComponent(r.studentId)}?view=notes#catatan`} icon={<MessageCircle className="size-5"/>}/>)}
      {classes.some(c=>c.replies===null)?<TaskRow title="Balasan belum bisa dimuat" description="Coba muat ulang untuk melihat balasan terbaru." onClick={()=>router.refresh()} meta="Coba lagi"/>:null}
    </TaskList></section>:null}
    <section aria-labelledby="pickup-sessions"><h2 id="pickup-sessions" className="mb-1 text-h2">Sesi & penjemputan</h2><p className="mb-3 text-small text-muted-foreground">Catatan datang dan pulang setiap sesi disimpan terpisah dari absensi kelas.</p>
      {sessionsUnavailable?<EmptyState title="Sesi belum bisa dimuat" actionLabel="Coba lagi" onAction={()=>router.refresh()}/>:todaySessions.length>0?<TaskList>{todaySessions.map(s=><TaskRow key={s.id} title={s.className} description={`${SLOT_LABEL[s.slot]??s.slot} · ${s.rosterCount} siswa`} meta="Buka sesi" href={`/teacher/sessions/${s.id}`} icon={<ClipboardList className="size-5"/>}/>)}</TaskList>:<EmptyState title="Belum ada sesi terjadwal hari ini" description={classes.length>0?"Absensi dan jurnal kelas tetap bisa diisi melalui tugas kelas di atas.":"Sesi akan muncul di sini setelah admin menjadwalkannya untuk Anda."}/>}
    </section>
  </div>;
}
