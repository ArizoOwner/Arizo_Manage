// 24-word Recovery Key: 256 bits of CSPRNG entropy + an 8-bit SHA-256 checksum = 264 bits = 24 x 11-bit
// indexes into the BIP-39 English word list (`../data/bip39-english.json`, 2048 words, copied verbatim from
// github.com/bitcoin/bips/blob/master/bip-0039/english.txt, SHA-256 2f5eed53...b24dbda). Same encoding as
// BIP-39, but the words are used only as a backup key (HKDF input), never as a wallet seed.
import WORDS from '../data/bip39-english.json';
import { randomBytes } from '../crypto/bytes';
import { sha256 } from '../crypto/primitives';

const LIST = WORDS as string[];
const INDEX = new Map(LIST.map((w, i) => [w, i]));
export const RECOVERY_WORDS = 24;

async function toWords(entropy: Uint8Array): Promise<string[]> {
  const check = (await sha256(entropy))[0]!;
  let bits = '';
  for (const b of entropy) bits += b.toString(2).padStart(8, '0');
  bits += check.toString(2).padStart(8, '0');
  return Array.from({ length: RECOVERY_WORDS }, (_, i) => LIST[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]!);
}

export async function generateRecoveryKey(): Promise<{ entropy: Uint8Array; words: string[] }> {
  const entropy = randomBytes(32);
  return { entropy, words: await toWords(entropy) };
}

export const recoveryWords = toWords;

/** Words (any case/spacing, Persian or Latin separators) → the 32-byte entropy, or null when unknown/typo'd. */
export async function parseRecoveryKey(input: string): Promise<Uint8Array | null> {
  const words = input.toLowerCase().split(/[\s,،‌]+/).filter(Boolean);
  if (words.length !== RECOVERY_WORDS) return null;
  let bits = '';
  for (const w of words) {
    const i = INDEX.get(w);
    if (i === undefined) return null;
    bits += i.toString(2).padStart(11, '0');
  }
  const entropy = new Uint8Array(32);
  for (let i = 0; i < 32; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return (await sha256(entropy))[0] === parseInt(bits.slice(256), 2) ? entropy : null;
}
