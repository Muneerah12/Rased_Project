import { sha256, signIn } from '../src/services/auth';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++; };

ok(sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256 empty string');
ok(sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 "abc"');
ok(sha256('a'.repeat(1000)) === '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3', 'sha256 multi-block');
ok(signIn('admin', 'admin').ok === false, 'short password rejected');
const short = signIn('admin', 'admin');
ok(!short.ok && short.reason === 'short', 'short password reason');
ok(!signIn('admin', 'wrongpass1').ok, 'wrong password rejected');
ok(!signIn('root', 'admin12345').ok, 'wrong user rejected');
ok(signIn('admin', 'admin12345').ok, 'admin / admin12345 accepted');
ok(signIn(' admin ', 'admin12345').ok, 'username whitespace trimmed');
// lockout after 5 failures
let r = signIn('admin', 'nope-nope-1', 1);
for (let i = 0; i < 4; i++) r = signIn('admin', 'nope-nope-1', 1);
ok(!r.ok && r.reason === 'locked', 'locked after 5 failures');
ok(!signIn('admin', 'admin12345', 2).ok, 'correct password refused while locked');
ok(signIn('admin', 'admin12345', 40_000).ok, 'unlocked after 30s');

if (failed) { console.log(`${failed} FAILED`); process.exit(1); } else console.log('ALL PASSED');
