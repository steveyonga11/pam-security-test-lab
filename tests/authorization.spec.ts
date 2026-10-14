import { test, expect } from "@playwright/test";
import { testDb } from "./db-helper";

test("READ_ONLY user cannot update pricing without privileged access", async ({
  request,
}) => {
  // Login as Steve
  const login = await request.post(
    "http://localhost:3000/api/auth/login",
    {
      data: {
        username: "steve",
        password: "TestPassword123!",
      },
    }
  );

  expect(login.status()).toBe(200);

  const loginBody = await login.json();
  const token = loginBody.token;
  const userId = loginBody.user.id;

  // Capture current price before unauthorized attempt
  const beforeResult = await testDb.query(
    `SELECT price
     FROM products
     WHERE id = $1`,
    [100]
  );

  const priceBefore = Number(beforeResult.rows[0].price);

  // Attempt privileged operation without PRICING_DATA
  const response = await request.put(
    "http://localhost:3000/api/pricing/100",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        price: 99.99,
      },
    }
  );

  // Backend must reject it
  expect(response.status()).toBe(403);

  const body = await response.json();

  expect(body.message).toBe(
    "Forbidden: PRICING_DATA access required"
  );

  // Verify database was NOT modified
  const afterResult = await testDb.query(
    `SELECT price
     FROM products
     WHERE id = $1`,
    [100]
  );

  const priceAfter = Number(afterResult.rows[0].price);

  expect(priceAfter).toBe(priceBefore);

  // Verify security audit trail
  const auditResult = await testDb.query(
    `SELECT outcome, details
     FROM audit_events
     WHERE actor_user_id = $1
       AND event_type = 'PRICING_UPDATE'
       AND resource = 'product:100'
       AND outcome = 'DENIED'
       AND details->>'attemptedPrice' = '99.99'
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  );

  expect(auditResult.rows.length).toBe(1);
  expect(auditResult.rows[0].outcome).toBe("DENIED");
});