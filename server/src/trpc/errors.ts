import { TRPCError } from '@trpc/server'

export type AuthErrorCause =
  { code: 'AUTH_REQUIRED'; provider: string } | { code: 'LAN_AUTH_REQUIRED' }

export function badRequest(message: string): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message })
}

export function notFound(message: string): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message })
}

export function failed(message: string): TRPCError {
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
}

export function unavailable(message: string): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message })
}

export function tooManyRequests(message: string): TRPCError {
  return new TRPCError({ code: 'TOO_MANY_REQUESTS', message })
}

export function conflict(message: string): TRPCError {
  return new TRPCError({ code: 'CONFLICT', message })
}

export function unauthorized(message: string): TRPCError {
  return new TRPCError({ code: 'UNAUTHORIZED', message })
}

export function authRequiredError(provider: string): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: 'AUTH_REQUIRED',
    cause: { code: 'AUTH_REQUIRED', provider } satisfies AuthErrorCause,
  })
}

export function lanAuthRequiredError(): TRPCError {
  return new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'LAN_AUTH_REQUIRED',
    cause: { code: 'LAN_AUTH_REQUIRED' } satisfies AuthErrorCause,
  })
}
