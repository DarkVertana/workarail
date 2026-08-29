import "dotenv/config";
import { PrismaClient } from "../../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Pool } = pg;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Local Postgres has no TLS listener, so only negotiate SSL when the URL asks for it.
const connectionString = process.env.DATABASE_URL;
const useSsl = /sslmode=(require|verify-ca|verify-full)/.test(
  connectionString ?? "",
);

function createClient() {
  const pool = new Pool({ connectionString, ssl: useSsl });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

let prismaInstance: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prismaInstance = createClient();
} else {
  globalForPrisma.prisma ??= createClient();
  prismaInstance = globalForPrisma.prisma;
}

export const prisma = prismaInstance;
