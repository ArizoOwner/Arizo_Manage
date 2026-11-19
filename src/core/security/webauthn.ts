// WebAuthn passkey with the PRF extension (PROMPT.md §5.2, iOS PWA).
// With PRF the authenticator returns a secret that only a successful Face ID / Touch ID produces;
// we turn it into a KEK, so biometrics truly gate the key (not just the UI).
// Without PRF support (older iOS/Android browsers) biometrics are not offered: a UI-only biometric
// gate would not protect the data, and the spec forbids security theatre.
import { randomBytes, te, toB64, fromB64 } from '../crypto/bytes';

// A fixed, app-specific PRF input. The secret comes from the authenticator, not from this salt.
const PRF_SALT = te.encode('arizo/webauthn-prf/v1/0000000000000');

type PrfResults = { results?: { first?: ArrayBuffer } };

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== 'undefined' && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

function prfOf(cred: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults & { enabled?: boolean } };
  const first = ext.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/**
 * Create a passkey on this device and immediately evaluate PRF.
 * Returns null when the platform cannot do PRF (the caller then keeps PIN-only).
 */
export async function enrolPasskey(displayName: string): Promise<{ credentialIdB64: string; prf: Uint8Array<ArrayBuffer> } | null> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Arizo Manage' },
      user: { id: randomBytes(16) as Uint8Array<ArrayBuffer>, name: displayName, displayName },
      challenge: randomBytes(32) as Uint8Array<ArrayBuffer>,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const credentialIdB64 = toB64(new Uint8Array(cred.rawId));
  // Some platforms only report prf.enabled at creation; evaluate with a get() in that case.
  const prf = prfOf(cred) ?? (await evaluatePrf(credentialIdB64));
  return prf ? { credentialIdB64, prf } : null;
}

/** Face ID / Touch ID prompt; returns the PRF secret, or null when cancelled or unsupported. */
export async function evaluatePrf(credentialIdB64: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as Uint8Array<ArrayBuffer>,
        allowCredentials: [{ type: 'public-key', id: fromB64(credentialIdB64) as Uint8Array<ArrayBuffer>, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    return cred ? prfOf(cred) : null;
  } catch {
    return null; // NotAllowedError = user cancelled or timed out
  }
}
