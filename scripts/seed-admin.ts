import crypto from "crypto";
import { prisma } from "../app/lib/prisma";

const ADMIN_EMAIL = "admin@workarail.com";
const ADMIN_PASSWORD = "Pass1234";
const ADMIN_NAME = "Work à Rail Admin";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function main() {
  console.log(`Seeding sample admin ${ADMIN_EMAIL}...`);

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    include: { staff: true },
  });

  if (existing?.staff) {
    throw new Error(
      `${ADMIN_EMAIL} is linked to a staff record. Admins must not have a Staff row.`
    );
  }

  if (existing) {
    await prisma.account.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const userId = crypto.randomUUID();
  const hashedPassword = hashPassword(ADMIN_PASSWORD);

  await prisma.user.create({
    data: {
      id: userId,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      emailVerified: true,
      accounts: {
        create: {
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          password: hashedPassword,
          issuer: "local:credential",
        },
      },
    },
  });

  console.log("Sample admin ready:");
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Failed to seed admin user:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
