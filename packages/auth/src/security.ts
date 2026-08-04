import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  freshSessionMiddleware,
} from 'better-auth/api'

import { getOpenExpertPasswordIssue } from './password-policy.ts'

type PasswordField = 'password' | 'newPassword'

const PASSWORD_FIELDS_BY_PATH: Readonly<Record<string, PasswordField>> = {
  '/sign-up/email': 'password',
  '/reset-password': 'newPassword',
  '/change-password': 'newPassword',
  '/phone-number/reset-password': 'newPassword',
}

type SecurityHookContext = {
  path?: string
  operationId?: unknown
}

function operationId(context: unknown): unknown {
  return (context as { operationId?: unknown } | null)?.operationId
}

export function getOpenExpertNewPasswordField(
  context: SecurityHookContext,
): PasswordField | null {
  if (operationId(context) === 'setPassword') return 'newPassword'
  return context.path ? PASSWORD_FIELDS_BY_PATH[context.path] ?? null : null
}

function isSetPassword(context: unknown): boolean {
  return operationId(context) === 'setPassword'
}

export const openExpertPasswordPolicyPlugin = {
  id: 'openexpert-password-policy',
  hooks: {
    before: [
      {
        // `setPassword` links a new credential to an existing account. Better
        // Auth marks it server-only but otherwise accepts any valid session.
        matcher: isSetPassword,
        handler: freshSessionMiddleware,
      },
      {
        matcher: context => getOpenExpertNewPasswordField(context) != null,
        handler: createAuthMiddleware(async (context) => {
          const field = getOpenExpertNewPasswordField(context)
          const body = context.body as Record<string, unknown> | undefined
          const password = field ? body?.[field] : undefined
          // Invalid/missing fields remain the endpoint schema's responsibility.
          if (typeof password !== 'string') return

          const issue = getOpenExpertPasswordIssue(password)
          if (issue) {
            throw new APIError('BAD_REQUEST', {
              code: 'PASSWORD_POLICY_VIOLATION',
              message: issue,
            })
          }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

export function requireOpenExpertPasskeyUserVerification(
  userVerified: boolean | undefined,
): void {
  if (userVerified === true) return
  throw new APIError('UNAUTHORIZED', {
    code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
    message: 'Passkey user verification is required',
  })
}

export function requireOpenExpertPasskeyAuthenticationOptions(
  returned: unknown,
): unknown {
  if (returned == null || typeof returned !== 'object' || Array.isArray(returned)) {
    return returned
  }
  return {
    ...(returned as Record<string, unknown>),
    userVerification: 'required',
  }
}

export const openExpertPasskeyOptionsPlugin = {
  id: 'openexpert-passkey-options',
  hooks: {
    after: [{
      matcher: context => context.path === '/passkey/generate-authenticate-options',
      handler: createAuthMiddleware(async (context) => {
        context.context.returned = requireOpenExpertPasskeyAuthenticationOptions(
          context.context.returned,
        )
      }),
    }],
  },
} satisfies BetterAuthPlugin
