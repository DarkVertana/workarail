"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidatePath } from "next/cache";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { headers } from "next/headers";
import { auth } from "@/app/lib/auth";
import {
  type StaffMember,
  type LeaveRequest,
  type LeaveType as LeaveTypeName,
  type Expense,
  type Invoice,
  type PayrollRecord,
  type MonthPoint,
  type DayHours,
  type Stat,
  type ActivityRow,
  type AttendanceCode,
  attendanceHours,
  computePay,
  payPeriod,
} from "@/app/lib/admin-data";
import {
  LEAVE_POLICY,
  computeLeave,
  workingPatternFrom,
  type EndAt,
  type StartAt,
} from "@/app/lib/leave";
import { forRegion, getHolidays } from "@/app/lib/holidays";

const SETTINGS_PATH = path.join(process.cwd(), "app/lib/settings.json");

/**
 * The holiday table leave deductions are measured against. The region matters:
 * most UK bank holidays are not nationwide (the late August one covers England,
 * Wales and Northern Ireland but not Scotland), so filtering to global-only
 * holidays would silently charge staff for bank holidays.
 */
const LEAVE_HOLIDAY_COUNTRY = "GB";
const LEAVE_HOLIDAY_REGION = "GB-ENG";

const defaultSettings = {
  company: "Work à Rail",
  email: "admin@workarail.com",
  timezone: "Europe/London",
  currency: "GBP (£)",
  payday: "Last working day",
  allowance: "1047.50",
  tax: 20,
  ni: 8,
  pension: 5,
  leaveDays: 28,
  carryOver: 5,
  workingDays: "Monday to Friday",
  standardDay: 8,
  notifyLeave: true,
  notifyExpenses: true,
  notifyPayroll: true,
  notifyCelebrations: false,
  sessionTimeout: "8 hours",
  twoFactor: true,
  auditLog: true,
};

// Date helpers
function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDays(date: Date) {
  const day = date.getUTCDay();
  // Adjust Monday as start of the week (Sunday is 0, Monday is 1, etc.)
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + i));
    week.push(toIsoDateString(d));
  }
  return week;
}

export async function getRequestPayPeriod() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-indexed
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentLabel = `${MONTHS[currentMonth - 1]} ${currentYear}`;
  return { year: currentYear, month: currentMonth, label: currentLabel };
}

/* --- Settings Actions --- */
export async function getSettings() {
  let settings: any = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, "utf8");
      settings = JSON.parse(data);
    } else {
      settings = { ...defaultSettings };
    }
  } catch (err) {
    console.error("Failed to read settings:", err);
    settings = { ...defaultSettings };
  }

  try {
    const smtp = await prisma.smtpSettings.findUnique({
      where: { id: "default" },
    });
    if (smtp) {
      settings.smtpHost = smtp.host;
      settings.smtpPort = smtp.port;
      settings.smtpSecure = smtp.secure;
      settings.smtpUser = smtp.user;
      settings.smtpPass = smtp.pass;
      settings.smtpFrom = smtp.from;
    } else {
      settings.smtpHost = "";
      settings.smtpPort = 587;
      settings.smtpSecure = false;
      settings.smtpUser = "";
      settings.smtpPass = "";
      settings.smtpFrom = "";
    }
  } catch (err) {
    console.error("Failed to fetch SMTP settings from DB:", err);
    settings.smtpHost = "";
    settings.smtpPort = 587;
    settings.smtpSecure = false;
    settings.smtpUser = "";
    settings.smtpPass = "";
    settings.smtpFrom = "";
  }

  return settings;
}

export async function saveSettings(settings: any) {
  try {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom, ...rest } = settings;

    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(rest, null, 2), "utf8");

    await prisma.smtpSettings.upsert({
      where: { id: "default" },
      update: {
        host: smtpHost || "",
        port: Number(smtpPort) || 587,
        secure: Boolean(smtpSecure),
        user: smtpUser || "",
        pass: smtpPass || "",
        from: smtpFrom || "",
      },
      create: {
        id: "default",
        host: smtpHost || "",
        port: Number(smtpPort) || 587,
        secure: Boolean(smtpSecure),
        user: smtpUser || "",
        pass: smtpPass || "",
        from: smtpFrom || "",
      },
    });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (err) {
    console.error("Failed to save settings:", err);
    return { success: false, error: String(err) };
  }
}

/* --- Staff Actions --- */
export async function getStaff(week?: string[]): Promise<StaffMember[]> {
  const activeWeek = week || getWeekDays(new Date());
  const dbStaff = await prisma.staff.findMany({
    include: {
      crew: true,
      currentJob: true,
      attendance: {
        where: {
          date: {
            gte: new Date(activeWeek[0]),
            lte: new Date(activeWeek[6]),
          },
        },
      },
    },
    orderBy: { ref: "asc" },
  });

  return dbStaff.map((p) => {
    // Calculate hours this week
    let hoursThisWeek = 0;
    // Map attendance week dates to codes
    activeWeek.forEach((dayStr) => {
      const match = p.attendance.find(
        (att) => att.date.toISOString().split("T")[0] === dayStr
      );
      const code = (match?.code ?? "-") as AttendanceCode;
      hoursThisWeek += attendanceHours[code] || 0;
    });

    const utilization = Math.round((hoursThisWeek / 45) * 100);

    return {
      ref: p.ref,
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      crew: p.crew?.name ?? "",
      currentJob: p.currentJob
        ? `${p.currentJob.id} · ${p.currentJob.title}`
        : null,
      status: (p.status as any) || "off-shift",
      hoursThisWeek,
      utilization,
      joined: toIsoDateString(p.joined),
      birthday: p.birthday,
    };
  });
}

export type StaffDetail = Awaited<ReturnType<typeof getStaffMember>>;

/** Full employee file for the profile and edit pages. Dates come back as ISO
 *  strings so the object can cross the server/client boundary unchanged. */
export async function getStaffMember(ref: string) {
  const row = await prisma.staff.findUnique({
    where: { ref },
    include: {
      crew: true,
      currentJob: true,
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!row) return null;

  const iso = (d: Date | null) => (d ? toIsoDateString(d) : null);

  return {
    ...row,
    joined: toIsoDateString(row.joined),
    dateOfBirth: iso(row.dateOfBirth),
    contractEnd: iso(row.contractEnd),
    probationEnd: iso(row.probationEnd),
    govIdExpiry: iso(row.govIdExpiry),
    visaExpiry: iso(row.visaExpiry),
    ptsExpiry: iso(row.ptsExpiry),
    medicalExpiry: iso(row.medicalExpiry),
    createdAt: toIsoDateString(row.createdAt),
    updatedAt: toIsoDateString(row.updatedAt),
    crewName: row.crew?.name ?? "",
    currentJobLabel: row.currentJob
      ? `${row.currentJob.id} · ${row.currentJob.title}`
      : null,
    documents: row.documents.map((doc) => ({
      id: doc.id,
      category: doc.category,
      title: doc.title,
      reference: doc.reference,
      issuedOn: iso(doc.issuedOn),
      expiresOn: iso(doc.expiresOn),
      fileName: doc.fileName,
      url: doc.url,
    })),
  };
}

export async function getJobs() {
  return prisma.job.findMany({ orderBy: { id: "asc" } });
}

const STAFF_STATUSES = ["on-site", "available", "off-shift"] as const;

/** Assign or clear the current job. Assigning also puts them on site, and
 *  clearing frees them up, so the roster status never contradicts the job. */
export async function assignStaffToJob(ref: string, jobId: string | null) {
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return { error: `Job ${jobId} no longer exists.` };
  }

  try {
    await prisma.staff.update({
      where: { ref },
      data: {
        currentJobId: jobId,
        status: jobId ? "on-site" : "available",
      },
    });
  } catch {
    return { error: `Could not update ${ref}.` };
  }

  revalidatePath("/admin/crews");
  revalidatePath(`/admin/crews/${ref}`);
  revalidatePath("/admin/dashboard");
  return { ok: true as const };
}

export async function setStaffStatus(ref: string, status: string) {
  if (!STAFF_STATUSES.includes(status as (typeof STAFF_STATUSES)[number])) {
    return { error: `Unknown status "${status}".` };
  }

  try {
    await prisma.staff.update({
      where: { ref },
      // Someone who is off shift or merely available is not on a job.
      data: { status, ...(status === "on-site" ? {} : { currentJobId: null }) },
    });
  } catch {
    return { error: `Could not update ${ref}.` };
  }

  revalidatePath("/admin/crews");
  revalidatePath(`/admin/crews/${ref}`);
  revalidatePath("/admin/dashboard");
  return { ok: true as const };
}

/** Removes the employee and everything hanging off them. The linked login is
 *  removed too, otherwise the person could still sign in to the crew app. */
export async function deleteStaffMember(ref: string) {
  const row = await prisma.staff.findUnique({ where: { ref } });
  if (!row) return { error: `${ref} no longer exists.` };

  try {
    await prisma.staff.delete({ where: { ref } });
    if (row.userId) {
      await prisma.user.delete({ where: { id: row.userId } });
    }
  } catch {
    return { error: `Could not remove ${ref}.` };
  }

  revalidatePath("/admin/crews");
  revalidatePath("/admin/dashboard");
  return { ok: true as const };
}

/* --- Timesheet/Attendance Actions --- */
export async function getTimesheetData() {
  const now = new Date();
  const today = toIsoDateString(now);
  const week = getWeekDays(now);

  const staffMembers = await getStaff(week);
  const dbAttendance = await prisma.attendance.findMany({
    where: {
      date: {
        gte: new Date(week[0]),
        lte: new Date(week[6]),
      },
    },
  });

  const attendancePatterns: Record<string, string> = {};
  staffMembers.forEach((p) => {
    let pattern = "";
    week.forEach((dayStr) => {
      const match = dbAttendance.find(
        (att) =>
          att.staffRef === p.ref &&
          toIsoDateString(att.date) === dayStr
      );
      pattern += match?.code ?? "-";
    });
    attendancePatterns[p.ref] = pattern;
  });

  return {
    staff: staffMembers,
    attendancePatterns,
    week,
    today,
  };
}

/* --- Leave Actions --- */
export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const dbLeaves = await prisma.leaveRequest.findMany({
    orderBy: { submitted: "desc" },
  });

  return dbLeaves.map((r) => ({
    id: r.id,
    staffRef: r.staffRef,
    type: r.type as any,
    from: toIsoDateString(r.from),
    to: toIsoDateString(r.to),
    days: r.days,
    startAt: r.startAt as "morning" | "afternoon",
    endAt: r.endAt as "lunchtime" | "end_of_day",
    deducts: r.deducts,
    reason: r.reason,
    status: r.status as any,
    submitted: toIsoDateString(r.submitted),
  }));
}

export async function decideLeaveRequest(
  id: string,
  status: "approved" | "rejected"
) {
  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: { status, decidedAt: new Date() },
  });
  revalidatePath("/admin/leaves");
  revalidatePath("/admin/dashboard");
  return updated;
}

/* --- Expense Actions --- */
export async function getExpenses(): Promise<Expense[]> {
  const dbExpenses = await prisma.expense.findMany({
    include: { receipt: true },
    orderBy: { date: "desc" },
  });

  return dbExpenses.map((e) => ({
    id: e.id,
    date: toIsoDateString(e.date),
    category: e.category as any,
    merchant: e.merchant,
    description: e.description,
    amountPence: e.amountPence,
    staffRef: e.staffRef,
    method: e.method as any,
    status: e.status as any,
    receipt: e.receipt
      ? {
          name: e.receipt.name,
          kind: e.receipt.kind as any,
          size: e.receipt.size,
          url: e.receipt.url,
        }
      : null,
  }));
}

export async function decideExpense(
  id: string,
  status: "approved" | "rejected" | "reimbursed"
) {
  const updated = await prisma.expense.update({
    where: { id },
    data: { status },
  });
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/dashboard");
  return updated;
}

export async function addExpense(data: {
  id: string;
  date: string;
  category: string;
  merchant: string;
  description: string;
  amountPence: number;
  staffRef: string;
  method: string;
  receipt?: {
    name: string;
    kind: "pdf" | "image";
    size: string;
    url: string;
  } | null;
}) {
  let receiptId: string | undefined = undefined;

  if (data.receipt) {
    const attachment = await prisma.attachment.create({
      data: {
        name: data.receipt.name,
        kind: data.receipt.kind,
        size: data.receipt.size,
        url: data.receipt.url,
      },
    });
    receiptId = attachment.id;
  }

  const expense = await prisma.expense.create({
    data: {
      id: data.id,
      date: new Date(data.date),
      category: data.category,
      merchant: data.merchant,
      description: data.description,
      amountPence: data.amountPence,
      staffRef: data.staffRef,
      method: data.method,
      status: "submitted",
      receiptId,
    },
  });

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/dashboard");
  return expense;
}

/* --- Invoice Actions --- */
export async function getInvoices(): Promise<Invoice[]> {
  const dbInvoices = await prisma.invoice.findMany({
    include: {
      client: true,
      document: true,
      proof: true,
    },
    orderBy: { issued: "desc" },
  });

  return dbInvoices.map((inv) => ({
    id: inv.id,
    client: inv.client.name,
    reference: inv.reference,
    amountPence: inv.amountPence,
    issued: toIsoDateString(inv.issued),
    due: toIsoDateString(inv.due),
    status: inv.status as any,
    document: inv.document
      ? {
          name: inv.document.name,
          kind: inv.document.kind as any,
          size: inv.document.size,
          url: inv.document.url,
        }
      : null,
    proof: inv.proof
      ? {
          name: inv.proof.name,
          kind: inv.proof.kind as any,
          size: inv.proof.size,
          url: inv.proof.url,
        }
      : null,
  } as Invoice));
}

/* --- Payroll Actions --- */
export async function getPayrollRecords(): Promise<PayrollRecord[]> {
  const period = await getRequestPayPeriod();
  const dbPayroll = await prisma.payrollRecord.findMany({
    where: { year: period.year, month: period.month },
    orderBy: { staffRef: "asc" },
  });

  return dbPayroll.map((p) => ({
    staffRef: p.staffRef,
    grossPence: p.grossPence,
    taxPence: p.taxPence,
    niPence: p.niPence,
    pensionPence: p.pensionPence,
    netPence: p.netPence,
    status: p.status as any,
    paidOn: p.paidOn ? toIsoDateString(p.paidOn) : null,
    reference: p.reference,
  }));
}

export async function addPayrollAdjustment(
  staffRef: string,
  label: string,
  amountPence: number
) {
  const period = await getRequestPayPeriod();
  // Find current active payroll run for staff
  const payroll = await prisma.payrollRecord.findUnique({
    where: {
      staffRef_year_month: {
        staffRef,
        year: period.year,
        month: period.month,
      },
    },
  });

  if (!payroll) {
    throw new Error(`Payroll record not found for ${staffRef}`);
  }

  const grossPence = payroll.grossPence + amountPence;
  const computed = computePay(grossPence);

  const updated = await prisma.payrollRecord.update({
    where: {
      id: payroll.id,
    },
    data: {
      grossPence,
      taxPence: computed.taxPence,
      niPence: computed.niPence,
      pensionPence: computed.pensionPence,
      netPence: computed.netPence,
    },
  });

  revalidatePath("/admin/payroll");
  revalidatePath("/admin/dashboard");
  return updated;
}

/* --- Dashboard & Analytics Computation --- */
export async function getDashboardStats(): Promise<Stat[]> {
  const now = new Date();
  const todayStr = toIsoDateString(now);
  const period = await getRequestPayPeriod();

  const staffList = await getStaff();
  const dbAttendance = await prisma.attendance.findMany({
    where: {
      date: new Date(todayStr),
    },
  });

  const inToday = dbAttendance.filter(
    (att) => att.code === "P" || att.code === "H"
  ).length;
  const away = dbAttendance.filter(
    (att) => att.code === "L" || att.code === "A"
  ).length;

  const pendingLeave = await prisma.leaveRequest.count({
    where: { status: "pending" },
  });

  const pendingExpenses = await prisma.expense.count({
    where: { status: "submitted" },
  });

  const currentPayroll = await prisma.payrollRecord.findMany({
    where: {
      year: period.year,
      month: period.month,
    },
  });
  const netPay = currentPayroll.reduce((sum, r) => sum + r.netPence, 0);

  // Compute headcount delta (hired since the start of the current month)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const hiredThisMonth = staffList.filter(s => {
    if (!s.joined) return false;
    const d = new Date(s.joined);
    return d >= thisMonthStart;
  }).length;
  const headcountDelta = hiredThisMonth > 0 ? `+${hiredThisMonth}` : "0";
  const headcountTrend = hiredThisMonth > 0 ? "up" : "flat";

  // Compare net payroll with previous month's payroll
  const prevMonth = period.month === 1 ? 12 : period.month - 1;
  const prevYear = period.month === 1 ? period.year - 1 : period.year;
  const prevPayroll = await prisma.payrollRecord.findMany({
    where: {
      year: prevYear,
      month: prevMonth,
    },
  });
  const prevNetPay = prevPayroll.reduce((sum, r) => sum + r.netPence, 0);

  let payrollDelta = "0%";
  let payrollTrend: "up" | "down" | "flat" = "flat";
  let payrollPositive = true;

  if (prevNetPay > 0) {
    const pct = ((netPay - prevNetPay) / prevNetPay) * 100;
    payrollDelta = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    payrollTrend = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    payrollPositive = pct >= 0;
  } else if (netPay > 0) {
    payrollDelta = "+100%";
    payrollTrend = "up";
    payrollPositive = true;
  }

  return [
    {
      label: "Headcount",
      value: String(staffList.length),
      delta: headcountDelta,
      trend: headcountTrend,
      positive: hiredThisMonth > 0,
      hint: "vs last month",
    },
    {
      label: "In today",
      value: String(inToday),
      delta: String(away),
      trend: away === 0 ? "flat" : "down",
      positive: away === 0,
      hint: away === 1 ? "person away" : "people away",
    },
    {
      label: "Awaiting approval",
      value: String(pendingLeave + pendingExpenses),
      delta: String(pendingLeave),
      trend: "flat",
      positive: pendingLeave + pendingExpenses === 0,
      hint: "leave requests",
    },
    {
      label: "Net payroll",
      value: (netPay / 100).toLocaleString("en-GB", {
        style: "currency",
        currency: "GBP",
        minimumFractionDigits: 2,
      }),
      delta: payrollDelta,
      trend: payrollTrend,
      positive: payrollPositive,
      hint: period.label,
    },
  ];
}

export async function getRecentActivity(): Promise<ActivityRow[]> {
  const staffList = await prisma.staff.findMany();
  const nameFor = (ref: string) =>
    staffList.find((p) => p.ref === ref)?.name ?? ref;

  const leaves = await prisma.leaveRequest.findMany({
    orderBy: { submitted: "desc" },
    take: 6,
  });
  const expenses = await prisma.expense.findMany({
    orderBy: { date: "desc" },
    take: 6,
  });
  const invoices = await prisma.invoice.findMany({
    include: { client: true },
    orderBy: { issued: "desc" },
    take: 6,
  });

  const formatMoney = (pence: number) => {
    return (pence / 100).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
    });
  };

  const rows: ActivityRow[] = [
    ...leaves.map((r) => ({
      ref: r.id,
      title: `${r.days} day${r.days === 1 ? "" : "s"} ${r.type} leave`,
      who: nameFor(r.staffRef),
      amount: "—",
      kind: "leave" as const,
      status: r.status,
      date: toIsoDateString(r.submitted),
    })),
    ...expenses.map((e) => ({
      ref: e.id,
      title: e.merchant,
      who: nameFor(e.staffRef),
      amount: formatMoney(e.amountPence),
      kind: "expense" as const,
      status: e.status,
      date: toIsoDateString(e.date),
    })),
    ...invoices.map((i) => ({
      ref: i.id,
      title: i.reference,
      who: i.client.name,
      amount: formatMoney(i.amountPence),
      kind: "invoice" as const,
      status: i.status,
      date: toIsoDateString(i.issued),
    })),
  ];

  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
}

export async function getWeeklyHours(week?: string[]): Promise<DayHours[]> {
  const activeWeek = week || getWeekDays(new Date());
  const dbAttendance = await prisma.attendance.findMany({
    where: {
      date: {
        gte: new Date(activeWeek[0]),
        lte: new Date(activeWeek[6]),
      },
    },
  });

  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return activeWeek.map((iso, i) => {
    const dayAttendance = dbAttendance.filter(
      (att) => toIsoDateString(att.date) === iso
    );
    const codes = dayAttendance.map((att) => att.code);
    return {
      day: DOW[i],
      date: iso,
      full: codes.filter((c) => c === "P").length * attendanceHours.P,
      half: codes.filter((c) => c === "H").length * attendanceHours.H,
    };
  });
}

export async function getMonthlyFinance(): Promise<MonthPoint[]> {
  const result: MonthPoint[] = [];
  const now = new Date();
  const months: Array<{ month: string; label: string; start: Date; end: Date; year: number; monthNum: number }> = [];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const mNum = d.getMonth() + 1;
    const mStr = String(mNum).padStart(2, '0');
    const label = monthLabels[d.getMonth()];
    const month = `${y}-${mStr}`;
    const start = new Date(Date.UTC(y, d.getMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, d.getMonth() + 1, 0, 23, 59, 59, 999));
    months.push({ month, label, start, end, year: y, monthNum: mNum });
  }

  for (const m of months) {
    // 1. Invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        issued: {
          gte: m.start,
          lte: m.end,
        },
        status: {
          not: "draft",
        },
      },
    });
    const earnedPence = invoices.reduce((sum, inv) => sum + inv.amountPence, 0);

    // 2. Expenses
    const expenses = await prisma.expense.findMany({
      where: {
        date: {
          gte: m.start,
          lte: m.end,
        },
        status: {
          not: "rejected",
        },
      },
    });
    const expenseSpent = expenses.reduce((sum, exp) => sum + exp.amountPence, 0);

    // 3. Payroll
    const payroll = await prisma.payrollRecord.findMany({
      where: {
        year: m.year,
        month: m.monthNum,
      },
    });
    const payrollSpent = payroll.reduce((sum, pay) => sum + pay.grossPence, 0);

    result.push({
      month: m.month,
      label: m.label,
      earnedPence,
      spentPence: expenseSpent + payrollSpent,
    });
  }

  return result;
}

export async function updateStaffDates(
  ref: string,
  birthday: string | null,
  joined: string | null
) {
  const updated = await prisma.staff.update({
    where: { ref },
    data: {
      birthday: birthday || "",
      joined: joined ? new Date(joined) : new Date("1970-01-01"),
    },
  });
  revalidatePath("/admin/celebrations");
  revalidatePath("/admin/dashboard");
  return updated;
}

export async function getCrews() {
  return prisma.crew.findMany({
    orderBy: { name: "asc" },
  });
}

export async function addCrew(name: string) {
  const crew = await prisma.crew.create({
    data: { name },
  });
  revalidatePath("/admin/crews");
  return crew;
}

async function hashPassword(password: string) {
  return new Promise<string>((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function optStr(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function optDate(value: string | null | undefined) {
  const trimmed = optStr(value);
  return trimmed ? new Date(trimmed) : null;
}

function birthdayFrom(dateOfBirth: string | null | undefined, birthday: string) {
  const dob = optStr(dateOfBirth);
  if (dob) {
    const parts = dob.split("-");
    if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  }
  return birthday.trim();
}

const STAFF_DOCUMENTS = [
  { field: "docGovId", category: "gov-id", title: "Government ID" },
  { field: "docTax", category: "tax", title: "Tax document" },
  { field: "docNi", category: "ni", title: "National Insurance evidence" },
  { field: "docRightToWork", category: "right-to-work", title: "Right to work" },
  { field: "docContract", category: "contract", title: "Employment contract" },
  { field: "docPts", category: "pts", title: "PTS / Sentinel card" },
  { field: "docMedical", category: "medical", title: "Medical fitness certificate" },
  { field: "docOther", category: "other", title: "Other document" },
] as const;

export type StaffMemberInput = {
  ref: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  crewId: string;
  status: string;
  joined: string;
  birthday?: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  emergencyRelation?: string | null;
  employmentType?: string | null;
  workLocation?: string | null;
  contractEnd?: string | null;
  probationEnd?: string | null;
  hoursPerWeek?: string | null;
  niNumber?: string | null;
  taxId?: string | null;
  taxCode?: string | null;
  taxResidency?: string | null;
  bankAccountName?: string | null;
  bankSortCode?: string | null;
  bankAccountNumber?: string | null;
  iban?: string | null;
  govIdType?: string | null;
  govIdNumber?: string | null;
  govIdCountry?: string | null;
  govIdExpiry?: string | null;
  rightToWork?: string | null;
  visaType?: string | null;
  visaExpiry?: string | null;
  ptsNumber?: string | null;
  ptsExpiry?: string | null;
  medicalExpiry?: string | null;
  studentLoan?: boolean;
  lineManager?: string | null;
  noticePeriod?: string | null;
  payType?: string | null;
  payRatePounds?: string | null;
  notes?: string | null;
};

async function saveStaffDocuments(staffRef: string, formData: FormData) {
  const uploadDir = path.join(process.cwd(), "public", "uploads", "staff", staffRef);
  for (const slot of STAFF_DOCUMENTS) {
    const file = formData.get(slot.field);
    if (!(file instanceof File) || file.size === 0) continue;
    fs.mkdirSync(uploadDir, { recursive: true });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stored = `${slot.category}-${Date.now()}-${safeName}`;
    const dest = path.join(uploadDir, stored);
    fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
    await prisma.staffDocument.create({
      data: {
        staffRef,
        category: slot.category,
        title: slot.title,
        fileName: file.name,
        url: `/uploads/staff/${staffRef}/${stored}`,
      },
    });
  }
}

/** Reads every staff field off a form. Shared by create and edit so the two
 *  can never drift apart. */
function staffInputFromForm(formData: FormData): StaffMemberInput {
  return {
      ref: String(formData.get("ref") ?? "").trim(),
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? ""),
      role: String(formData.get("role") ?? "").trim(),
      crewId: String(formData.get("crewId") ?? "").trim(),
      status: String(formData.get("status") ?? "").trim(),
      joined: String(formData.get("joined") ?? "").trim(),
      birthday: String(formData.get("birthday") ?? ""),
      preferredName: optStr(String(formData.get("preferredName") ?? "")),
      dateOfBirth: optStr(String(formData.get("dateOfBirth") ?? "")),
      gender: optStr(String(formData.get("gender") ?? "")),
      nationality: optStr(String(formData.get("nationality") ?? "")),
      personalEmail: optStr(String(formData.get("personalEmail") ?? "")),
      personalPhone: optStr(String(formData.get("personalPhone") ?? "")),
      addressLine1: optStr(String(formData.get("addressLine1") ?? "")),
      addressLine2: optStr(String(formData.get("addressLine2") ?? "")),
      city: optStr(String(formData.get("city") ?? "")),
      postcode: optStr(String(formData.get("postcode") ?? "")),
      country: optStr(String(formData.get("country") ?? "")),
      emergencyName: optStr(String(formData.get("emergencyName") ?? "")),
      emergencyPhone: optStr(String(formData.get("emergencyPhone") ?? "")),
      emergencyRelation: optStr(String(formData.get("emergencyRelation") ?? "")),
      employmentType: optStr(String(formData.get("employmentType") ?? "")),
      workLocation: optStr(String(formData.get("workLocation") ?? "")),
      contractEnd: optStr(String(formData.get("contractEnd") ?? "")),
      probationEnd: optStr(String(formData.get("probationEnd") ?? "")),
      hoursPerWeek: optStr(String(formData.get("hoursPerWeek") ?? "")),
      niNumber: optStr(String(formData.get("niNumber") ?? "")),
      taxId: optStr(String(formData.get("taxId") ?? "")),
      taxCode: optStr(String(formData.get("taxCode") ?? "")),
      taxResidency: optStr(String(formData.get("taxResidency") ?? "")),
      bankAccountName: optStr(String(formData.get("bankAccountName") ?? "")),
      bankSortCode: optStr(String(formData.get("bankSortCode") ?? "")),
      bankAccountNumber: optStr(String(formData.get("bankAccountNumber") ?? "")),
      iban: optStr(String(formData.get("iban") ?? "")),
      govIdType: optStr(String(formData.get("govIdType") ?? "")),
      govIdNumber: optStr(String(formData.get("govIdNumber") ?? "")),
      govIdCountry: optStr(String(formData.get("govIdCountry") ?? "")),
      govIdExpiry: optStr(String(formData.get("govIdExpiry") ?? "")),
      rightToWork: optStr(String(formData.get("rightToWork") ?? "")),
      visaType: optStr(String(formData.get("visaType") ?? "")),
      visaExpiry: optStr(String(formData.get("visaExpiry") ?? "")),
      ptsNumber: optStr(String(formData.get("ptsNumber") ?? "")),
      ptsExpiry: optStr(String(formData.get("ptsExpiry") ?? "")),
      medicalExpiry: optStr(String(formData.get("medicalExpiry") ?? "")),
      studentLoan: formData.get("studentLoan") === "on",
      lineManager: optStr(String(formData.get("lineManager") ?? "")),
      noticePeriod: optStr(String(formData.get("noticePeriod") ?? "")),
      payType: optStr(String(formData.get("payType") ?? "")),
      payRatePounds: optStr(String(formData.get("payRatePounds") ?? "")),
      notes: optStr(String(formData.get("notes") ?? "")),
  };
}

/** The fields that must be present before we will save a staff record. */
function missingRequired(data: StaffMemberInput) {
  const required = [
    data.ref,
    data.name,
    data.email,
    data.role,
    data.crewId,
    data.status,
    data.joined,
  ];
  return required.some((value) => !value);
}

export async function addStaffMemberFromForm(formData: FormData) {
  const data = staffInputFromForm(formData);

  if (missingRequired(data)) {
    return { error: "Fill in employee ID, name, work email, role, crew, status and start date." };
  }

  try {
    await addStaffMember(data);
    await saveStaffDocuments(data.ref, formData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save staff member.";
    return { error: message };
  }

  revalidatePath("/admin/crews");
  return { ok: true as const };
}

export async function updateStaffMemberFromForm(ref: string, formData: FormData) {
  const data = staffInputFromForm(formData);

  if (missingRequired(data)) {
    return { error: "Fill in employee ID, name, work email, role, crew, status and start date." };
  }
  // The ref is the primary key and payroll/expenses point at it, so it is fixed
  // once created — the edit form shows it read-only.
  if (data.ref !== ref) {
    return { error: "Employee ID cannot be changed." };
  }

  const payRate = optStr(data.payRatePounds);
  const hours = optStr(data.hoursPerWeek);

  try {
    await prisma.staff.update({
      where: { ref },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        crewId: data.crewId,
        status: data.status,
        joined: new Date(data.joined),
        birthday: birthdayFrom(data.dateOfBirth, data.birthday ?? ""),
        preferredName: optStr(data.preferredName),
        dateOfBirth: optDate(data.dateOfBirth),
        gender: optStr(data.gender),
        nationality: optStr(data.nationality),
        personalEmail: optStr(data.personalEmail),
        personalPhone: optStr(data.personalPhone),
        addressLine1: optStr(data.addressLine1),
        addressLine2: optStr(data.addressLine2),
        city: optStr(data.city),
        postcode: optStr(data.postcode),
        country: optStr(data.country),
        emergencyName: optStr(data.emergencyName),
        emergencyPhone: optStr(data.emergencyPhone),
        emergencyRelation: optStr(data.emergencyRelation),
        employmentType: optStr(data.employmentType),
        workLocation: optStr(data.workLocation),
        contractEnd: optDate(data.contractEnd),
        probationEnd: optDate(data.probationEnd),
        hoursPerWeek: hours ? Number(hours) : null,
        niNumber: optStr(data.niNumber),
        taxId: optStr(data.taxId),
        taxCode: optStr(data.taxCode),
        taxResidency: optStr(data.taxResidency),
        bankAccountName: optStr(data.bankAccountName),
        bankSortCode: optStr(data.bankSortCode),
        bankAccountNumber: optStr(data.bankAccountNumber),
        iban: optStr(data.iban),
        govIdType: optStr(data.govIdType),
        govIdNumber: optStr(data.govIdNumber),
        govIdCountry: optStr(data.govIdCountry),
        govIdExpiry: optDate(data.govIdExpiry),
        rightToWork: optStr(data.rightToWork),
        visaType: optStr(data.visaType),
        visaExpiry: optDate(data.visaExpiry),
        ptsNumber: optStr(data.ptsNumber),
        ptsExpiry: optDate(data.ptsExpiry),
        medicalExpiry: optDate(data.medicalExpiry),
        studentLoan: Boolean(data.studentLoan),
        lineManager: optStr(data.lineManager),
        noticePeriod: optStr(data.noticePeriod),
        payType: optStr(data.payType),
        payRatePence: payRate ? Math.round(Number(payRate) * 100) : null,
        notes: optStr(data.notes),
      },
    });
    // New uploads are added; existing documents are left alone.
    await saveStaffDocuments(ref, formData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update staff member.";
    return { error: message };
  }

  revalidatePath("/admin/crews");
  revalidatePath(`/admin/crews/${ref}`);
  return { ok: true as const };
}

export async function addStaffMember(data: StaffMemberInput) {
  // Check if user already exists
  let user = await prisma.user.findUnique({
    where: { email: data.email },
  });

  // If user doesn't exist, create one with a randomized password
  if (!user) {
    const randomPassword = crypto.randomBytes(24).toString("hex");
    const hashedPassword = await hashPassword(randomPassword);
    user = await prisma.user.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, ""),
        email: data.email,
        name: data.name,
        emailVerified: true,
      },
    });

    await prisma.account.create({
      data: {
        id: crypto.randomUUID().replace(/-/g, ""),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
      },
    });

    // Request a password reset to trigger the invitation email flow!
    try {
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      await auth.api.requestPasswordReset({
        body: {
          email: data.email,
          redirectTo: `${appUrl}/reset-password`,
        },
        headers: await headers(),
      });
    } catch (inviteErr) {
      console.error("Failed to trigger invitation email flow:", inviteErr);
    }
  }

  const payRate = optStr(data.payRatePounds);
  const hours = optStr(data.hoursPerWeek);

  const staff = await prisma.staff.create({
    data: {
      ref: data.ref,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      crewId: data.crewId,
      status: data.status,
      joined: new Date(data.joined),
      birthday: birthdayFrom(data.dateOfBirth, data.birthday ?? ""),
      userId: user.id,
      preferredName: optStr(data.preferredName),
      dateOfBirth: optDate(data.dateOfBirth),
      gender: optStr(data.gender),
      nationality: optStr(data.nationality),
      personalEmail: optStr(data.personalEmail),
      personalPhone: optStr(data.personalPhone),
      addressLine1: optStr(data.addressLine1),
      addressLine2: optStr(data.addressLine2),
      city: optStr(data.city),
      postcode: optStr(data.postcode),
      country: optStr(data.country),
      emergencyName: optStr(data.emergencyName),
      emergencyPhone: optStr(data.emergencyPhone),
      emergencyRelation: optStr(data.emergencyRelation),
      employmentType: optStr(data.employmentType),
      workLocation: optStr(data.workLocation),
      contractEnd: optDate(data.contractEnd),
      probationEnd: optDate(data.probationEnd),
      hoursPerWeek: hours ? Number(hours) : null,
      niNumber: optStr(data.niNumber),
      taxId: optStr(data.taxId),
      taxCode: optStr(data.taxCode),
      taxResidency: optStr(data.taxResidency),
      bankAccountName: optStr(data.bankAccountName),
      bankSortCode: optStr(data.bankSortCode),
      bankAccountNumber: optStr(data.bankAccountNumber),
      iban: optStr(data.iban),
      govIdType: optStr(data.govIdType),
      govIdNumber: optStr(data.govIdNumber),
      govIdCountry: optStr(data.govIdCountry),
      govIdExpiry: optDate(data.govIdExpiry),
      rightToWork: optStr(data.rightToWork),
      visaType: optStr(data.visaType),
      visaExpiry: optDate(data.visaExpiry),
      ptsNumber: optStr(data.ptsNumber),
      ptsExpiry: optDate(data.ptsExpiry),
      medicalExpiry: optDate(data.medicalExpiry),
      studentLoan: Boolean(data.studentLoan),
      lineManager: optStr(data.lineManager),
      noticePeriod: optStr(data.noticePeriod),
      payType: optStr(data.payType),
      payRatePence: payRate ? Math.round(Number(payRate) * 100) : null,
      notes: optStr(data.notes),
    },
  });

  // Initialize payroll record for current period
  try {
    const period = await getRequestPayPeriod();
    await prisma.payrollRecord.create({
      data: {
        staffRef: data.ref,
        year: period.year,
        month: period.month,
        grossPence: 0,
        taxPence: 0,
        niPence: 0,
        pensionPence: 0,
        netPence: 0,
        status: "pending",
        reference: `PAY-${data.ref}-${period.year}-${String(period.month).padStart(2, "0")}`,
      },
    });
  } catch (e) {
    console.error("Failed to automatically create payroll record for new employee:", e);
  }

  revalidatePath("/admin/crews");
  revalidatePath("/admin/dashboard");
  return staff;
}

const ATTENDANCE_CODES = ["P", "H", "L", "A", "-"] as const;

/** Guards against a fat-fingered date range writing thousands of rows. */
const MAX_ATTENDANCE_WRITES = 500;

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Every day from `from` to `to` inclusive, as UTC midnights. */
function daysBetweenInclusive(from: string, to: string) {
  const days: Date[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d);
  }
  return days;
}

export type AttendanceEntryInput = {
  staffRefs: string[];
  /** Single day: pass the same value for `from` and `to`. */
  from: string;
  to: string;
  code: string;
  /** Saturdays and Sundays are skipped unless this is set. */
  includeWeekends?: boolean;
  /** When false, days that already have an entry are left untouched. */
  overwrite?: boolean;
};

/**
 * Records attendance for any number of people over a day or a date range.
 * Reports exactly what it did so the caller can tell the user whether existing
 * entries were overwritten.
 */
export async function saveAttendanceEntries(input: AttendanceEntryInput) {
  const refs = Array.from(new Set(input.staffRefs.filter(Boolean)));
  const overwrite = input.overwrite ?? true;

  if (refs.length === 0) {
    return { error: "Select at least one employee." };
  }
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
    return { error: "Enter a valid date." };
  }
  if (input.to < input.from) {
    return { error: "The end date is before the start date." };
  }
  if (!ATTENDANCE_CODES.includes(input.code as (typeof ATTENDANCE_CODES)[number])) {
    return { error: `Unknown attendance code "${input.code}".` };
  }

  const known = await prisma.staff.findMany({
    where: { ref: { in: refs } },
    select: { ref: true },
  });
  if (known.length !== refs.length) {
    const missing = refs.filter((ref) => !known.some((s) => s.ref === ref));
    return { error: `No such employee: ${missing.join(", ")}.` };
  }

  const allDays = daysBetweenInclusive(input.from, input.to);
  const days = input.includeWeekends
    ? allDays
    : allDays.filter((d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6);

  if (days.length === 0) {
    return {
      error:
        "That range only covers a weekend. Tick “include weekends” to record it.",
    };
  }
  if (days.length * refs.length > MAX_ATTENDANCE_WRITES) {
    return {
      error: `That would write ${days.length * refs.length} entries — narrow the range or pick fewer people.`,
    };
  }

  const existing = await prisma.attendance.findMany({
    where: { staffRef: { in: refs }, date: { in: days } },
    select: { staffRef: true, date: true },
  });
  const taken = new Set(
    existing.map((e) => `${e.staffRef}|${toIsoDateString(e.date)}`)
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const writes = [];
  for (const staffRef of refs) {
    for (const date of days) {
      const isTaken = taken.has(`${staffRef}|${toIsoDateString(date)}`);
      if (isTaken && !overwrite) {
        skipped += 1;
        continue;
      }
      if (isTaken) updated += 1;
      else created += 1;
      writes.push(
        prisma.attendance.upsert({
          where: { staffRef_date: { staffRef, date } },
          update: { code: input.code },
          create: { staffRef, date, code: input.code },
        })
      );
    }
  }

  try {
    await prisma.$transaction(writes);
  } catch {
    return { error: "Could not save the attendance entries." };
  }

  revalidatePath("/admin/timesheets");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/payroll");

  return {
    ok: true as const,
    created,
    updated,
    skipped,
    days: days.length,
    people: refs.length,
  };
}

/**
 * Everything the leave dialog needs to price a request before it is sent:
 * the company's working pattern, the public holiday table, the allowance, and
 * what each employee has already booked this year.
 */
export async function getLeaveContext() {
  const settings = await getSettings();
  const year = new Date().getFullYear();

  const table = (await getHolidays(year, LEAVE_HOLIDAY_COUNTRY)) ?? [];
  const next = (await getHolidays(year + 1, LEAVE_HOLIDAY_COUNTRY)) ?? [];
  const holidays: Record<string, string> = {};
  for (const h of forRegion([...table, ...next], LEAVE_HOLIDAY_REGION)) {
    holidays[h.date] = h.localName || h.name;
  }

  const rows = await prisma.leaveRequest.findMany({
    where: { status: { in: ["pending", "approved"] } },
    select: {
      staffRef: true,
      days: true,
      status: true,
      deducts: true,
      from: true,
      to: true,
      type: true,
      id: true,
    },
  });

  const balances: Record<string, { taken: number; pending: number }> = {};
  for (const row of rows) {
    // Only allowance-deducting leave counts against entitlement.
    if (!row.deducts) continue;
    if (row.from.getFullYear() !== year) continue;
    const entry = (balances[row.staffRef] ??= { taken: 0, pending: 0 });
    if (row.status === "approved") entry.taken += row.days;
    else entry.pending += row.days;
  }

  return {
    holidays,
    workingDaysSetting: String(settings.workingDays ?? "Monday to Friday"),
    entitlement:
      Number(settings.leaveDays ?? 28) + Number(settings.carryOver ?? 0),
    leaveDays: Number(settings.leaveDays ?? 28),
    carryOver: Number(settings.carryOver ?? 0),
    balances,
    /** Live bookings, so the dialog can flag clashes as dates are picked. */
    booked: rows.map((r) => ({
      id: r.id,
      staffRef: r.staffRef,
      type: r.type,
      status: r.status,
      from: toIsoDateString(r.from),
      to: toIsoDateString(r.to),
    })),
  };
}

type CreateLeaveResult =
  | { error: string }
  | { ok: true; id: string; days: number; approved: boolean; name: string };

/**
 * Creates a leave request. The day count is recalculated here from the dates
 * and the holiday table rather than trusting the browser, so the stored
 * deduction always matches company policy.
 */
export async function createLeaveRequest(input: {
  staffRef: string;
  type: string;
  from: string;
  to: string;
  startAt?: string;
  endAt?: string;
  reason?: string;
  /** Admin override — skips the pending step, the way a manager can. */
  approveNow?: boolean;
}): Promise<CreateLeaveResult> {
  const policy = LEAVE_POLICY[input.type as LeaveTypeName];
  if (!policy) return { error: `Unknown leave type "${input.type}".` };

  const staff = await prisma.staff.findUnique({
    where: { ref: input.staffRef },
    select: { ref: true, name: true, crewId: true },
  });
  if (!staff) return { error: "Select an employee." };

  const context = await getLeaveContext();
  const pattern = workingPatternFrom(context.workingDaysSetting);

  const startAt = policy.halfDays
    ? ((input.startAt as StartAt) ?? "morning")
    : "morning";
  const endAt = policy.halfDays
    ? ((input.endAt as EndAt) ?? "end_of_day")
    : "end_of_day";

  const breakdown = computeLeave({
    from: input.from,
    to: input.to,
    startAt,
    endAt,
    pattern,
    holidays: context.holidays,
    allowHalfDays: policy.halfDays,
  });

  if (breakdown.error) return { error: breakdown.error };
  if (breakdown.days <= 0) {
    return { error: "That request does not cover any working time." };
  }

  // An employee cannot be in two places at once.
  const clash = context.booked.find(
    (b) =>
      b.staffRef === input.staffRef &&
      b.from <= input.to &&
      b.to >= input.from
  );
  if (clash) {
    return {
      error: `${staff.name} already has ${clash.status} leave from ${clash.from} to ${clash.to}.`,
    };
  }

  if (policy.deducts) {
    const balance = context.balances[input.staffRef] ?? {
      taken: 0,
      pending: 0,
    };
    const remaining = context.entitlement - balance.taken - balance.pending;
    if (breakdown.days > remaining) {
      return {
        error: `That is ${breakdown.days} days but only ${remaining} remain of ${staff.name}'s allowance.`,
      };
    }
  }

  const id = `LV-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const approved = Boolean(input.approveNow);

  await prisma.leaveRequest.create({
    data: {
      id,
      staffRef: input.staffRef,
      type: input.type,
      from: new Date(`${input.from}T00:00:00.000Z`),
      to: new Date(`${input.to}T00:00:00.000Z`),
      days: breakdown.days,
      startAt,
      endAt,
      deducts: policy.deducts,
      reason: input.reason?.trim() || policy.label,
      status: approved ? "approved" : "pending",
      submitted: new Date(),
      decidedAt: approved ? new Date() : null,
    },
  });

  revalidatePath("/admin/leaves");
  revalidatePath("/admin/dashboard");

  return {
    ok: true as const,
    id,
    days: breakdown.days,
    approved,
    name: staff.name,
  };
}

export async function getClients() {
  return prisma.client.findMany({
    orderBy: { name: "asc" },
  });
}

export async function addInvoice(data: {
  clientName: string;
  reference: string;
  amountPence: number;
  issued: string;
  due: string;
  status: string;
}) {
  const id = `INV-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  
  // Find or create client
  let client = await prisma.client.findFirst({
    where: { name: data.clientName },
  });
  if (!client) {
    client = await prisma.client.create({
      data: { name: data.clientName },
    });
  }

  const invoice = await prisma.invoice.create({
    data: {
      id,
      clientId: client.id,
      reference: data.reference,
      amountPence: data.amountPence,
      issued: new Date(data.issued),
      due: new Date(data.due),
      status: data.status,
    },
  });
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/dashboard");
  return invoice;
}

export async function getPendingCounts() {
  const pendingLeaves = await prisma.leaveRequest.count({
    where: { status: 'pending' },
  });
  const pendingExpenses = await prisma.expense.count({
    where: { status: 'submitted' },
  });
  return {
    pendingLeaves,
    pendingExpenses,
  };
}

