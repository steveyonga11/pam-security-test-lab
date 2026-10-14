import "dotenv/config";
import { Pool } from "pg";

export const testDb = new Pool({
  host: "localhost",
  port: 5432,
  database: "pam_security_lab",
  user: "postgres",
  password: process.env.DB_PASSWORD,
});