const CHANNEL_LABELS: Record<string, string> = {
  in_app: 'In app',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  push: 'Push',
};

/** Staff-facing channel name. Unknown keys keep their words without underscores. */
export function channelLabel(channel: string): string {
  const known = CHANNEL_LABELS[channel];
  if (known) return known;
  const words = channel.trim().replaceAll('_', ' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : channel;
}
