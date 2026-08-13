import admin, { firebaseApp } from '../config/firebase.js';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Authentication gate for the clinical data routes
// (/api/simple-chat, /api/trial-registry, /api/infarmed-reimbursement,
//  /api/ema, /api/esmo-guidelines).
//
// The frontend already requires a Firebase login (PrivateRoute in App.jsx) and
// attaches the user's Firebase ID token as a Bearer header; this middleware
// verifies that token server-side so the pipeline and the regulatory stores
// are not reachable anonymously.
//
// PUBLIC_DATA_ROUTES=true disables the gate. It defaults to open in
// development (so a clean clone works before Firebase Admin is configured)
// and to enforced in production.
// ---------------------------------------------------------------------------

let warnedNoFirebase = false;

export const dataRouteAuth = async (req, res, next) => {
  if (config.security.publicDataRoutes) return next();

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!firebaseApp) {
    if (!warnedNoFirebase) {
      warnedNoFirebase = true;
      logger.error('[dataRouteAuth] Firebase Admin is not configured — data routes cannot verify tokens. Set FIREBASE_SERVICE_ACCOUNT or, to run without authentication, PUBLIC_DATA_ROUTES=true.');
    }
    return res.status(503).json({ success: false, error: 'Authentication service unavailable' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    req.user = { id: decoded.uid, email: decoded.email || '', role: 'user' };
    return next();
  } catch (err) {
    logger.warn(`[dataRouteAuth] Token rejected for ${req.method} ${req.originalUrl}: ${err.message}`);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

export default dataRouteAuth;
