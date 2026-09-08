/**
 * SMS provider abstraction for MFA OTP delivery.
 *
 * - ConsoleSmsProvider: logs the OTP (local/dev)
 * - TwilioSmsProvider: posts to Twilio Messages API when TWILIO_* env is set
 */
export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

/** Masks 4–8 digit runs (OTP codes) so console/dev logs never carry a usable code (G-731). */
export function redactOtpDigits(body: string): string {
  return body.replace(/\b\d{4,8}\b/g, (match) => '•'.repeat(match.length));
}

/** Masks all but the last two digits of a phone number. */
export function maskPhone(to: string): string {
  const digits = to.replace(/\D/g, '');
  if (digits.length <= 2) return '••';
  return `${to.startsWith('+') ? '+' : ''}${'•'.repeat(digits.length - 2)}${digits.slice(-2)}`;
}

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send(message: SmsMessage): Promise<void> {
    // Dev flows read the code from MFA_EXPOSE_OTP's debugCode, not from logs.
    // eslint-disable-next-line no-console
    console.info(
      `[sms:console] to=${maskPhone(message.to)} body=${redactOtpDigits(message.body)}`,
    );
  }
}

export interface TwilioSmsProviderOptions {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(private readonly options: TwilioSmsProviderOptions) {}

  async send(message: SmsMessage): Promise<void> {
    const { accountSid, authToken, fromNumber } = this.options;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: message.to,
      From: fromNumber,
      Body: message.body,
    });
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Twilio SMS failed (${response.status}): ${text}`);
    }
  }
}

/**
 * Build an SmsProvider from environment variables.
 * Uses Twilio when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER
 * are all set; otherwise falls back to the console provider.
 */
export function createSmsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const accountSid = env['TWILIO_ACCOUNT_SID']?.trim();
  const authToken = env['TWILIO_AUTH_TOKEN']?.trim();
  const fromNumber = env['TWILIO_FROM_NUMBER']?.trim();
  if (accountSid && authToken && fromNumber) {
    return new TwilioSmsProvider({ accountSid, authToken, fromNumber });
  }
  return new ConsoleSmsProvider();
}
