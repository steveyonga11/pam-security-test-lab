import bcrypt from "bcrypt";
import { pool } from "./db";

async function createUser() {
  const username = "steve";
  const password = "TestPassword123!";

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [username, passwordHash]
    );

    console.log("User created:");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("Failed to create user:", error);
  } finally {
    await pool.end();
  }
}

createUser();