import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuredPassword,
  passwordsMatch,
  safeNextPath,
  sessionIsValid,
  signSession,
} from './admin-session.mjs';

const SECRET = 'correct-horse-battery';
const NOW = Date.parse('2026-10-01T03:00:00.000Z');

test('placeholder and short passwords are unset', () => {
  assert.equal(configuredPassword(undefined), undefined);
  assert.equal(configuredPassword('   '), undefined);
  assert.equal(configuredPassword('short-pass'), undefined);
  assert.equal(configuredPassword('password'), undefined);
  assert.equal(configuredPassword('ChangeMe'), undefined);
  assert.equal(configuredPassword('your-password'), undefined);
  assert.equal(configuredPassword('xxxxxxxxxxxx'), undefined);
  assert.equal(configuredPassword(`  ${SECRET}  `), SECRET);
});

test('password compare does not throw on different lengths', () => {
  assert.equal(passwordsMatch(SECRET, SECRET), true);
  assert.equal(passwordsMatch('nope', SECRET), false);
  assert.equal(passwordsMatch('', SECRET), false);
  assert.equal(passwordsMatch(SECRET + SECRET, SECRET), false);
});

test('a signed session lasts until its expiry and fails closed otherwise', () => {
  const token = signSession(SECRET, NOW);
  assert.equal(sessionIsValid(token, SECRET, NOW + 1000), true);
  assert.equal(sessionIsValid(token, SECRET, NOW + 12 * 60 * 60 * 1000), false);
  assert.equal(sessionIsValid(token, 'another-long-secret', NOW + 1000), false);
  assert.equal(sessionIsValid(token.slice(0, -2) + 'aa', SECRET, NOW + 1000), false);
  assert.equal(sessionIsValid('not-a-token', SECRET, NOW), false);
  assert.equal(sessionIsValid(undefined, SECRET, NOW), false);
  assert.equal(sessionIsValid(token, '', NOW), false);

  const [payload, sig] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ exp: NOW + 999999999 })).toString('base64url');
  assert.equal(sessionIsValid(`${tampered}.${sig}`, SECRET, NOW), false);
  assert.equal(payload.length > 0, true);
});

test('next paths stay on the queue', () => {
  assert.equal(safeNextPath('/admin/queue'), '/admin/queue');
  assert.equal(safeNextPath('/admin'), '/admin/queue');
  assert.equal(safeNextPath('/admin/queue?form=review-request'), '/admin/queue?form=review-request');
  assert.equal(safeNextPath('/admin/queue/?form=company-suggestion'), '/admin/queue?form=company-suggestion');
  assert.equal(safeNextPath('https://evil.example/admin/queue'), '/admin/queue');
  assert.equal(safeNextPath('//evil.example/admin/queue'), '/admin/queue');
  assert.equal(safeNextPath('/admin/login'), '/admin/queue');
  assert.equal(safeNextPath('/admin/logout'), '/admin/queue');
  assert.equal(safeNextPath('/admin/queue?form=review-request&next=https://evil.example'), '/admin/queue');
  assert.equal(safeNextPath('/admin/queue?form=javascript:alert(1)'), '/admin/queue');
  assert.equal(safeNextPath('/donate'), '/admin/queue');
  assert.equal(safeNextPath(undefined), '/admin/queue');
});
