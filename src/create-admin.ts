import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "./db";

async function createAdmin() {
  const username = "admin";
  const password = "AdminTest123!";

  try {
    // Hash the password before storing it
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the admin user
    const userResult = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [username, passwordHash]
    );

    const admin = userResult.rows[0];

    // Assign the permanent ADMIN policy
    await pool.query(
      `INSERT INTO user_policies (user_id, policy_id)
       SELECT $1, id
       FROM access_policies
       WHERE policy_name = 'ADMIN'`,
      [admin.id]
    );

    console.log("Admin user created:");
    console.log({
      id: admin.id,
      username: admin.username,
      policy: "ADMIN",
    });
  } catch (error) {
    console.error("Failed to create admin:", error);
  } finally {
    await pool.end();
  }
}

createAdmin();