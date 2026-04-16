// Global filter state — shared by all dashboard sections.
// Lives in the URL query string so links/bookmarks/refresh "just work".

import { z } from 'zod';

export const SOURCE_BUCKETS = [
  'telegram_boostyfi',
  'telegram_iamlimitless',
  'facebook',
  'website',
  'email',
  'other',
  'unknown',
] as const;

export const STATUS_BUCKETS = [
  'new',
  'in_progress',
  'negotiation',
  'tech_q',
  'no_reply',
  'closed_deal',
  'closed',
  'unknown',
] as const;

export type SourceBucket = (typeof SOURCE_BUCKETS)[number];
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  '7d',
  '30d',
  'this_month',
  'last_month',
  'all',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

// Display labels (Russian) for UI components.
export const SOURCE_LABELS: Record<SourceBucket, string> = {
  telegram_boostyfi: 'Telegram (Boostyfi)',
  telegram_iamlimitless: 'Telegram (Iamlimitless)',
  facebook: 'Facebook',
  website: 'Сайт',
  email: 'E-mail',
  other: 'Прочее',
  unknown: 'Не определён',
};

export const STATUS_LABELS: Record<StatusBucket, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  negotiation: 'Переговоры',
  tech_q: 'Тех. вопрос',
  no_reply: 'Без ответа',
  closed_deal: 'Closed Deal',
  closed: 'Закрыт',
  unknown: 'Не определён',
};

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '30d': '30 дней',
  this_month: 'Этот месяц',
  last_month: 'Прошлый месяц',
  all: 'Всё время',
  custom: 'Период',
};

// Zod schema for *parsed* (server-side) filter state.
// `from` / `to` are unix seconds.
export const FilterSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default('30d'),
  from: z.number().int().nonnegative().nullable(),
  to: z.number().int().nonnegative().nullable(),
  sources: z.array(z.enum(SOURCE_BUCKETS)),
  statuses: z.array(z.enum(STATUS_BUCKETS)),
});

export type Filters = z.infer<typeof FilterSchema>;

export const DEFAULT_FILTERS: Filters = {
  period: '30d',
  from: null,
  to: null,
  sources: [],
  statuses: [],
};
