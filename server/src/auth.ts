import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { Uuid } from '@altair/contract';
import { ApiFailure } from './errors.js';

export type Member = { id: string; claims: JWTPayload };

// Verifies Supabase access tokens locally against the project's published
// signing keys (ES256 JWKS, cached by jose). Checks signature, issuer,
// audience and expiry, and requires role "authenticated": the anon key is
// itself a JWT (role "anon") and must not count as a signed-in member.
// `keys` is injectable so tests can sign tokens with a local key pair.
export function createVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey) {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async function verify(authorization: string | undefined): Promise<Member> {
    const token = /^Bearer (.+)$/i.exec(authorization ?? '')?.[1];
    if (!token) throw new ApiFailure('unauthorized', 'Sign in required');
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
      const sub = Uuid.safeParse(payload.sub);
      if (payload.role !== 'authenticated' || !sub.success) throw new Error('not a member token');
      return { id: sub.data, claims: payload };
    } catch {
      throw new ApiFailure('unauthorized', 'Session is invalid or expired');
    }
  };
}
