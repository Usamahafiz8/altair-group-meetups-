// Unit tests for the JWT verifier with a local ES256 key pair, so each claim
// rule is tested on its own with an otherwise valid signature. (With real
// keys, the anon key already fails on its signature before the role check.)
import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createVerifier } from '../../server/src/auth';

const URL_ = 'https://example.supabase.co';
const ISS = `${URL_}/auth/v1`;
const SUB = 'a1000000-0000-4000-8000-000000000003';

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };
const verify = createVerifier(URL_, createLocalJWKSet({ keys: [jwk] }));
const other = await generateKeyPair('ES256');

async function sign(claims: Record<string, unknown>, { key = privateKey, exp = '5m' as string | number } = {}) {
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setIssuer((claims.iss as string) ?? ISS)
    .setAudience((claims.aud as string) ?? 'authenticated')
    .setSubject((claims.sub as string) ?? SUB)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}
const bearer = (t: string) => `Bearer ${t}`;

describe('createVerifier', () => {
  it('accepts a valid member token and returns the subject', async () => {
    const m = await verify(bearer(await sign({})));
    expect(m.id).toBe(SUB);
    expect(m.claims.role).toBe('authenticated');
  });

  it.each([
    ['role anon (an anon key)', { role: 'anon' }],
    ['role service_role', { role: 'service_role' }],
    ['role meetup_writer (cannot self-select the write role)', { role: 'meetup_writer' }],
    ['wrong audience', { aud: 'something-else' }],
    ['wrong issuer', { iss: 'https://evil.example/auth/v1' }],
    ['non-uuid subject', { sub: 'admin' }],
  ])('rejects %s', async (_n, claims) => {
    await expect(verify(bearer(await sign(claims)))).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects an expired token', async () => {
    const t = await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verify(bearer(t))).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a token signed by a different key', async () => {
    await expect(verify(bearer(await sign({}, { key: other.privateKey })))).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it.each([undefined, '', 'Bearer', 'Token abc', 'Bearer a.b.c'])('rejects header %j', async (h) => {
    await expect(verify(h)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
