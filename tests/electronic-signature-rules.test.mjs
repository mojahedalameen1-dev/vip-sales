import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'demo-vip-sales-esign';
const signatureRules = JSON.parse(await readFile(new URL('../firebase/electronic-signature.rules.json', import.meta.url)));
const existingRules = {
  users: {
    $uid: { '.read': 'auth != null && auth.uid == $uid', '.write': 'auth != null && auth.uid == $uid' }
  },
  fixtureUnrelated: { '.read': 'auth != null', '.write': false }
};
const base = 'electronicSignature';
const company = base + '/settings/company';
const logs = base + '/logs';
const image = { dataUrl: 'data:image/png;base64,YQ==', width: 1, height: 1 };
const emulatorAddress = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9199';
const [host, port] = emulatorAddress.split(':');
assert.ok(['127.0.0.1', 'localhost'].includes(host), 'Run rules tests on a local emulator only');

test('electronic-signature rules on the local Realtime Database emulator', async t => {
  const rules = { ...existingRules, ...signatureRules };
  for (const path of Object.keys(existingRules)) assert.equal(rules[path], existingRules[path]);
  const env = await initializeTestEnvironment({ projectId, database: {
    host, port: Number(port), rules: JSON.stringify({ rules })
  } });
  t.after(() => env.cleanup());
  await env.clearDatabase();

  const guest = env.unauthenticatedContext().database();
  const member = env.authenticatedContext('member').database();
  const operator = env.authenticatedContext('operator', { esignOperator: true, name: 'Operator' }).database();
  const admin = env.authenticatedContext('settings-admin', { esignSettingsAdmin: true }).database();
  const auditor = env.authenticatedContext('auditor', { esignAuditReader: true }).database();
  const timestamp = { '.sv': 'timestamp' };
  const record = {
    userId: 'operator', userName: 'Operator', signedAt: timestamp, documentType: 'contract',
    originalFileName: 'fixture.pdf', pageCount: 1, stampApplied: true, status: 'generated'
  };

  await t.test('unrelated owner-scoped data and existing rule branches preserve their decisions', async () => {
    await assertSucceeds(member.ref('users/member/leads/sample').set({ value: true }));
    await assertSucceeds(member.ref('users/member/leads').once('value'));
    await assertFails(operator.ref('users/member/leads').once('value'));
    await assertFails(guest.ref('users/member/leads/sample').set(null));
    await assertSucceeds(member.ref('fixtureUnrelated').once('value'));
    await assertFails(member.ref('fixtureUnrelated').set(true));
    await assertFails(member.ref('undeclaredFixture').once('value'));
  });

  await t.test('company assets can be read by operators and managed by settings admins only', async () => {
    await assertSucceeds(admin.ref(company + '/signature').set(image));
    assert.deepEqual((await assertSucceeds(operator.ref(company).once('value'))).val().signature, image);
    await assertSucceeds(admin.ref(company + '/signature').once('value'));
    await assertFails(guest.ref(company + '/signature').once('value'));
    await assertFails(member.ref(company + '/signature').once('value'));
    await assertFails(auditor.ref(company + '/signature').once('value'));
    await assertFails(operator.ref(company + '/signature').set(image));
    await assertFails(member.ref(company + '/signature').remove());
    await assertFails(admin.ref(company + '/other').set(image));
    await assertFails(admin.ref(company + '/signature').set({ ...image, width: 801 }));
    await assertSucceeds(admin.ref(company + '/signature').remove());
  });

  await t.test('operators can append their own generated event, with server time, once', async () => {
    await assertSucceeds(operator.ref(logs + '/fixture').set(record));
    await assertFails(operator.ref(logs + '/fixture').set(record));
    await assertFails(operator.ref(logs + '/fixture/pageCount').set(3));
    await assertFails(operator.ref(logs + '/fixture').remove());
    await assertFails(operator.ref(logs + '/other-user').set({ ...record, userId: 'member' }));
    await assertFails(operator.ref(logs + '/other-name').set({ ...record, userName: 'Other' }));
    await assertFails(operator.ref(logs + '/old-time').set({ ...record, signedAt: 123 }));
    await assertFails(operator.ref(logs + '/too-short').set({
      ...record, documentType: 'technical_offer', stampApplied: false
    }));
    await assertSucceeds(operator.ref(logs + '/offer').set({
      ...record, documentType: 'technical_offer', stampApplied: false, pageCount: 2
    }));
    await assertFails(member.ref(logs + '/member').set({ ...record, userId: 'member' }));
    await assertFails(admin.ref(logs + '/admin').set({ ...record, userId: 'settings-admin' }));
  });

  await t.test('audit access is independent from managing assets or writing events', async () => {
    const snapshot = await assertSucceeds(auditor.ref(logs).orderByChild('signedAt').limitToLast(100).once('value'));
    assert.equal(snapshot.numChildren(), 2);
    assert.ok(Number.isSafeInteger(snapshot.child('fixture/signedAt').val()));
    await assertFails(guest.ref(logs).once('value'));
    await assertFails(member.ref(logs).once('value'));
    await assertFails(operator.ref(logs).once('value'));
    await assertFails(admin.ref(logs).once('value'));
    await assertFails(auditor.ref(logs + '/fixture').remove());
  });
});
