import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",

  // These tests share the same users, privileges,
  // product, and PostgreSQL database.
  workers: 1,

  reporter: "list",
});