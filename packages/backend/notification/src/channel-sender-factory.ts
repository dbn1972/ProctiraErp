/**
 * Env-driven channel sender factory (W2-INT-03 + W1-ARCH-08).
 *
 * Sandbox: accept + honesty metadata (existing behavior outside production).
 * Production: sandbox only with explicit opt-in (PROVIDER_MODE=sandbox and/or
 * ALLOW_SANDBOX_PROVIDERS=1); otherwise fail closed at config load.
 * PROVIDER_MODE=live: refuse silent success until real Twilio/SES/FCM adapters exist.
 */
import { resolveProviderDeliveryMode } from '@proctira/common';

import type { EmailSender, PushSender, SmsSender } from './notification-service.js';
import { createSandboxEmailSender, EMAIL_SANDBOX_HONESTY_NOTE } from './sandbox-email-sender.js';
import { createSandboxPushSender, PUSH_SANDBOX_HONESTY_NOTE } from './sandbox-push-sender.js';
import { createSandboxSmsSender, SMS_SANDBOX_HONESTY_NOTE } from './sandbox-sms-sender.js';

export const LIVE_SMS_UNIMPLEMENTED_NOTE =
  'Live SMS adapter not implemented — refusing silent success. Unset PROVIDER_MODE=live or wire Twilio.';

export const LIVE_EMAIL_UNIMPLEMENTED_NOTE =
  'Live email adapter not implemented — refusing silent success. Unset PROVIDER_MODE=live or wire SMTP/SES.';

export const LIVE_PUSH_UNIMPLEMENTED_NOTE =
  'Live push adapter not implemented — refusing silent success. Unset PROVIDER_MODE=live or wire FCM.';

function wantsLive(env: Record<string, string | undefined>): boolean {
  return resolveProviderDeliveryMode('notification', env) === 'live';
}

export function createUnimplementedLiveSmsSender(): SmsSender {
  return {
    async send() {
      return {
        success: false,
        error: LIVE_SMS_UNIMPLEMENTED_NOTE,
        mode: 'live',
        honestyNote: LIVE_SMS_UNIMPLEMENTED_NOTE,
      };
    },
  };
}

export function createUnimplementedLiveEmailSender(): EmailSender {
  return {
    async send() {
      return {
        success: false,
        error: LIVE_EMAIL_UNIMPLEMENTED_NOTE,
        mode: 'live',
        honestyNote: LIVE_EMAIL_UNIMPLEMENTED_NOTE,
      };
    },
  };
}

export function createUnimplementedLivePushSender(): PushSender {
  return {
    async send() {
      return {
        success: false,
        error: LIVE_PUSH_UNIMPLEMENTED_NOTE,
        mode: 'live',
        honestyNote: LIVE_PUSH_UNIMPLEMENTED_NOTE,
      };
    },
  };
}

export function createSmsSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmsSender {
  if (wantsLive(env)) return createUnimplementedLiveSmsSender();
  return createSandboxSmsSender();
}

export function createEmailSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailSender {
  if (wantsLive(env)) return createUnimplementedLiveEmailSender();
  return createSandboxEmailSender();
}

export function createPushSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
): PushSender {
  if (wantsLive(env)) return createUnimplementedLivePushSender();
  return createSandboxPushSender();
}

export { EMAIL_SANDBOX_HONESTY_NOTE, PUSH_SANDBOX_HONESTY_NOTE, SMS_SANDBOX_HONESTY_NOTE };
