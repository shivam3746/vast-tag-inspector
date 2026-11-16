import { eq } from 'drizzle-orm';
import type { RequestHandler, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Database } from './db.ts';
import { profiles } from './schema.ts';

type User = typeof profiles.$inferSelect;
type Role = User['role'];
export type VerifyAccessToken = (token: string) => Promise<string | null>;

declare module 'express-serve-static-core' {
  interface Locals {
    user: User;
  }
}

const userId = z.uuid();

export function createTokenVerifier(
  issuer: string,
  keys: JWTVerifyGetKey,
): VerifyAccessToken {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp', 'sub'],
      });
      const subject = userId.safeParse(payload.sub);
      return payload.role === 'authenticated' && subject.success
        ? subject.data
        : null;
    } catch {
      return null;
    }
  };
}

export function createSupabaseVerifier(projectUrl: string): VerifyAccessToken {
  const project = URL.parse(projectUrl.trim());
  if (
    !project ||
    project.protocol !== 'https:' ||
    project.username ||
    project.password ||
    project.pathname !== '/' ||
    project.search ||
    project.hash
  ) {
    throw new Error('SUPABASE_URL must be the HTTPS project origin.');
  }
  const issuer = new URL('/auth/v1', project).href;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: 3000,
  });
  return createTokenVerifier(issuer, keys);
}

function unauthorized(response: Response) {
  response
    .set('WWW-Authenticate', 'Bearer')
    .status(401)
    .json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'A valid access token is required.',
      },
    });
}

export function authenticate(
  db: Database,
  verifyAccessToken: VerifyAccessToken,
): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.get('authorization');
    const token = authorization?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
    )?.[1];
    const subject =
      token && token.length <= 8192 ? await verifyAccessToken(token) : null;
    if (!subject) {
      unauthorized(response);
      return;
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, subject))
      .limit(1);
    if (!profile) {
      response.status(403).json({
        error: {
          code: 'PROFILE_REQUIRED',
          message: 'Your account has no team profile.',
        },
      });
      return;
    }
    response.locals.user = profile;
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (_request, response, next) => {
    if (roles.includes(response.locals.user.role)) {
      next();
      return;
    }
    response.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Your role cannot perform this action.',
      },
    });
  };
}
