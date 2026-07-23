import { z } from 'zod';

export const authSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const bookingSchema = z.object({
  competitionId: z.string().min(1),
  pondId: z.number().int().positive(),
  seatIds: z.array(z.string()).min(1),
  paymentType: z.enum(['full', 'deposit', 'baki']),
  amount: z.number().nonnegative(),
  receiptUrl: z.string().url().optional(),
  bankReference: z.string().min(1).optional(),
  createdByStaff: z.boolean().optional(),
  createdByUid: z.string().optional(),
  pondSelections: z.array(z.object({
    pondId: z.number().int().positive(),
    pondName: z.string(),
    pondCode: z.string().optional(),
    pondDate: z.string().optional(),
    seats: z.array(z.number().int().positive()).min(1),
    seatIds: z.array(z.string()).optional(),
  })).optional(),
});

export const competitionSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  eventDate: z.string().datetime().optional(),
  regOpenAt: z.string().datetime().optional(),
  regCloseAt: z.string().datetime().optional(),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'LIVE', 'COMPLETED']),
});

export const prizeSchema = z.object({
  rank: z.number().int().positive(),
  label: z.string().optional(),
  prize: z.string().min(1),
});
