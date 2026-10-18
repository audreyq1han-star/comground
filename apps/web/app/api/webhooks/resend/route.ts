import { notificationConfiguration, notifications } from '../../../../lib/notification-runtime.ts';
import { createResendWebhookHandler } from '../../../../lib/notification-webhook.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createResendWebhookHandler({ config: notificationConfiguration, store: notifications });
