import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client";

const libsqlConfig = {
  url: process.env.DATABASE_URL ?? "file:./dev.db",
};

const adapter = new PrismaLibSql(libsqlConfig);
const prisma = new PrismaClient({ adapter });

export default prisma;
