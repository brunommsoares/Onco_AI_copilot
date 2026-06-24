import test from 'node:test';
import assert from 'node:assert/strict';

import config from '../src/config/config.js';
import { authenticateUser } from '../src/middleware/authMiddleware.js';

test('authenticateUser reports server misconfiguration when JWT secret is missing', async () => {
  const originalSecret = config.jwt.secret;
  config.jwt.secret = null;

  try {
    const req = {
      headers: {
        authorization: 'Bearer test-token'
      },
      method: 'GET',
      originalUrl: '/api/evidence'
    };

    let capturedError = null;

    await new Promise((resolve) => {
      authenticateUser(req, {}, (error) => {
        capturedError = error;
        resolve();
      });
    });

    assert.equal(capturedError?.message, 'JWT secret is not configured');
    assert.equal(capturedError?.statusCode, 500);
  } finally {
    config.jwt.secret = originalSecret;
  }
});
