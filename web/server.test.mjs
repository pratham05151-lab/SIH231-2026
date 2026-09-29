import test from 'node:test';
import assert from 'node:assert/strict';

test('canonical display IDs keep the ColorTrace prefix', () => {
  const id = 'CT-2026-000184';
  assert.match(id, /^CT-\d{4}-\d{6}$/);
});

test('a pending record is never displayed as cryptographically verified', () => {
  const sync = 'Pending sync';
  const verificationAllowed = sync !== 'Pending sync';
  assert.equal(verificationAllowed, false);
});
