import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCorsOptions,
  buildRuntimeDiagnostics,
  resolveAllowedOrigins,
  resolveJwtSecret
} from '../src/config/runtimeEnv.js';

test('resolveAllowedOrigins trims and deduplicates configured origins', () => {
  const origins = resolveAllowedOrigins({
    ALLOWED_ORIGINS: 'https://app.example.com, https://admin.example.com , https://app.example.com'
  });

  assert.deepEqual(origins, [
    'https://app.example.com',
    'https://admin.example.com'
  ]);
});

test('resolveJwtSecret uses a development fallback outside production', () => {
  const jwt = resolveJwtSecret({
    environment: 'development',
    env: {}
  });

  assert.equal(jwt.source, 'development-fallback');
  assert.equal(jwt.insecure, true);
  assert.ok(jwt.value);
});

test('resolveJwtSecret requires an explicit secret in production', () => {
  const jwt = resolveJwtSecret({
    environment: 'production',
    env: {}
  });

  assert.equal(jwt.source, 'missing');
  assert.equal(jwt.value, null);
});

test('buildRuntimeDiagnostics reports a missing JWT secret in production', () => {
  const diagnostics = buildRuntimeDiagnostics({
    environment: 'production',
    env: {
      ALLOWED_ORIGINS: 'https://app.example.com'
    }
  });

  assert.deepEqual(diagnostics.missingEnvVars, ['JWT_SECRET']);
  assert.ok(diagnostics.warnings.some((warning) => warning.includes('JWT_SECRET')));
});

test('buildCorsOptions allows configured origins', async () => {
  const corsOptions = buildCorsOptions(['https://app.example.com']);

  await new Promise((resolve, reject) => {
    corsOptions.origin('https://app.example.com', (error, allowed) => {
      try {
        assert.equal(error, null);
        assert.equal(allowed, true);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});

test('buildCorsOptions rejects unconfigured origins', async () => {
  const corsOptions = buildCorsOptions(['https://app.example.com']);

  await assert.rejects(
    new Promise((resolve, reject) => {
      corsOptions.origin('https://blocked.example.com', (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
    /not allowed by CORS/
  );
});
