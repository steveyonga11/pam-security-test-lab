import { test, expect } from "@playwright/test";

test.describe("Authentication security", () => {
  test("protected endpoint returns 401 when token is missing", async ({
    request,
  }) => {
    const response = await request.get(
      "http://localhost:3000/api/profile"
    );

    expect(response.status()).toBe(401);

    const body = await response.json();

    expect(body.message).toBe(
      "Authentication required"
    );
  });

  test("protected endpoint returns 401 for invalid token", async ({
    request,
  }) => {
    const response = await request.get(
      "http://localhost:3000/api/profile",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }
    );

    expect(response.status()).toBe(401);

    const body = await response.json();

    expect(body.message).toBe(
      "Invalid or expired token"
    );
  });

  test("login returns 401 for invalid credentials", async ({
    request,
  }) => {
    const response = await request.post(
      "http://localhost:3000/api/auth/login",
      {
        data: {
          username: "steve",
          password: "WrongPassword123!",
        },
      }
    );

    expect(response.status()).toBe(401);

    const body = await response.json();

    expect(body.message).toBe(
      "Invalid credentials"
    );
  });
});