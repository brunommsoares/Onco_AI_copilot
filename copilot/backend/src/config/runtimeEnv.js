const DEFAULT_DEV_CORS_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174'
]);

const DEVELOPMENT_JWT_SECRET = 'development-only-jwt-secret-change-before-production';

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseFloatNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseCsv(value) {
  if (!value) {
    return [];
  }

  return [...new Set(
    String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

export function resolveAllowedOrigins(env = process.env) {
  const configured = parseCsv(env.ALLOWED_ORIGINS || env.CORS_ORIGIN);
  return configured.length > 0 ? configured : [...DEFAULT_DEV_CORS_ORIGINS];
}

export function buildCorsOptions(allowedOrigins) {
  const allowedOriginSet = new Set(allowedOrigins);

  return {
    origin(origin, callback) {
      if (!origin || allowedOriginSet.has(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error(`Origin ${origin} is not allowed by CORS`);
      error.statusCode = 403;
      callback(error);
    },
    credentials: true
  };
}

export function resolveJwtSecret({ environment = process.env.NODE_ENV || 'development', env = process.env } = {}) {
  const value = String(env.JWT_SECRET || '').trim();

  if (value) {
    return {
      value,
      source: 'env',
      insecure: false
    };
  }

  if (environment === 'production') {
    return {
      value: null,
      source: 'missing',
      insecure: true
    };
  }

  return {
    value: DEVELOPMENT_JWT_SECRET,
    source: 'development-fallback',
    insecure: true
  };
}

export function buildRuntimeDiagnostics({
  environment = process.env.NODE_ENV || 'development',
  env = process.env,
  requiredEnvVars = [],
  allowedOrigins = resolveAllowedOrigins(env),
  jwt = resolveJwtSecret({ environment, env })
} = {}) {
  const missingEnvVars = [...new Set(
    requiredEnvVars.filter((name) => !String(env[name] || '').trim())
  )];

  const warnings = [];

  if (!env.ALLOWED_ORIGINS && !env.CORS_ORIGIN) {
    warnings.push('No explicit CORS origins configured; falling back to localhost defaults.');
  }

  if (jwt.source === 'development-fallback') {
    warnings.push('JWT_SECRET is not set; using an insecure development fallback secret.');
  }

  if (jwt.source === 'missing') {
    missingEnvVars.push('JWT_SECRET');
    warnings.push('JWT_SECRET is required in production.');
  }

  return {
    environment,
    allowedOrigins,
    jwt,
    missingEnvVars: [...new Set(missingEnvVars)],
    warnings
  };
}

export { DEFAULT_DEV_CORS_ORIGINS };
