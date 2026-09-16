import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const libsqlConfig = {
  url: process.env.DATABASE_URL,
};

const adapter = new PrismaLibSql(libsqlConfig);
const prisma = new PrismaClient({ adapter });

export default prisma;
