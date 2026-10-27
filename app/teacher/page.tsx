import { classroomAttendanceByStudent } from "@/lib/teacher/classroom-attendance";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { TeacherHomeClient } from "./home-client";
import { countUnreadNotesByStudent } from "@/lib/student-journal/note-reads";
import { getDayMark } from "@/lib/student-journal/day-marks";
import { leaveDecisionSince, toLeaveDecisions } from "@/lib/teacher/leave-decisions";
import { minutesLate } from "@/lib/attendance/status";
import { getJournalProgress, isJournalAbsentStatus, teacherSlotRank, compareTeacherClasses, type TeacherClassSummary } from "@/lib/teacher/home-progress";

export default async function TeacherHome() {
  const session = await getSession();
  if (!session || session.role !== "TEACHER") redirect("/");
  const today = getTodayInTimezone("Asia/Jakarta");
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Jakarta", hour:"2-digit", hourCycle:"h23"}).format(now));
  const greeting = hour < 12 ? "pagi" : hour < 15 ? "siang" : hour < 18 ? "sore" : "malam";
  const [attendanceResult, assignmentsResult, sessionsResult, indicatorsResult, leaveResult, orgResult] = await Promise.allSettled([
    session.employeeId ? prisma.attendanceRecord.findUnique({where:{employeeId_date:{employeeId:session.employeeId,date:today}}}) : Promise.resolve(null),
    session.employeeId && session.tenantId ? prisma.teachingAssignment.findMany({
      where:{employeeId:session.employeeId,classSection:{tenantId:session.tenantId,status:"ACTIVE",academicYear:{status:"ACTIVE"}}},
      include:{classSection:{include:{sessions:{where:{date:today},select:{id:true}},enrollments:{where:{status:"ACTIVE"},select:{studentId:true,student:{select:{name:true,nickname:true}}}}}}},
      orderBy:{classSection:{name:"asc"}},
    }) : Promise.resolve([]),
    session.employeeId && session.tenantId ? prisma.classSession.findMany({
      where:{date:today,teacherId:session.employeeId,classSection:{tenantId:session.tenantId}},
      include:{classSection:{select:{name:true,_count:{select:{enrollments:{where:{status:"ACTIVE"}}}}}}},
    }) : Promise.resolve([]),
    session.tenantId ? prisma.studentJournalIndicator.findMany({
      where:{status:"ACTIVE",category:{scope:"SCHOOL",status:"ACTIVE",template:{tenantId:session.tenantId}}},select:{id:true},
    }) : Promise.resolve([]),
    // Recent admin decisions on this teacher's own leave (X-21) — derived from reviewedAt, no new table.
    session.employeeId && session.tenantId ? prisma.leaveRequest.findMany({
      where:{employeeId:session.employeeId,employee:{tenantId:session.tenantId},status:{in:["APPROVED","REJECTED"]},reviewedAt:{gte:leaveDecisionSince(now)}},
      orderBy:{reviewedAt:"desc"},take:10,
      select:{id:true,leaveType:true,startDate:true,endDate:true,status:true,reviewNote:true,reviewedAt:true},
    }) : Promise.resolve([]),
    // Only to say how late a LATE check-in was (R2-T-3); a failed lookup just drops the number.
    session.tenantId ? prisma.orgConfig.findUnique({where:{tenantId:session.tenantId},select:{workStartTime:true,timezone:true}}) : Promise.resolve(null),
  ]);
  // A failed lookup only hides this heads-up; it must never take the home page down.
  const leaveDecisions = leaveResult.status === "fulfilled" ? toLeaveDecisions(leaveResult.value, now) : [];
  const assignments = assignmentsResult.status === "fulfilled" ? assignmentsResult.value : [];
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
  const indicatorIds = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.map(i=>i.id) : null;
  const classes: TeacherClassSummary[] = await Promise.all(assignments.map(async assignment=>{
    const section = assignment.classSection;
    const studentIds = section.enrollments.map(e=>e.studentId);
    const [attendance, journal, replies, dayMark] = await Promise.allSettled([
      prisma.studentAttendance.findMany({where:{classSectionId:section.id,date:today,isVoided:false,studentId:{in:studentIds}},select:{studentId:true,sessionId:true,status:true},orderBy:[{createdAt:"desc"},{id:"desc"}]}),
      prisma.studentJournalEntry.findMany({where:{tenantId:session.tenantId!,classSectionId:section.id,date:today,scope:"SCHOOL",studentId:{in:studentIds},indicatorId:{in:indicatorIds ?? []}},select:{studentId:true,indicatorId:true,checked:true}}),
      countUnreadNotesByStudent({tenantId:session.tenantId!,studentIds,readerUserId:session.id,authorRole:"GUARDIAN"}),
      getDayMark(session.tenantId!,section.id,today),
    ]);
    // A day marked "tanpa buku penghubung" is finished whatever the ticks say; a failed lookup just leaves it unmarked.
    const dayMarkReason = dayMark.status==="fulfilled" ? dayMark.value?.reason ?? null : null;
    // Sakit/Izin/Alpa children leave the journal count, like the bulk fill skips them (R2-T-5).
    const absentIds = attendance.status==="fulfilled"
      ? [...classroomAttendanceByStudent(attendance.value, section.sessions.map(s=>s.id)).values()].filter(r=>isJournalAbsentStatus(r.status)).map(r=>r.studentId) : [];
    const slots = sessions.filter(s=>s.classSectionId===section.id).sort((a,b)=>teacherSlotRank(a.slot,hour)-teacherSlotRank(b.slot,hour));
    return {id:section.id,name:section.name,rosterCount:studentIds.length,isHomeroom:assignment.role === "HOMEROOM",slot:slots[0]?.slot ?? null,
      attendanceRecorded:attendance.status==="fulfilled" ? classroomAttendanceByStudent(attendance.value, section.sessions.map(s=>s.id)).size : null,
      journal:journal.status==="fulfilled" && indicatorIds!==null ? getJournalProgress({studentIds,indicatorIds,entries:journal.value,excludedStudentIds:absentIds,dayMarkReason}) : null,
      replies:replies.status==="fulfilled" ? section.enrollments.filter(e=>(replies.value[e.studentId]??0)>0).map(e=>({studentId:e.studentId,studentName:e.student.nickname || e.student.name,count:replies.value[e.studentId]})) : null,
    };
  }));
  classes.sort((a,b)=>compareTeacherClasses(a,b,hour));
  const record = attendanceResult.status === "fulfilled" ? attendanceResult.value : null;
  const org = orgResult.status === "fulfilled" ? orgResult.value : null;
  const lateBy = record?.status === "LATE" && record.checkInTime && org ? minutesLate(record.checkInTime, org.workStartTime, org.timezone ?? "Asia/Jakarta") : null;
  return <TeacherHomeClient userName={session.name ?? "Guru"} today={today} greeting={greeting}
    todayRecord={record ? {status:record.status,checkInTime:record.checkInTime?.toISOString()??null,checkOutTime:record.checkOutTime?.toISOString()??null,minutesLate:lateBy}:null}
    attendanceUnavailable={attendanceResult.status==="rejected"} classesUnavailable={assignmentsResult.status==="rejected"}
    sessionsUnavailable={sessionsResult.status==="rejected"} classes={classes}
    leaveDecisions={leaveDecisions} homeroomClassSectionName={assignments.find(a=>a.role==="HOMEROOM")?.classSection.name}
    todaySessions={sessions.sort((a,b)=>teacherSlotRank(a.slot,hour)-teacherSlotRank(b.slot,hour)).map(s=>({id:s.id,slot:s.slot,className:s.classSection.name,rosterCount:s.classSection._count.enrollments}))} />;
}
