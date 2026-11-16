import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createSupabaseVerifier } from '../src/auth.ts';

const project = 'https://test-project.supabase.example';
const issuer = `${project}/auth/v1`;
const subject: string = randomUUID();
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let foreignKeys: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  keys = await generateKeyPair('ES256', { extractable: true });
  foreignKeys = await generateKeyPair('ES256');
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'fixture' };
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify({ keys: [jwk] })),
  );
  vi.stubGlobal('fetch', fetch);
  return { verify: createSupabaseVerifier(project), fetch };
}

function token({
  claimIssuer = issuer,
  audience = 'authenticated',
  expires: expiry = '5m',
  role = 'authenticated',
  user = subject,
  signingKey = keys.privateKey,
} = {}) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setIssuer(claimIssuer)
    .setAudience(audience)
    .setSubject(user)
    .setExpirationTime(expiry)
    .sign(signingKey);
}

it('verifies an access token using the configured Supabase JWKS URL', async () => {
  const { verify, fetch } = await setup();
  await expect(verify(await token())).resolves.toBe(subject);
  const url = fetch.mock.calls[0]?.[0];
  expect(String(url)).toBe(`${issuer}/.well-known/jwks.json`);
  await expect(verify(await token())).resolves.toBe(subject);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('rejects invalid signatures, expired tokens, incorrect issuer or audience, and non-user claims', async () => {
  const { verify } = await setup();
  for (const claims of [
    { signingKey: foreignKeys.privateKey },
    { expires: '-5m' },
    { claimIssuer: `https://different.supabase.example/auth/v1` },
    { audience: 'public' },
    { role: 'service_role' },
    { user: 'not-a-user-uuid' },
  ]) {
    await expect(verify(await token(claims))).resolves.toBeNull();
  }
});

it('requires an expiry claim even when the token has a valid signature', async () => {
  const { verify } = await setup();
  const noExpiry = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience('authenticated')
    .sign(keys.privateKey);
  await expect(verify(noExpiry)).resolves.toBeNull();
});
