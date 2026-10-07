/**
 * Central permission and access control layer.
 * All queries for private data must derive user ID exclusively from req.authUser.id.
 */

function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({
      code: "AUTH_REQUIRED",
      message: "Please sign in to access this resource.",
      retryable: false,
    });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in to continue.",
        retryable: false,
      });
    }

    if (req.authUser.role !== role && req.authUser.role !== "admin") {
      return res.status(403).json({
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action.",
        retryable: false,
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
