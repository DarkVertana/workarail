"use server";

import { prisma } from "@/app/lib/prisma";
import { auth } from "@/app/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getLeaveContext, getSettings } from "@/app/actions/admin";
import {
  type AttendanceCode,
  attendanceHours,
} from "@/app/lib/admin-data";
import {
  LEAVE_POLICY,
  computeLeave,
  workingPatternFrom,
} from "@/app/lib/leave";

// Helper constants
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Date helpers
function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
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

export async function getCrewSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session || !session.user) {
    redirect("/signin");
  }

  // Find staff member by email
  const staff = await prisma.staff.findUnique({
    where: { email: session.user.email },
  });

  if (!staff) {
    redirect("/signin");
  }

  // Link userId if it is not linked yet
  if (!staff.userId) {
    await prisma.staff.update({
      where: { ref: staff.ref },
      data: { userId: session.user.id },
    });
  }

  return staff;
}

export async function getCrewDashboardData() {
  const me = await getCrewSession();
  const now = new Date();
  const todayStr = toIsoDateString(now);
  const week = getWeekDays(now);

  // Fetch attendance for the current week
  const dbAttendance = await prisma.attendance.findMany({
    where: {
      staffRef: me.ref,
      date: {
        gte: new Date(week[0]),
        lte: new Date(week[6]),
      },
    },
  });

  // Reconstruct codes array matching week days
  const codes = week.map((dayStr) => {
    const match = dbAttendance.find(
      (att) => toIsoDateString(att.date) === dayStr
    );
    return (match?.code ?? "-") as AttendanceCode;
  });

  // Calculate hours this week
  const hours = codes.reduce((n, c) => n + attendanceHours[c], 0);

  // Fetch leave requests
  const myLeaves = await prisma.leaveRequest.findMany({
    where: { staffRef: me.ref },
    orderBy: { submitted: "desc" },
  });

  // Fetch settings to get standard leaveDays
  const settings = await getSettings();
  const totalLeaveDays = settings.leaveDays ?? 28;

  // Calculate leave taken and pending
  const taken = myLeaves
    .filter((r) => r.status === "approved" && r.type === "annual")
    .reduce((n, r) => n + r.days, 0);
  const pending = myLeaves
    .filter((r) => r.status === "pending" && r.type === "annual")
    .reduce((n, r) => n + r.days, 0);
  const remaining = totalLeaveDays - taken - pending;

  // Fetch expenses
  const dbExpenses = await prisma.expense.findMany({
    where: { staffRef: me.ref },
    orderBy: { date: "desc" },
    include: { receipt: true },
  });

  const myExpenses = dbExpenses.map((exp) => ({
    id: exp.id,
    date: toIsoDateString(exp.date),
    category: exp.category as any,
    merchant: exp.merchant,
    description: exp.description,
    amountPence: exp.amountPence,
    staffRef: exp.staffRef,
    method: exp.method as any,
    status: exp.status as any,
    receipt: exp.receipt
      ? {
          name: exp.receipt.name,
          kind: exp.receipt.kind as any,
          size: exp.receipt.size,
          url: exp.receipt.url,
        }
      : null,
  }));

  const openClaims = myExpenses.filter(
    (e) => e.status === "submitted" || e.status === "approved"
  );

  // Fetch latest payroll record
  const latestPayroll = await prisma.payrollRecord.findFirst({
    where: { staffRef: me.ref },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // Fetch all staff members for celebrations
  const allStaff = await prisma.staff.findMany({
    select: {
      name: true,
      joined: true,
      birthday: true,
    },
  });

  const staffListForCelebrations = allStaff.map((s) => ({
    name: s.name,
    joined: toIsoDateString(s.joined),
    birthday: s.birthday,
  }));

  // Construct pay period label based on latest payroll or default label
  const payPeriodLabel = latestPayroll
    ? `${MONTHS[latestPayroll.month - 1]} ${latestPayroll.year}`
    : `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  return {
    me: {
      ref: me.ref,
      name: me.name,
      role: me.role,
      email: me.email,
    },
    today: todayStr,
    attendanceWeek: week,
    codes,
    hours,
    taken,
    remaining,
    totalLeaveDays,
    openClaimsCount: openClaims.length,
    latestPayPence: latestPayroll ? latestPayroll.netPence : null,
    payPeriodLabel,
    myLeaveRequests: myLeaves.map((r) => ({
      id: r.id,
      staffRef: r.staffRef,
      type: r.type as any,
      from: toIsoDateString(r.from),
      to: toIsoDateString(r.to),
      days: r.days,
      reason: r.reason,
      status: r.status as any,
      submitted: toIsoDateString(r.submitted),
    })),
    myExpenses,
    staffListForCelebrations,
  };
}

export async function saveCrewTimesheet(codes: AttendanceCode[]) {
  const me = await getCrewSession();
  const now = new Date();
  const week = getWeekDays(now);

  // Submit/upsert each day of the week
  for (let i = 0; i < 7; i++) {
    const dayStr = week[i];
    const code = codes[i];
    if (dayStr && code) {
      const parsedDate = new Date(dayStr);
      await prisma.attendance.upsert({
        where: {
          staffRef_date: {
            staffRef: me.ref,
            date: parsedDate,
          },
        },
        update: {
          code,
        },
        create: {
          staffRef: me.ref,
          date: parsedDate,
          code,
        },
      });
    }
  }

  revalidatePath("/crew");
  revalidatePath("/crew/timesheet");
  revalidatePath("/admin/timesheets");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function submitCrewLeaveRequest(data: {
  type: string;
  from: string;
  to: string;
  reason: string;
}): Promise<{ error: string } | { ok: true; id: string; days: number }> {
  const me = await getCrewSession();
  const policy = LEAVE_POLICY[data.type as keyof typeof LEAVE_POLICY];
  if (!policy) return { error: `Unknown leave type "${data.type}".` };

  const context = await getLeaveContext();
  const pattern = workingPatternFrom(context.workingDaysSetting);
  const breakdown = computeLeave({
    from: data.from,
    to: data.to,
    startAt: "morning",
    endAt: "end_of_day",
    pattern,
    holidays: context.holidays,
    allowHalfDays: false,
  });
  if (breakdown.error) return { error: breakdown.error };
  if (breakdown.days <= 0) {
    return { error: "That request does not cover any working time." };
  }

  const clash = context.booked.find(
    (booking) =>
      booking.staffRef === me.ref &&
      booking.from <= data.to &&
      booking.to >= data.from
  );
  if (clash) {
    return {
      error: `You already have ${clash.status} leave from ${clash.from} to ${clash.to}.`,
    };
  }

  if (policy.deducts) {
    const balance = context.balances[me.ref] ?? { taken: 0, pending: 0 };
    const remaining = context.entitlement - balance.taken - balance.pending;
    if (breakdown.days > remaining) {
      return {
        error: `That is ${breakdown.days} days but only ${remaining} remain of your allowance.`,
      };
    }
  }

  const id = `LV-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  await prisma.leaveRequest.create({
    data: {
      id,
      staffRef: me.ref,
      type: data.type,
      from: new Date(`${data.from}T00:00:00.000Z`),
      to: new Date(`${data.to}T00:00:00.000Z`),
      days: breakdown.days,
      startAt: "morning",
      endAt: "end_of_day",
      deducts: policy.deducts,
      reason: data.reason.trim() || policy.label,
      status: "pending",
      submitted: new Date(),
    },
  });

  revalidatePath("/crew");
  revalidatePath("/crew/leave");
  revalidatePath("/admin/leaves");
  revalidatePath("/admin/dashboard");
  return { ok: true, id, days: breakdown.days };
}

export async function submitCrewExpense(data: {
  date: string;
  category: string;
  merchant: string;
  description: string;
  amountPence: number;
  method: string;
  receipt?: {
    name: string;
    kind: "pdf" | "image";
    size: string;
    url: string;
  } | null;
}) {
  const me = await getCrewSession();
  const id = `EX-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

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
      id,
      date: new Date(data.date),
      category: data.category,
      merchant: data.merchant,
      description: data.description,
      amountPence: data.amountPence,
      staffRef: me.ref,
      method: data.method,
      status: "submitted",
      receiptId,
    },
  });
 
  revalidatePath("/crew");
  revalidatePath("/crew/expenses");
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/dashboard");
  return expense;
}

export async function getCrewLatestPayslip(staffRef: string) {
  const record = await prisma.payrollRecord.findFirst({
    where: { staffRef },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  if (!record) return null;

  return {
    id: record.id,
    staffRef: record.staffRef,
    month: record.month,
    year: record.year,
    grossPence: record.grossPence,
    taxPence: record.taxPence,
    niPence: record.niPence,
    pensionPence: record.pensionPence,
    netPence: record.netPence,
    paidOn: record.paidOn ? record.paidOn.toISOString().slice(0, 10) : null,
    reference: record.reference,
  };
}
