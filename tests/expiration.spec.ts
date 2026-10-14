import { test, expect } from "@playwright/test";
import { testDb } from "./db-helper";

test("temporary privileged access expires automatically", async ({
  request,
}) => {
  // 1. Login as Steve
  const steveLogin = await request.post(
    "http://localhost:3000/api/auth/login",
    {
      data: {
        username: "steve",
        password: "TestPassword123!",
      },
    }
  );

  expect(steveLogin.status()).toBe(200);

  const steveBody = await steveLogin.json();
  const steveToken = steveBody.token;

  // 2. Steve requests PRICING_DATA
  const accessRequest = await request.post(
    "http://localhost:3000/api/privileged-access/request",
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
      data: {
        policyName: "PRICING_DATA",
      },
    }
  );

  expect(accessRequest.status()).toBe(201);

  const requestBody = await accessRequest.json();
  const requestId = requestBody.request.id;

  // 3. Login as Admin
  const adminLogin = await request.post(
    "http://localhost:3000/api/auth/login",
    {
      data: {
        username: "admin",
        password: "AdminTest123!",
      },
    }
  );

  expect(adminLogin.status()).toBe(200);

  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  // 4. Admin approves temporary access
  const approval = await request.post(
    `http://localhost:3000/api/privileged-access/${requestId}/approve`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    }
  );

  expect(approval.status()).toBe(200);

  // 5. Confirm access works while ACTIVE
  const activeUpdate = await request.put(
    "http://localhost:3000/api/pricing/100",
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
      data: {
        price: 54.99,
      },
    }
  );

  expect(activeUpdate.status()).toBe(200);

  // 6. Wait longer than the 5-second privilege window
  await new Promise((resolve) =>
    setTimeout(resolve, 6000)
  );

  // 7. Use the SAME Steve JWT after PAM expiration
  const expiredUpdate = await request.put(
    "http://localhost:3000/api/pricing/100",
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
      data: {
        price: 59.99,
      },
    }
  );

  expect(expiredUpdate.status()).toBe(403);

  // 8. Verify unauthorized update did not change product
  const productResult = await testDb.query(
    `SELECT price
     FROM products
     WHERE id = $1`,
    [100]
  );

  expect(Number(productResult.rows[0].price)).toBe(
    54.99
  );

  // 9. Verify PAM request transitioned to EXPIRED
  const privilegeResult = await testDb.query(
    `SELECT status
     FROM privileged_access
     WHERE id = $1`,
    [requestId]
  );

  expect(privilegeResult.rows.length).toBe(1);
  expect(privilegeResult.rows[0].status).toBe(
    "EXPIRED"
  );
});