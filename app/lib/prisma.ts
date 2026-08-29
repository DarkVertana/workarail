import { config } from "dotenv";
import { PrismaClient } from "../../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

config({ path: ".env.local" });
config();

const { Pool } = pg;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function poolOptions() {
  const connectionString = process.env.DATABASE_URL;
  const isLocal =
    !!connectionString &&
    (connectionString.includes("127.0.0.1") ||
      connectionString.includes("localhost"));
  return { connectionString, ssl: isLocal ? false : true };
}

let prismaInstance: PrismaClient;

if (process.env.NODE_ENV === "production") {
  const pool = new Pool(poolOptions());
  const adapter = new PrismaPg(pool);
  prismaInstance = new PrismaClient({ adapter });
} else {
  if (!globalForPrisma.prisma) {
    const pool = new Pool(poolOptions());
    const adapter = new PrismaPg(pool);
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  prismaInstance = globalForPrisma.prisma;
}

export const prisma = prismaInstance;
