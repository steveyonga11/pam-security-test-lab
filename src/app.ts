import "dotenv/config";

import express, { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "./db";

const app = express();
const PORT = 3000;

// Temporary PAM access duration.
// Default = 300 seconds (5 minutes).
// For our expiration test, .env will override this to 5 seconds.
const PRIVILEGE_DURATION_SECONDS = Number(
  process.env.PRIVILEGE_DURATION_SECONDS ?? 300
);

app.use(express.json());

interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    username: string;
  };
}

// ============================================================
// JWT AUTHENTICATION
// ============================================================

function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    return res.status(500).json({
      message: "JWT configuration error",
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      userId: number;
      username: string;
    };

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
    };

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

// ============================================================
// AUDIT LOGGING
// ============================================================

async function logAuditEvent(
  actorUserId: number,
  eventType: string,
  resource: string,
  outcome: "SUCCESS" | "DENIED" | "FAILED",
  details: object = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events
       (actor_user_id, event_type, resource, outcome, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      actorUserId,
      eventType,
      resource,
      outcome,
      JSON.stringify(details),
    ]
  );
}

// ============================================================
// PAM EXPIRATION
// ============================================================

async function expireOldPrivileges(userId: number): Promise<void> {
  await pool.query(
    `UPDATE privileged_access
     SET status = 'EXPIRED'
     WHERE user_id = $1
       AND status = 'ACTIVE'
       AND expires_at <= CURRENT_TIMESTAMP`,
    [userId]
  );
}

// ============================================================
// AUTHORIZATION - RBAC + PAM
// ============================================================

async function hasPolicy(
  userId: number,
  requiredPolicy: string
): Promise<boolean> {
  // First mark any elapsed temporary privileges as EXPIRED.
  await expireOldPrivileges(userId);

  // ----------------------------------------------------------
  // Check permanent RBAC policies
  // ----------------------------------------------------------

  const permanentPolicy = await pool.query(
    `SELECT 1
     FROM user_policies up
     JOIN access_policies ap
       ON up.policy_id = ap.id
     WHERE up.user_id = $1
       AND ap.policy_name = $2`,
    [userId, requiredPolicy]
  );

  if (permanentPolicy.rows.length > 0) {
    return true;
  }

  // ----------------------------------------------------------
  // Check temporary PAM privileges
  // ----------------------------------------------------------

  const temporaryAccess = await pool.query(
    `SELECT 1
     FROM privileged_access pa
     JOIN access_policies ap
       ON pa.policy_id = ap.id
     WHERE pa.user_id = $1
       AND ap.policy_name = $2
       AND pa.status = 'ACTIVE'
       AND pa.expires_at > CURRENT_TIMESTAMP`,
    [userId, requiredPolicy]
  );

  return temporaryAccess.rows.length > 0;
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", (_req, res) => {
  return res.status(200).json({
    status: "ok",
  });
});

// ============================================================
// LOGIN
// ============================================================

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      message: "Username and password are required",
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, password_hash
       FROM users
       WHERE username = $1`,
      [username]
    );

    // Generic error prevents username enumeration.
    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }

    // JWT identifies the user.
    // Dynamic PAM privileges are intentionally NOT stored in the token.
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
      },
      jwtSecret,
      {
        expiresIn: "30m",
      }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ============================================================
// PROTECTED PROFILE
// ============================================================

app.get(
  "/api/profile",
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    return res.status(200).json({
      message: "Protected resource accessed",
      user: req.user,
    });
  }
);

// ============================================================
// PROTECTED PRICING OPERATION
// ============================================================

app.put(
  "/api/pricing/:id",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const productId = req.params.id;
    const { price } = req.body;

    if (price === undefined) {
      return res.status(400).json({
        message: "Price is required",
      });
    }

    try {
      // Check current authorization state in PostgreSQL.
      const allowed = await hasPolicy(
        userId,
        "PRICING_DATA"
      );

      if (!allowed) {
        // Record unauthorized attempt.
        await logAuditEvent(
          userId,
          "PRICING_UPDATE",
          `product:${productId}`,
          "DENIED",
          {
            attemptedPrice: price,
            reason: "PRICING_DATA access required",
          }
        );

        return res.status(403).json({
          message:
            "Forbidden: PRICING_DATA access required",
        });
      }

      // Authorized operation.
      const result = await pool.query(
        `UPDATE products
         SET price = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id,
                   product_name,
                   price,
                   updated_at`,
        [price, productId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      // Record successful privileged operation.
      await logAuditEvent(
        userId,
        "PRICING_UPDATE",
        `product:${productId}`,
        "SUCCESS",
        {
          newPrice: price,
        }
      );

      return res.status(200).json({
        message: "Pricing updated successfully",
        product: result.rows[0],
      });
    } catch (error) {
      console.error("Pricing update error:", error);

      return res.status(500).json({
        message: "Internal server error",
      });
    }
  }
);

// ============================================================
// REQUEST TEMPORARY PRIVILEGED ACCESS
// ============================================================

app.post(
  "/api/privileged-access/request",
  authenticateToken,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    const { policyName } = req.body;
    const userId = req.user!.userId;

    if (!policyName) {
      return res.status(400).json({
        message: "policyName is required",
      });
    }

    try {
      // Find requested policy.
      const policyResult = await pool.query(
        `SELECT id, policy_name
         FROM access_policies
         WHERE policy_name = $1`,
        [policyName]
      );

      if (policyResult.rows.length === 0) {
        return res.status(404).json({
          message: "Policy not found",
        });
      }

      const policy = policyResult.rows[0];

      // Create PENDING PAM request.
      const requestResult = await pool.query(
        `INSERT INTO privileged_access
           (user_id, policy_id, status)
         VALUES ($1, $2, 'PENDING')
         RETURNING id,
                   user_id,
                   policy_id,
                   status,
                   requested_at`,
        [userId, policy.id]
      );

      // Audit request.
      await logAuditEvent(
        userId,
        "PRIVILEGE_REQUEST",
        policy.policy_name,
        "SUCCESS",
        {
          requestId: requestResult.rows[0].id,
          status: "PENDING",
        }
      );

      return res.status(201).json({
        message:
          "Privileged access request created",
        request: requestResult.rows[0],
      });
    } catch (error) {
      console.error(
        "Privileged access request error:",
        error
      );

      return res.status(500).json({
        message: "Internal server error",
      });
    }
  }
);

// ============================================================
// ADMIN APPROVES PRIVILEGED ACCESS
// ============================================================

app.post(
  "/api/privileged-access/:id/approve",
  authenticateToken,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    const adminUserId = req.user!.userId;
    const requestId = req.params.id;

    try {
      // Separation of duties:
      // only ADMIN can approve privilege elevation.
      const isAdmin = await hasPolicy(
        adminUserId,
        "ADMIN"
      );

      if (!isAdmin) {
        return res.status(403).json({
          message:
            "Forbidden: ADMIN access required",
        });
      }

      // Activate temporary privilege.
      //
      // Duration comes from configuration rather
      // than being hardcoded into the application.
      const result = await pool.query(
        `UPDATE privileged_access
         SET status = 'ACTIVE',
             approved_at = CURRENT_TIMESTAMP,
             expires_at =
               CURRENT_TIMESTAMP +
               ($3 * INTERVAL '1 second'),
             approved_by = $1
         WHERE id = $2
           AND status = 'PENDING'
         RETURNING id,
                   user_id,
                   policy_id,
                   status,
                   approved_at,
                   expires_at,
                   approved_by`,
        [
          adminUserId,
          requestId,
          PRIVILEGE_DURATION_SECONDS,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message:
            "Pending privileged access request not found",
        });
      }

      // Audit approval.
      await logAuditEvent(
        adminUserId,
        "PRIVILEGE_APPROVE",
        `privileged-access:${requestId}`,
        "SUCCESS",
        {
          requestId: Number(requestId),
          userId: result.rows[0].user_id,
          policyId: result.rows[0].policy_id,
          expiresAt: result.rows[0].expires_at,
        }
      );

      return res.status(200).json({
        message:
          "Privileged access approved",
        request: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Privileged access approval error:",
        error
      );

      return res.status(500).json({
        message: "Internal server error",
      });
    }
  }
);

// ============================================================
// ADMIN REVOKES PRIVILEGED ACCESS
// ============================================================

app.post(
  "/api/privileged-access/:id/revoke",
  authenticateToken,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    const adminUserId = req.user!.userId;
    const requestId = req.params.id;

    try {
      // Only ADMIN can revoke.
      const isAdmin = await hasPolicy(
        adminUserId,
        "ADMIN"
      );

      if (!isAdmin) {
        return res.status(403).json({
          message:
            "Forbidden: ADMIN access required",
        });
      }

      const result = await pool.query(
        `UPDATE privileged_access
         SET status = 'REVOKED',
             revoked_at = CURRENT_TIMESTAMP,
             revoked_by = $1
         WHERE id = $2
           AND status = 'ACTIVE'
           AND expires_at > CURRENT_TIMESTAMP
         RETURNING id,
                   user_id,
                   policy_id,
                   status,
                   revoked_at,
                   revoked_by`,
        [adminUserId, requestId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message:
            "Active privileged access request not found",
        });
      }

      // Audit revocation.
      await logAuditEvent(
        adminUserId,
        "PRIVILEGE_REVOKE",
        `privileged-access:${requestId}`,
        "SUCCESS",
        {
          requestId: Number(requestId),
          userId: result.rows[0].user_id,
          policyId: result.rows[0].policy_id,
          revokedAt: result.rows[0].revoked_at,
        }
      );

      return res.status(200).json({
        message:
          "Privileged access revoked",
        request: result.rows[0],
      });
    } catch (error) {
      console.error(
        "Privileged access revocation error:",
        error
      );

      return res.status(500).json({
        message: "Internal server error",
      });
    }
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(
    `PAM Security Test Lab running on port ${PORT}`
  );
});