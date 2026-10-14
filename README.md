# PAM Security Test Lab

I built this project to practice and demonstrate Privileged Access Management (PAM) security testing using TypeScript, Node.js, PostgreSQL, and Playwright.

At WebstaurantStore, I worked with a similar user and access-policy model where users could have policies such as Read-only, Digital Content, 3D Data, and Pricing Data. I tested that users could perform the actions their policies allowed and were blocked from actions they were not authorized to perform.

What I added in this project is the temporary privileged-access piece: requesting elevated access, admin approval, expiration, revocation, and audit validation.

## Tech Stack

- TypeScript
- Node.js / Express
- PostgreSQL
- Playwright
- JWT authentication
- bcrypt

## Access Model

Steve starts with `READ_ONLY` access.

A protected pricing operation requires `PRICING_DATA`.

The PAM flow is:

1. Steve logs in.
2. Steve attempts a pricing update and receives `403 Forbidden`.
3. Steve requests temporary `PRICING_DATA` access.
4. An Admin approves the request.
5. Steve can perform the protected operation.
6. The action is recorded in the audit trail.
7. The Admin revokes the privilege or the privilege expires.
8. Steve uses the same valid JWT and receives `403 Forbidden`.

## Key Security Design

The JWT identifies the user, but temporary privileged access is not stored in the token.

For protected operations, the API checks the current authorization state in PostgreSQL.

This allows a temporary privilege to be revoked or expired immediately without waiting for the user's JWT to expire.

## Automated Security Tests

The Playwright suite covers:

- Missing authentication token → `401`
- Invalid authentication token → `401`
- Invalid credentials → `401`
- Authenticated user without required permission → `403`
- Separation of duties
- Privileged-access request and approval
- Successful privileged operation
- Privilege revocation
- Automatic privilege expiration
- Database state validation
- Audit-event validation

## Test Validation Strategy

For important security scenarios, I validate more than the HTTP response.

I check:

- API response
- PostgreSQL state
- Audit trail

For example, when a pricing update is denied, the test verifies both the `403` response and that the product price did not change.

## Test Isolation

These integration tests currently use shared users, products, privileges, and database records.

I configured Playwright to use one worker so the lab runs deterministically.

For a larger test suite, I would create unique users, products, and privilege records for each test and clean them up afterward. That would allow safe parallel execution.

## Interview Demo

The `docs` folder contains the PowerPoint used to walk through the architecture, security model, automated tests, and PAM lifecycle.