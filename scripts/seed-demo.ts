import crypto from "crypto";
import { prisma } from "../app/lib/prisma";
import {
  staff as staffSeed,
  attendanceWeek,
  attendancePatterns,
  leaveRequests,
  invoices,
  expenses,
  payPeriod,
} from "./demo-data";

const ADMIN_EMAIL = "admin@workarail.com";
const STAFF_PASSWORD = "Pass1234";

/** Weeks of attendance to generate, ending with the demo week. */
const ATTENDANCE_WEEKS = 4;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

function date(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function shiftDays(value: string, days: number) {
  const d = date(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

const CITIES = [
  { city: "Manchester", postcode: "M1 4BT" },
  { city: "Leeds", postcode: "LS1 5DL" },
  { city: "Birmingham", postcode: "B2 4QA" },
  { city: "Glasgow", postcode: "G2 8LU" },
  { city: "Bristol", postcode: "BS1 6BX" },
];

const DEPOTS = [
  "Ashburys depot",
  "Neville Hill depot",
  "Tyseley depot",
  "Polmadie depot",
  "St Philips Marsh depot",
];

/** Deterministic HR detail so reruns produce the same rows. */
function hrProfile(index: number, member: (typeof staffSeed)[number]) {
  const place = CITIES[index % CITIES.length];
  const salaried = member.role.includes("lead") || member.role.includes("engineer");
  const [first = "", last = ""] = member.name.split(" ");
  const pad = String(index + 1).padStart(3, "0");

  return {
    preferredName: index % 3 === 0 ? first : null,
    dateOfBirth: date(`${1980 + (index % 18)}-${member.birthday}`),
    gender: index % 2 === 0 ? "female" : "male",
    nationality: index % 5 === 0 ? "Irish" : "British",
    personalEmail: `${first}.${last}`.toLowerCase() + "@example.com",
    personalPhone: `+44 7800 900${pad}`,
    addressLine1: `${12 + index} Sidings Road`,
    addressLine2: index % 4 === 0 ? "Flat 2" : null,
    city: place.city,
    postcode: place.postcode,
    country: "United Kingdom",
    emergencyName: index % 2 === 0 ? "Sam Doyle" : "Alex Doyle",
    emergencyPhone: `+44 7900 900${pad}`,
    emergencyRelation: index % 2 === 0 ? "Partner" : "Parent",
    employmentType: index % 7 === 0 ? "contractor" : "permanent",
    workLocation: DEPOTS[index % DEPOTS.length],
    contractEnd: index % 7 === 0 ? date("2027-03-31") : null,
    probationEnd: shiftDays(member.joined, 180),
    hoursPerWeek: salaried ? 40 : 37.5,
    niNumber: `QQ${100000 + index * 137}C`.slice(0, 9),
    taxId: index % 7 === 0 ? `${1000000000 + index}` : null,
    taxCode: index % 6 === 0 ? "BR" : "1257L",
    taxResidency: "United Kingdom",
    bankAccountName: member.name,
    bankSortCode: `20-${String(30 + index).padStart(2, "0")}-11`,
    bankAccountNumber: String(40000000 + index * 3571).slice(0, 8),
    iban: null,
    govIdType: index % 3 === 0 ? "driving_licence" : "passport",
    govIdNumber: `${last.slice(0, 4).toUpperCase()}${900000 + index}`,
    govIdCountry: "United Kingdom",
    govIdExpiry: date(`${2029 + (index % 4)}-06-30`),
    rightToWork: index % 5 === 0 ? "irish_citizen" : "british_citizen",
    visaType: null,
    visaExpiry: null,
    ptsNumber: `PTS-${200000 + index * 11}`,
    ptsExpiry: date(`2027-${String(1 + (index % 12)).padStart(2, "0")}-28`),
    medicalExpiry: date(`2028-${String(1 + (index % 12)).padStart(2, "0")}-15`),
    studentLoan: index % 4 === 0,
    lineManager: member.role === "Crew lead" ? "Work à Rail Admin" : "Jordan Vale",
    noticePeriod: salaried ? "8 weeks" : "4 weeks",
    payType: salaried ? "salary" : "hourly",
    payRatePence: salaried ? 4200000 + index * 50000 : 1850 + index * 25,
    notes:
      index % 4 === 0
        ? "Holds CSCS card. Happy to cover weekend possessions."
        : null,
  };
}

/** Gross monthly pay in pence, from the pay type and rate. */
function monthlyGross(payType: string, payRatePence: number) {
  return payType === "salary"
    ? Math.round(payRatePence / 12)
    : Math.round(payRatePence * 160);
}

async function wipe() {
  await prisma.attendance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.payrollRecord.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.staffDocument.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.job.deleteMany();
  await prisma.client.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.smtpSettings.deleteMany();

  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  // Everything except the admin login, so you can still sign in after seeding.
  const otherUsers = admin ? { not: admin.id } : undefined;
  await prisma.session.deleteMany({ where: { userId: otherUsers } });
  await prisma.account.deleteMany({ where: { userId: otherUsers } });
  await prisma.user.deleteMany({ where: { id: otherUsers } });
  return admin;
}

async function main() {
  console.log("Seeding demo data for every table...");

  const admin = await wipe();
  if (!admin) {
    console.warn(
      `No ${ADMIN_EMAIL} user found — run scripts/seed-admin.ts to create the admin login.`
    );
  }
  console.log("Cleared existing demo rows.");

  const crewNames = Array.from(new Set(staffSeed.map((s) => s.crew))).sort();
  const crewIds: Record<string, string> = {};
  for (const name of crewNames) {
    const crew = await prisma.crew.create({ data: { name } });
    crewIds[name] = crew.id;
  }
  console.log(`Crews: ${crewNames.length}`);

  const jobIds = new Set<string>();
  for (const member of staffSeed) {
    if (!member.currentJob) continue;
    const [id, title = ""] = member.currentJob.split(" · ").map((p) => p.trim());
    if (!id || jobIds.has(id)) continue;
    await prisma.job.create({ data: { id, title } });
    jobIds.add(id);
  }
  console.log(`Jobs: ${jobIds.size}`);

  const password = hashPassword(STAFF_PASSWORD);
  for (let i = 0; i < staffSeed.length; i++) {
    const member = staffSeed[i];
    const userId = crypto.randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        email: member.email,
        name: member.name,
        emailVerified: true,
        accounts: {
          create: {
            id: crypto.randomUUID(),
            accountId: userId,
            providerId: "credential",
            password,
            issuer: "local:credential",
          },
        },
      },
    });

    await prisma.staff.create({
      data: {
        ref: member.ref,
        name: member.name,
        email: member.email,
        phone: member.phone,
        role: member.role,
        crewId: crewIds[member.crew],
        currentJobId: member.currentJob
          ? member.currentJob.split(" · ")[0].trim()
          : null,
        status: member.status,
        joined: date(member.joined),
        birthday: member.birthday,
        userId,
        ...hrProfile(i, member),
      },
    });
  }
  console.log(`Staff (with logins): ${staffSeed.length}`);

  let documents = 0;
  for (let i = 0; i < staffSeed.length; i++) {
    const member = staffSeed[i];
    const profile = hrProfile(i, member);
    const rows = [
      {
        category: "gov-id",
        title: profile.govIdType === "passport" ? "Passport" : "Driving licence",
        reference: profile.govIdNumber,
        issuedOn: date("2019-06-30"),
        expiresOn: profile.govIdExpiry,
        fileName: `${member.ref}-gov-id.pdf`,
      },
      {
        category: "contract",
        title: "Employment contract",
        reference: member.ref,
        issuedOn: date(member.joined),
        expiresOn: profile.contractEnd,
        fileName: `${member.ref}-contract.pdf`,
      },
      {
        category: "pts",
        title: "Sentinel / PTS card",
        reference: profile.ptsNumber,
        issuedOn: shiftDays(member.joined, 30),
        expiresOn: profile.ptsExpiry,
        fileName: `${member.ref}-pts.pdf`,
      },
      {
        category: "medical",
        title: "Network Rail medical certificate",
        reference: null,
        issuedOn: shiftDays(member.joined, 45),
        expiresOn: profile.medicalExpiry,
        fileName: `${member.ref}-medical.pdf`,
      },
    ];
    for (const row of rows) {
      await prisma.staffDocument.create({
        data: {
          staffRef: member.ref,
          url: `/uploads/demo/${row.fileName}`,
          ...row,
        },
      });
      documents++;
    }
  }
  console.log(`Staff documents: ${documents}`);

  let attendance = 0;
  for (let week = ATTENDANCE_WEEKS - 1; week >= 0; week--) {
    for (const [ref, pattern] of Object.entries(attendancePatterns)) {
      for (let day = 0; day < attendanceWeek.length; day++) {
        const base = attendanceWeek[day];
        if (!base) continue;
        const when = shiftDays(base, -7 * week);
        // Don't invent attendance from before someone joined.
        const member = staffSeed.find((s) => s.ref === ref);
        if (member && when < date(member.joined)) continue;
        await prisma.attendance.create({
          data: { staffRef: ref, date: when, code: pattern[day] ?? "-" },
        });
        attendance++;
      }
    }
  }
  console.log(`Attendance: ${attendance}`);

  for (const req of leaveRequests) {
    await prisma.leaveRequest.create({
      data: {
        id: req.id,
        staffRef: req.staffRef,
        type: req.type,
        from: date(req.from),
        to: date(req.to),
        days: req.days,
        reason: req.reason,
        status: req.status,
        submitted: date(req.submitted),
      },
    });
  }
  console.log(`Leave requests: ${leaveRequests.length}`);

  async function attach(
    file: { name: string; kind: string; size: string; url: string } | null
  ) {
    if (!file) return null;
    const created = await prisma.attachment.create({ data: file });
    return created.id;
  }

  const clientIds: Record<string, string> = {};
  for (const inv of invoices) {
    let clientId = clientIds[inv.client];
    if (!clientId) {
      const client = await prisma.client.create({ data: { name: inv.client } });
      clientId = client.id;
      clientIds[inv.client] = clientId;
    }

    await prisma.invoice.create({
      data: {
        id: inv.id,
        clientId,
        reference: inv.reference,
        amountPence: inv.amountPence,
        issued: date(inv.issued),
        due: date(inv.due),
        status: inv.status,
        documentId: await attach(inv.document),
        proofId: await attach(inv.proof),
      },
    });
  }
  console.log(
    `Clients: ${Object.keys(clientIds).length} · Invoices: ${invoices.length}`
  );

  for (const exp of expenses) {
    await prisma.expense.create({
      data: {
        id: exp.id,
        date: date(exp.date),
        category: exp.category,
        merchant: exp.merchant,
        description: exp.description,
        amountPence: exp.amountPence,
        staffRef: exp.staffRef,
        method: exp.method,
        status: exp.status,
        receiptId: await attach(exp.receipt),
      },
    });
  }
  console.log(`Expenses: ${expenses.length}`);

  let payroll = 0;
  for (let i = 0; i < staffSeed.length; i++) {
    const member = staffSeed[i];
    const profile = hrProfile(i, member);
    const gross = monthlyGross(profile.payType, profile.payRatePence);

    for (let back = 2; back >= 0; back--) {
      const month = payPeriod.month - back;
      if (month < 1) continue;
      const tax = Math.round(gross * 0.2);
      const ni = Math.round(gross * 0.08);
      const pension = Math.round(gross * 0.05);
      const current = back === 0;

      await prisma.payrollRecord.create({
        data: {
          staffRef: member.ref,
          year: payPeriod.year,
          month,
          grossPence: gross,
          taxPence: tax,
          niPence: ni,
          pensionPence: pension,
          netPence: gross - tax - ni - pension,
          status: current ? "pending" : "paid",
          paidOn: current
            ? null
            : date(`${payPeriod.year}-${String(month).padStart(2, "0")}-28`),
          reference: `PR-${payPeriod.year}-${String(month).padStart(2, "0")}-${member.ref}`,
        },
      });
      payroll++;
    }
  }
  console.log(`Payroll records: ${payroll}`);

  await prisma.smtpSettings.create({
    data: {
      id: "default",
      host: "localhost",
      port: 1025,
      secure: false,
      user: "demo",
      pass: "demo",
      from: "Work à Rail <no-reply@workarail.com>",
    },
  });
  console.log("SMTP settings: 1");

  await prisma.verification.create({
    data: {
      id: crypto.randomUUID(),
      identifier: staffSeed[0].email,
      value: crypto.randomBytes(16).toString("hex"),
      expiresAt: shiftDays(isoDay(new Date()), 1),
    },
  });
  console.log("Verification tokens: 1");

  if (admin) {
    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: admin.id,
        token: crypto.randomBytes(24).toString("hex"),
        expiresAt: shiftDays(isoDay(new Date()), 7),
        ipAddress: "127.0.0.1",
        userAgent: "seed-demo script",
      },
    });
    console.log("Sessions: 1 (admin)");
  }

  console.log("\nDemo data ready.");
  console.log(`  admin login: ${ADMIN_EMAIL} / Pass1234`);
  console.log(`  staff login: ${staffSeed[0].email} / ${STAFF_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
