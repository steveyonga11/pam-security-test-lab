import { pool } from "./db";

async function testConnection() {
  try {
    const result = await pool.query("SELECT current_database(), current_user");

    console.log("Database connected successfully");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("Database connection failed:", error);
  } finally {
    await pool.end();
  }
}

testConnection();