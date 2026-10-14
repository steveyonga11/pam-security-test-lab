# PAM Security Test Lab — Architecture

## Overview

This lab extends the user and access-policy testing I worked with at WebstaurantStore into a temporary privileged-access model.

The main difference is that elevated access is not permanent.

A user can:

1. Request privileged access
2. Wait for Admin approval
3. Use the privilege for a limited time
4. Lose the privilege through revocation or expiration

## Architecture

Playwright / Client
        |
        v
Express API
        |
        +---- JWT Authentication
        |
        +---- RBAC / PAM Authorization
        |
        v
PostgreSQL
        |
        +---- users
        +---- access_policies
        +---- user_policies
        +---- privileged_access
        +---- products
        +---- audit_events

## Authentication

The user logs in with a username and password.

After successful authentication, the API returns a JWT.

The JWT identifies the user.

Temporary privileged access is intentionally not stored in the JWT.

## Authorization

For a protected operation, the API checks PostgreSQL for the user's current access.

The authorization check looks for:

1. A permanent policy assigned to the user

or

2. An ACTIVE temporary privilege that has not expired

This allows authorization to change while the JWT remains valid.

## Demo User

Steve starts with:

READ_ONLY

He does not permanently have:

PRICING_DATA

## Protected Operation

Updating a product price requires:

PRICING_DATA

Without that permission:

Valid JWT + no PRICING_DATA = 403 Forbidden

## Temporary Access Flow

Steve
  |
  | Request PRICING_DATA
  v
PENDING
  |
  | Admin approves
  v
ACTIVE
  |
  +---- Steve can update pricing
  |
  +---- Admin revokes ----> REVOKED
  |
  +---- Time expires -----> EXPIRED

## Separation of Duties

Steve can request privileged access.

Steve cannot approve his own request.

The approval endpoint requires ADMIN access.

This separates the person requesting the privilege from the person granting it.

## Immediate Revocation

One of the main behaviors I wanted to prove was immediate revocation.

The flow is:

1. Steve logs in and receives a valid JWT.
2. Admin grants temporary PRICING_DATA.
3. Steve successfully performs the protected operation.
4. Admin revokes the temporary privilege.
5. Steve keeps the same JWT.
6. Steve attempts the protected operation again.
7. The API returns 403.

The authentication token is still valid.

What changed is Steve's authorization.

## Audit Trail

Important security actions are recorded in PostgreSQL.

Examples:

- PRIVILEGE_REQUEST
- PRIVILEGE_APPROVE
- PRIVILEGE_REVOKE
- PRICING_UPDATE SUCCESS
- PRICING_UPDATE DENIED

This allows the privileged-access lifecycle to be reconstructed from the audit data.

## Testing Strategy

Playwright tests the API directly.

For important scenarios I validate three things:

API response
+
Database state
+
Audit trail

For example, after a denied pricing update:

- API should return 403
- Product price should remain unchanged
- DENIED audit event should exist

## Test Isolation

The current lab uses shared test data.

Because multiple tests use the same user, product, and privilege records, the integration tests run with:

workers: 1

For a larger test suite, I would create unique test data for each test and clean it up afterward.

That would allow the suite to run safely in parallel.