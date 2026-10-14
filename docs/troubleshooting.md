# Troubleshooting Notes

These are some of the issues I ran into while building the PAM Security Test Lab and how I resolved them.

## 1. PowerShell Blocked npm

### Problem

PowerShell blocked `npm.ps1` because of the local execution policy.

### Solution

Instead of changing the machine's execution policy, I used:

npm.cmd

Example:

npm.cmd install express

### Takeaway

I avoided weakening the PowerShell security configuration just to run npm.

---

## 2. PostgreSQL psql Command Was Not Found

### Problem

Running `psql` returned a command-not-found error.

### Root Cause

PostgreSQL was installed, but its `bin` directory was not included in the Windows PATH.

### Solution

I located the PostgreSQL installation and used the executable directly from:

C:\Program Files\PostgreSQL\18\bin\psql.exe

---

## 3. PostgreSQL Authentication Failed

### Problem

The application could not authenticate to PostgreSQL.

### Investigation

I confirmed:

- PostgreSQL service was running
- The database server was reachable
- The authentication configuration used `scram-sha-256`

### Solution

For the local development environment, I temporarily allowed localhost trusted authentication, reset the PostgreSQL password, and immediately restored `scram-sha-256`.

### Takeaway

The temporary authentication change was only used for local recovery and was reverted afterward.

---

## 4. Database Password Was Not Available to Node

### Problem

The Node application returned PostgreSQL authentication errors.

One error was related to SCRAM authentication because the database password was undefined.

### Root Cause

`DB_PASSWORD` was not available to the running Node process.

At one point, the `.env` file existed but was empty.

### Solution

I added the database configuration to `.env` and loaded it with `dotenv`.

The `.env` file is excluded from Git using `.gitignore`.

### Security Note

Database passwords, JWT secrets, and authentication tokens are not committed to the repository.

---

## 5. Old Node Process Was Still Running

### Problem

I changed API code, restarted what I thought was the server, but the API continued behaving like the old version.

### Root Cause

An older Node process was still listening on port 3000.

### Investigation

I used PowerShell to identify the process using the port:

Get-NetTCPConnection -LocalPort 3000 -State Listen

Then checked the process:

Get-Process -Id <PID>

### Solution

I stopped the stale process:

Stop-Process -Id <PID>

Then restarted the API.

### Takeaway

When code changes do not appear after a restart, I verify which process is actually listening on the application port.

---

## 6. 401 vs. 403 During Security Testing

### Problem

During testing, I received both 401 and 403 responses depending on the scenario.

### Explanation

They represented two different security conditions.

401 Unauthorized:

- Missing JWT
- Invalid JWT
- Expired JWT

403 Forbidden:

- JWT is valid
- User is authenticated
- User does not currently have the required permission

### Takeaway

Authentication and authorization are tested separately.

A valid authenticated session does not automatically mean the user is authorized to perform a privileged operation.

---

## 7. Temporary PAM Access Expired During Manual Testing

### Problem

While manually testing the PAM flow, temporary access sometimes expired before I completed all of the steps.

### Root Cause

The original expiration window was too short for manual testing.

### Solution

I increased the manual testing window and later made the duration configurable.

For automated expiration testing, I use a very short duration so Playwright can verify expiration without making the test unnecessarily slow.

### Takeaway

Production behavior and automated-test timing do not always need identical durations as long as the same authorization logic is being exercised.

---

## 8. Revocation Needed to Work With the Same JWT

### Goal

I wanted to prove that revoking privileged access immediately blocks the user without requiring them to log out.

### Design

The JWT stores user identity, not temporary privilege state.

When a protected request is made, the API checks the user's current authorization state in PostgreSQL.

### Result

The flow is:

1. Steve logs in.
2. Steve receives a valid JWT.
3. Admin grants temporary `PRICING_DATA`.
4. Steve performs the protected action successfully.
5. Admin revokes `PRICING_DATA`.
6. Steve reuses the same valid JWT.
7. The API returns `403 Forbidden`.

### Takeaway

Authentication can remain valid while authorization changes immediately.

---

## 9. Playwright Tests Passed Individually but Failed in Parallel

### Problem

Each integration test passed when executed individually.

When Playwright ran four workers in parallel, failures appeared.

Examples included:

- A test expected `403` but received `200`
- A test expected one product price but found a value written by another test

### Root Cause

The tests shared the same state:

- Steve user
- `PRICING_DATA` permission
- Product 100
- PostgreSQL database
- Temporary privilege records

One test could grant Steve access while another test expected Steve not to have access.

### Solution for This Lab

I configured Playwright to use one worker:

workers: 1

This makes the stateful integration suite deterministic.

### Better Production Solution

For a larger test suite, I would isolate test data.

Each test could receive its own:

- User
- Product
- Privilege request
- Access records

The test data would be cleaned up afterward.

That would allow safe parallel execution without tests interfering with each other.

---

## 10. Security Validation Beyond HTTP Status Codes

For the important PAM scenarios, I intentionally validate multiple layers.

### API

I verify expected responses such as:

- `200`
- `401`
- `403`

### Database

I verify whether the protected data actually changed.

For example, after a denied pricing update, I verify that the product price remains unchanged.

### Audit Trail

I verify events such as:

- `PRIVILEGE_REQUEST`
- `PRIVILEGE_APPROVE`
- `PRICING_UPDATE`
- `PRIVILEGE_REVOKE`
- Denied privileged operations

### Takeaway

A response code alone does not prove the complete system behavior.

For these tests, I use:

API response + database state + audit trail