import type { SessionUser } from './session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the sign-in check for every request that gets past it. */
    user?: SessionUser;
  }
}
