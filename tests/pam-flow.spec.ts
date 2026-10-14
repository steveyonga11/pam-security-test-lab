import { test, expect } from "@playwright/test";
import { testDb } from "./db-helper";

test("PAM flow - request, approve, use, revoke, deny", async ({ request }) => {
  // ============================================================
  // 1. LOGIN AS STEVE
  // ============================================================

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

  const steveLoginBody = await steveLogin.json();
  const steveToken = steveLoginBody.token;
  const steveUserId = steveLoginBody.user.id;

  expect(steveToken).toBeTruthy();

  // ============================================================
  // 2. REQUEST TEMPORARY PRICING_DATA ACCESS
  // ============================================================

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

  const accessRequestBody = await accessRequest.json();
  const requestId = accessRequestBody.request.id;

  expect(accessRequestBody.request.status).toBe("PENDING");

  // ============================================================
  // 3. LOGIN AS ADMIN
  // ============================================================

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

  const adminLoginBody = await adminLogin.json();
  const adminToken = adminLoginBody.token;

  expect(adminToken).toBeTruthy();

  // ============================================================
  // 4. ADMIN APPROVES STEVE'S REQUEST
  // ============================================================

  const approval = await request.post(
    `http://localhost:3000/api/privileged-access/${requestId}/approve`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    }
  );

  expect(approval.status()).toBe(200);

  const approvalBody = await approval.json();

  expect(approvalBody.request.status).toBe("ACTIVE");

  // ============================================================
  // 5. STEVE UPDATES PRICING WHILE PRIVILEGE IS ACTIVE
  // ============================================================

  const pricingUpdate = await request.put(
    "http://localhost:3000/api/pricing/100",
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
      data: {
        price: 44.99,
      },
    }
  );

  expect(pricingUpdate.status()).toBe(200);

  const pricingBody = await pricingUpdate.json();

  expect(pricingBody.message).toBe(
    "Pricing updated successfully"
  );

  expect(Number(pricingBody.product.price)).toBe(44.99);

  // ============================================================
  // 6. VERIFY DATABASE WAS ACTUALLY UPDATED
  // ============================================================

  const productResult = await testDb.query(
    `SELECT price
     FROM products
     WHERE id = $1`,
    [100]
  );

  expect(productResult.rows.length).toBe(1);

  expect(
    Number(productResult.rows[0].price)
  ).toBe(44.99);

  // ============================================================
  // 7. VERIFY SUCCESS AUDIT EVENT
  // ============================================================

  const successAudit = await testDb.query(
    `SELECT outcome, details
     FROM audit_events
     WHERE actor_user_id = $1
       AND event_type = 'PRICING_UPDATE'
       AND resource = 'product:100'
       AND outcome = 'SUCCESS'
       AND details->>'newPrice' = '44.99'
     ORDER BY id DESC
     LIMIT 1`,
    [steveUserId]
  );

  expect(successAudit.rows.length).toBe(1);

  expect(
    successAudit.rows[0].outcome
  ).toBe("SUCCESS");

  // ============================================================
  // 8. ADMIN REVOKES STEVE'S PRIVILEGE
  // ============================================================

  const revocation = await request.post(
    `http://localhost:3000/api/privileged-access/${requestId}/revoke`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    }
  );

  expect(revocation.status()).toBe(200);

  const revocationBody = await revocation.json();

  expect(
    revocationBody.request.status
  ).toBe("REVOKED");

  // ============================================================
  // 9. STEVE USES THE SAME JWT AFTER REVOCATION
  // ============================================================

  const deniedUpdate = await request.put(
    "http://localhost:3000/api/pricing/100",
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
      data: {
        price: 49.99,
      },
    }
  );

  expect(deniedUpdate.status()).toBe(403);

  const deniedBody = await deniedUpdate.json();

  expect(deniedBody.message).toBe(
    "Forbidden: PRICING_DATA access required"
  );

  // ============================================================
  // 10. VERIFY DENIED REQUEST DID NOT MODIFY DATABASE
  // ============================================================

  const productAfterRevocation = await testDb.query(
    `SELECT price
     FROM products
     WHERE id = $1`,
    [100]
  );

  expect(productAfterRevocation.rows.length).toBe(1);

  expect(
    Number(productAfterRevocation.rows[0].price)
  ).toBe(44.99);

  // ============================================================
  // 11. VERIFY DENIED AUDIT EVENT
  // ============================================================

  const deniedAudit = await testDb.query(
    `SELECT outcome, details
     FROM audit_events
     WHERE actor_user_id = $1
       AND event_type = 'PRICING_UPDATE'
       AND resource = 'product:100'
       AND outcome = 'DENIED'
       AND details->>'attemptedPrice' = '49.99'
     ORDER BY id DESC
     LIMIT 1`,
    [steveUserId]
  );

  expect(deniedAudit.rows.length).toBe(1);

  expect(
    deniedAudit.rows[0].outcome
  ).toBe("DENIED");

  // ============================================================
  // 12. VERIFY PAM LIFECYCLE AUDIT EVENTS
  // ============================================================

  const lifecycleAudit = await testDb.query(
    `SELECT event_type, outcome
     FROM audit_events
     WHERE (
       actor_user_id = $1
       AND event_type = 'PRIVILEGE_REQUEST'
       AND details->>'requestId' = $2
     )
     OR (
       event_type IN (
         'PRIVILEGE_APPROVE',
         'PRIVILEGE_REVOKE'
       )
       AND resource = $3
     )
     ORDER BY id`,
    [
      steveUserId,
      String(requestId),
      `privileged-access:${requestId}`,
    ]
  );

  const lifecycleEvents =
    lifecycleAudit.rows.map((row) => row.event_type);

  expect(lifecycleEvents).toContain(
    "PRIVILEGE_REQUEST"
  );

  expect(lifecycleEvents).toContain(
    "PRIVILEGE_APPROVE"
  );

  expect(lifecycleEvents).toContain(
    "PRIVILEGE_REVOKE"
  );
});