import test from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import app from '../src/app.js';

test('health endpoint exposes readiness metadata without starting the HTTP server', async () => {
  const response = await request(app).get('/health');

  assert.ok([200, 503].includes(response.statusCode));
  assert.equal(typeof response.body.status, 'string');
  assert.equal(typeof response.body.ready, 'boolean');
  assert.equal(typeof response.body.environment, 'string');
  assert.equal(typeof response.body.services?.firebase, 'boolean');
});
