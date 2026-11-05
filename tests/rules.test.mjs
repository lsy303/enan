// اختبار قواعد الأمان — يُشغَّل على جهازك:
//   npm i -D @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore "node tests/rules.test.mjs"
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'stable-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const future = Timestamp.fromMillis(Date.now() + 30 * 864e5);
const past   = Timestamp.fromMillis(Date.now() - 864e5);

// بيانات أولية بدون قواعد
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'admins/me'), { name: 'Abdulla' });
  // إسطبل A فعّال: مالك + موظف
  await setDoc(doc(db, 'stables/A'), { name: 'إسطبل أ', ownerUid: 'ownerA', status: 'active', subscriptionEnd: future });
  await setDoc(doc(db, 'stables/A/members/ownerA'), { role: 'owner' });
  await setDoc(doc(db, 'stables/A/members/staffA'), { role: 'staff' });
  await setDoc(doc(db, 'stables/A/trainees/t1'), { name: 'سارة' });
  await setDoc(doc(db, 'stables/A/expenses/e1'), { amount: 10 });
  // إسطبل B منتهي الاشتراك
  await setDoc(doc(db, 'stables/B'), { name: 'إسطبل ب', ownerUid: 'ownerB', status: 'active', subscriptionEnd: past });
  await setDoc(doc(db, 'stables/B/members/ownerB'), { role: 'owner' });
  await setDoc(doc(db, 'stables/B/trainees/t1'), { name: 'محمد' });
});

const as = (u) => env.authenticatedContext(u).firestore();
const anon = env.unauthenticatedContext().firestore();
let pass = 0, fail = 0;
async function t(name, p) {
  try { await p; pass++; console.log('✅', name); }
  catch (e) { fail++; console.log('❌', name, '—', e.message); }
}

// ── العزل بين الإسطبلات ──
await t('زائر غير مسجّل لا يقرأ شيئاً',          assertFails(getDoc(doc(anon, 'stables/A/trainees/t1'))));
await t('مالك B لا يقرأ متدربي A',               assertFails(getDoc(doc(as('ownerB'), 'stables/A/trainees/t1'))));
await t('مالك B لا يكتب في A',                    assertFails(setDoc(doc(as('ownerB'), 'stables/A/trainees/x'), { name: 'x' })));
await t('مالك A يقرأ متدربيه',                    assertSucceeds(getDoc(doc(as('ownerA'), 'stables/A/trainees/t1'))));

// ── التفعيل الذاتي ممنوع ──
await t('المالك لا يمدد اشتراكه بنفسه',           assertFails(updateDoc(doc(as('ownerA'), 'stables/A'), { subscriptionEnd: Timestamp.fromMillis(Date.now() + 9e11) })));
await t('مالك منتهٍ لا يعيد تفعيل نفسه',          assertFails(updateDoc(doc(as('ownerB'), 'stables/B'), { status: 'active', subscriptionEnd: future })));
await t('المالك يعدّل اسم إسطبله',                assertSucceeds(updateDoc(doc(as('ownerA'), 'stables/A'), { name: 'إسطبل أ الجديد' })));
await t('أنت (المشرف) تمدد الاشتراك',             assertSucceeds(updateDoc(doc(as('me'), 'stables/B'), { subscriptionEnd: future })));
await env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), 'stables/B'), { subscriptionEnd: past }));

// ── التسجيل الجديد ──
{
  const b = writeBatch(as('newUser'));
  b.set(doc(as('newUser'), 'stables/N'), { name: 'جديد', ownerUid: 'newUser', status: 'pending' });
  b.set(doc(as('newUser'), 'stables/N/members/newUser'), { role: 'owner' });
  await t('تسجيل جديد ينشئ إسطبلاً بانتظار التفعيل', assertSucceeds(b.commit()));
}
await t('التسجيل لا يُنشئ إسطبلاً مفعّلاً',        assertFails(setDoc(doc(as('hacker'), 'stables/H'), { name: 'h', ownerUid: 'hacker', status: 'active' })));
await t('لا يضيف نفسه مالكاً لإسطبل غيره',        assertFails(setDoc(doc(as('hacker'), 'stables/A/members/hacker'), { role: 'owner' })));
await t('الإسطبل المعلّق لا يكتب بيانات',          assertFails(setDoc(doc(as('newUser'), 'stables/N/trainees/x'), { name: 'x' })));

// ── انتهاء الاشتراك ──
await t('المنتهي يقرأ بياناته (لا يفقدها)',       assertSucceeds(getDoc(doc(as('ownerB'), 'stables/B/trainees/t1'))));
await t('المنتهي لا يضيف بيانات',                 assertFails(setDoc(doc(as('ownerB'), 'stables/B/trainees/x'), { name: 'x' })));

// ── صلاحيات الموظف ──
await t('الموظف يضيف متدرباً',                     assertSucceeds(setDoc(doc(as('staffA'), 'stables/A/trainees/t2'), { name: 'جديد' })));
await t('الموظف يسجّل حضوراً',                     assertSucceeds(setDoc(doc(as('staffA'), 'stables/A/trainees/t1/attendance/a1'), { hours: 1 })));
await t('الموظف لا يحذف متدرباً',                  assertFails(deleteDoc(doc(as('staffA'), 'stables/A/trainees/t1'))));
await t('الموظف لا يرى المصاريف',                  assertFails(getDoc(doc(as('staffA'), 'stables/A/expenses/e1'))));
await t('الموظف لا يعدّل الباقات (المال)',         assertFails(setDoc(doc(as('staffA'), 'stables/A/trainees/t1/packages/p1'), { fee: 0 })));
await t('الموظف لا يرقّي نفسه لمالك',              assertFails(updateDoc(doc(as('staffA'), 'stables/A/members/staffA'), { role: 'owner' })));
await t('المالك يضيف موظفاً',                      assertSucceeds(setDoc(doc(as('ownerA'), 'stables/A/members/staff2'), { role: 'staff' })));
await t('المالك لا يضيف مالكاً ثانياً',            assertFails(setDoc(doc(as('ownerA'), 'stables/A/members/x'), { role: 'owner' })));

// ── حساب المشرف ──
await t('لا أحد ينصّب نفسه مشرفاً',               assertFails(setDoc(doc(as('hacker'), 'admins/hacker'), {})));

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
await env.cleanup();
process.exit(fail ? 1 : 0);
