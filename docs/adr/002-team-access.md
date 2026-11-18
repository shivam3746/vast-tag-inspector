# ADR 002 — Team access through the API

Accepted.

## Context

Users share inspections within a team while keeping other teams' records private. A Supabase session establishes identity. Team membership and permissions can change independently of that token.

## Decision

Verify asymmetric Supabase JWTs against the project's JWKS, issuer, audience, expiry, and authenticated role. Use the verified subject to load a PostgreSQL profile on every request. That profile supplies the team and role used by authorization.

Construct a team-scoped repository for history, details, mutations, and explanation-cache reads. Return `404` for an object outside the team. Viewers can read, ad operations users can submit and explain, and admins can also delete.

Serve the browser and API from one origin, with Vite's proxy during development. The API grants no cross-origin browser access. Requests authenticate with a bearer token.

## Consequences

Profile changes apply to subsequent requests. Access checks stay on the server with database credentials. The database connection is trusted, and migrations currently install no RLS policies. Exposing the schema directly through Supabase requires separate privileges and policies.
