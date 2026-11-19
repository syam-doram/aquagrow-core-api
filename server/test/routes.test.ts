import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = 'test';
  const { default: app } = await import('../index.js');
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

const routes = [
  ['GET', '/api/health', '/api/v1/health', 200],
  ['GET', '/api/app-version', '/api/v1/app-version', 200],
  ['POST', '/api/auth/logout', '/api/v1/auth/logout', 401],
  ['GET', '/api/user/123/ponds', '/api/v1/farmer/user/123/ponds', 401],
  ['GET', '/api/admin/farmers', '/api/v1/admin/farmers', 401],
  ['GET', '/api/invoices', '/api/v1/shop/invoices', 401],
  ['GET', '/api/shop/orders', '/api/v1/shop/orders', 401],
  ['GET', '/api/hrms/payslips', '/api/v1/hr/payslips', 401],
  ['POST', '/api/espnow/heartbeat', '/api/v1/iot/espnow/heartbeat', 401],
] as const;

for (const [method, legacy, versioned, expectedStatus] of routes) {
  test(`${method} ${versioned} matches ${legacy}`, async () => {
    const [before, after] = await Promise.all([
      fetch(baseUrl + legacy, { method }),
      fetch(baseUrl + versioned, { method }),
    ]);
    assert.equal(before.status, expectedStatus);
    assert.equal(after.status, expectedStatus);
    assert.deepEqual(await after.json(), await before.json());
  });
}

test('readiness returns 503 when Atlas is disconnected', async () => {
  const response = await fetch(baseUrl + '/api/v1/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable' });
});
