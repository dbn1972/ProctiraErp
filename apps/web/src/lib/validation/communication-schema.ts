import { z } from 'zod';

export const circularFormSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(20_000),
  audienceType: z.enum(['all', 'roles', 'classes', 'institution']),
  audienceIds: z.string().optional(),
  recipientIds: z.string().optional(),
  requiresAck: z.boolean().optional(),
  channels: z.array(z.string()).optional(),
});
export type CircularFormValues = z.infer<typeof circularFormSchema>;

// ─── Campaigns / emergency blasts (PRC-L232 / PRC-L241) ──────────────────────
// Shared by the server actions and the client forms so both reject the same input.

export const CAMPAIGN_CHANNELS = ['email', 'sms', 'push', 'in_app'] as const;
export const CAMPAIGN_AUDIENCE_SCOPES = ['all', 'grade', 'hostel', 'route'] as const;

const audienceRefId = z.string().uuid();

/** Audience selector built by NewCampaignForm (`scope` + the one id/grade it needs). */
export const campaignAudienceSchema = z
  .object({
    scope: z.enum(CAMPAIGN_AUDIENCE_SCOPES),
    grade: z.string().trim().min(1).max(64).optional(),
    hostelId: audienceRefId.optional(),
    routeId: audienceRefId.optional(),
  })
  .strict();
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export const createCampaignInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  channels: z.array(z.enum(CAMPAIGN_CHANNELS)).max(CAMPAIGN_CHANNELS.length).optional(),
  body: z.string().max(20_000).optional(),
  audienceJson: campaignAudienceSchema.optional(),
});

export const emergencyBlastInputSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(2000),
  channels: z
    .array(z.enum(CAMPAIGN_CHANNELS))
    .min(1, 'Choose at least one channel')
    .max(CAMPAIGN_CHANNELS.length),
});
