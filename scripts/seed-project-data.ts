import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import crypto from "crypto";
import {
  staff,
  attendanceWeek,
  attendancePatterns,
  leaveRequests,
  invoices,
  expenses,
  payrollRuns,
  payPeriod,
} from "./demo-data";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function main() {
  console.log("Starting project data seeding...");

  try {
    // 1. Clean up existing tables (children first, then parents)
    console.log("Cleaning up existing project data tables...");
    await prisma.attendance.deleteMany();
    await prisma.leaveRequest.deleteMany();
    await prisma.payrollRecord.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.staff.deleteMany();
    await prisma.crew.deleteMany();
    await prisma.job.deleteMany();
    await prisma.client.deleteMany();
    await prisma.attachment.deleteMany();

    // Clean up all users and accounts EXCEPT the admin user "shubhamd@tvita.in"
    const adminUser = await prisma.user.findUnique({
      where: { email: "shubhamd@tvita.in" },
    });

    if (adminUser) {
      await prisma.account.deleteMany({
        where: {
          userId: { not: adminUser.id },
        },
      });
      await prisma.session.deleteMany({
        where: {
          userId: { not: adminUser.id },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { not: adminUser.id },
        },
      });
    } else {
      await prisma.account.deleteMany();
      await prisma.session.deleteMany();
      await prisma.user.deleteMany();
    }
    console.log("Cleanup finished.");

    // 2. Create Crews
    console.log("Seeding Crews...");
    const uniqueCrewNames = Array.from(new Set(staff.map((s) => s.crew)));
    const crewsMap: Record<string, string> = {};
    for (const name of uniqueCrewNames) {
      const crew = await prisma.crew.create({
        data: { name },
      });
      crewsMap[name] = crew.id;
    }
    console.log(`✅ Seeded ${uniqueCrewNames.length} crews.`);

    // 3. Create Jobs
    console.log("Seeding Jobs...");
    const jobsMap: Record<string, string> = {};
    for (const member of staff) {
      if (member.currentJob) {
        const parts = member.currentJob.split(" · ");
        const jobId = parts[0]?.trim();
        const jobTitle = parts[1]?.trim() || "";
        if (jobId && !jobsMap[jobId]) {
          await prisma.job.create({
            data: {
              id: jobId,
              title: jobTitle,
            },
          });
          jobsMap[jobId] = jobId;
        }
      }
    }
    console.log(`✅ Seeded ${Object.keys(jobsMap).length} jobs.`);

    // 4. Create Staff Members & User/Account Records
    console.log("Seeding Staff members and User/Account credential pairs...");
    const hashedPassword = hashPassword("Pass1234");
    const now = new Date();

    for (let i = 0; i < staff.length; i++) {
      const member = staff[i];
      const email = `crew${i + 1}@tvita.in`;
      const userId = crypto.randomUUID();

      // Create User
      await prisma.user.create({
        data: {
          id: userId,
          email,
          name: member.name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      // Create Account
      await prisma.account.create({
        data: {
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: hashedPassword,
          issuer: "local:credential",
          createdAt: now,
          updatedAt: now,
        },
      });

      let jobId: string | null = null;
      if (member.currentJob) {
        jobId = member.currentJob.split(" · ")[0]?.trim() || null;
      }

      await prisma.staff.create({
        data: {
          ref: member.ref,
          name: member.name,
          email, // Use the new simple crew email
          phone: member.phone,
          role: member.role,
          crewId: crewsMap[member.crew],
          currentJobId: jobId,
          status: member.status,
          joined: new Date(member.joined),
          birthday: member.birthday,
          userId,
        },
      });
    }
    console.log(`✅ Seeded ${staff.length} staff members and their user accounts.`);

    // 5. Create Attendance Records
    console.log("Seeding Attendance records...");
    let attendanceCount = 0;
    for (const [ref, pattern] of Object.entries(attendancePatterns)) {
      const codes = pattern.split("");
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        const dateStr = attendanceWeek[i];
        if (dateStr) {
          await prisma.attendance.create({
            data: {
              staffRef: ref,
              date: new Date(dateStr),
              code,
            },
          });
          attendanceCount++;
        }
      }
    }
    console.log(`✅ Seeded ${attendanceCount} attendance records.`);

    // 6. Create Leave Requests
    console.log("Seeding Leave Requests...");
    for (const req of leaveRequests) {
      await prisma.leaveRequest.create({
        data: {
          id: req.id,
          staffRef: req.staffRef,
          type: req.type,
          from: new Date(req.from),
          to: new Date(req.to),
          days: req.days,
          reason: req.reason,
          status: req.status,
          submitted: new Date(req.submitted),
        },
      });
    }
    console.log(`✅ Seeded ${leaveRequests.length} leave requests.`);

    // 7. Helper for Attachments
    const upsertAttachment = async (attachment: { name: string; kind: string; size: string; url: string } | null) => {
      if (!attachment) return null;
      const created = await prisma.attachment.create({
        data: {
          name: attachment.name,
          kind: attachment.kind,
          size: attachment.size,
          url: attachment.url,
        },
      });
      return created.id;
    };

    // 8. Create Clients & Invoices
    console.log("Seeding Clients and Invoices...");
    const clientsMap: Record<string, string> = {};
    for (const inv of invoices) {
      // Upsert Client
      let clientId = clientsMap[inv.client];
      if (!clientId) {
        const client = await prisma.client.upsert({
          where: { name: inv.client },
          update: {},
          create: { name: inv.client },
        });
        clientId = client.id;
        clientsMap[inv.client] = clientId;
      }

      // Create Attachments if they exist
      const documentId = await upsertAttachment(inv.document);
      const proofId = await upsertAttachment(inv.proof);

      // Create Invoice
      await prisma.invoice.create({
        data: {
          id: inv.id,
          clientId,
          reference: inv.reference,
          amountPence: inv.amountPence,
          issued: new Date(inv.issued),
          due: new Date(inv.due),
          status: inv.status,
          documentId,
          proofId,
        },
      });
    }
    console.log(`✅ Seeded ${invoices.length} invoices and clients.`);

    // 9. Create Expenses
    console.log("Seeding Expenses...");
    for (const exp of expenses) {
      const receiptId = await upsertAttachment(exp.receipt);

      await prisma.expense.create({
        data: {
          id: exp.id,
          date: new Date(exp.date),
          category: exp.category,
          merchant: exp.merchant,
          description: exp.description,
          amountPence: exp.amountPence,
          staffRef: exp.staffRef,
          method: exp.method,
          status: exp.status,
          receiptId,
        },
      });
    }
    console.log(`✅ Seeded ${expenses.length} expenses.`);

    // 10. Create Payroll Records
    console.log("Seeding Payroll records...");
    for (const run of payrollRuns) {
      await prisma.payrollRecord.create({
        data: {
          staffRef: run.staffRef,
          year: payPeriod.year,
          month: payPeriod.month,
          grossPence: run.grossPence,
          taxPence: run.taxPence,
          niPence: run.niPence,
          pensionPence: run.pensionPence,
          netPence: run.netPence,
          status: run.status,
          paidOn: run.paidOn ? new Date(run.paidOn) : null,
          reference: run.reference,
        },
      });
    }
    console.log(`✅ Seeded ${payrollRuns.length} payroll records.`);

    console.log("🎉 Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
