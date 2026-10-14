import { test, expect } from "@playwright/test";

test("non-admin user cannot approve their own privileged access request", async ({
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
  const steveToken = loginBody.token;

  // Steve requests PRICING_DATA
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

  expect(requestBody.request.status).toBe("PENDING");

  // Steve attempts to approve his own request
  const selfApproval = await request.post(
    `http://localhost:3000/api/privileged-access/${requestId}/approve`,
    {
      headers: {
        Authorization: `Bearer ${steveToken}`,
      },
    }
  );

  // Must be rejected because Steve does not have ADMIN
  expect(selfApproval.status()).toBe(403);

  const body = await selfApproval.json();

  expect(body.message).toBe(
    "Forbidden: ADMIN access required"
  );
});