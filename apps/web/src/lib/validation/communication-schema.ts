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
