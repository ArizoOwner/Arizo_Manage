// Static guards for the Kotlin plugins (they cannot run in Vitest). Each one pins a bug that only showed
// on a real phone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const kt = (name: string) => readFileSync(`android/app/src/main/java/com/arizo/manage/plugins/${name}.kt`, 'utf8');

describe('ArizoSqlCipherPlugin', () => {
  it('never runs a PRAGMA through execSQL (SQLCipher throws for statements that return a row)', () => {
    // `PRAGMA secure_delete = ON` returns a row; execSQL rejected it, every open failed and the PIN
    // screen looked frozen (device report after Phase 9).
    expect(kt('ArizoSqlCipherPlugin')).not.toMatch(/execSQL\(\s*"PRAGMA/i);
  });
});
