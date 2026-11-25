/**
 * Env-driven channel sender factory (W2-INT-03 + W1-ARCH-08).
 *
 * Sandbox: accept + honesty metadata (existing behavior outside production).
 * Production: sandbox only with explicit opt-in (PROVIDER_MODE=sandbox and/or
 * ALLOW_SANDBOX_PROVIDERS=1); otherwise fail closed at config load.
 * PROVIDER_MODE=live: PRC-M326 (DR50) MSG91 / SES / FCM senders when their full
 * credential set is configured; otherwise refuse silent success (fail closed).
 */
import { resolveProviderDeliveryMode } from '@proctira/common';

import {
  createFcmPushSender,
  createMsg91SmsSender,
  createSesEmailSender,
  loadFcmConfigFromEnv,
  loadMsg91ConfigFromEnv,
  loadSesConfigFromEnv,
  type DeviceTokenLookup,
} from './live-channel-senders.js';
import type { EmailSender, PushSender, SmsSender } from './notification-service.js';
import { createSandboxEmailSender, EMAIL_SANDBOX_HONESTY_NOTE } from './sandbox-email-sender.js';
import { createSandboxPushSender, PUSH_SANDBOX_HONESTY_NOTE } from './sandbox-push-sender.js';
import { createSandboxSmsSender, SMS_SANDBOX_HONESTY_NOTE } from './sandbox-sms-sender.js';

export const LIVE_SMS_UNIMPLEMENTED_NOTE =
  'Live SMS adapter not configured — refusing silent success. Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID or unset PROVIDER_MODE=live.';

export const LIVE_EMAIL_UNIMPLEMENTED_NOTE =
  'Live email adapter not configured — refusing silent success. Set SES_REGION, SES_FROM_ADDRESS and AWS credentials or unset PROVIDER_MODE=live.';

export const LIVE_PUSH_UNIMPLEMENTED_NOTE =
  'Live push adapter not configured — refusing silent success. Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY and a device store or unset PROVIDER_MODE=live.';

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
  if (wantsLive(env)) {
    const msg91 = loadMsg91ConfigFromEnv(env);
    return msg91 ? createMsg91SmsSender(msg91) : createUnimplementedLiveSmsSender();
  }
  return createSandboxSmsSender();
}

export function createEmailSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailSender {
  if (wantsLive(env)) {
    const ses = loadSesConfigFromEnv(env);
    return ses ? createSesEmailSender(ses) : createUnimplementedLiveEmailSender();
  }
  return createSandboxEmailSender();
}

export function createPushSenderFromEnv(
  env: Record<string, string | undefined> = process.env,
  deps: { listDeviceTokens?: DeviceTokenLookup } = {},
): PushSender {
  if (wantsLive(env)) {
    const fcm = loadFcmConfigFromEnv(env);
    return fcm && deps.listDeviceTokens
      ? createFcmPushSender(fcm, deps.listDeviceTokens)
      : createUnimplementedLivePushSender();
  }
  return createSandboxPushSender();
}

export { EMAIL_SANDBOX_HONESTY_NOTE, PUSH_SANDBOX_HONESTY_NOTE, SMS_SANDBOX_HONESTY_NOTE };
