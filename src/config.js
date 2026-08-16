import 'dotenv/config';

// Allow HTTPS requests to Iranian government portals with self-signed SSL certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export const config = {
  // Telegram Bot Token (from @BotFather)
  botToken: process.env.BOT_TOKEN || '',

  // GOPED Backend API
  apiUrl: process.env.GOPED_API_URL || 'https://modiriattolid.goped.ir:8090/',
  authToken: process.env.GOPED_AUTH_TOKEN || '7f3c2a91-6d84-4b17-a5e9-2c0f8d6b31a4',

  // Timeout for API requests in milliseconds
  apiTimeoutMs: parseInt(process.env.API_TIMEOUT_MS || '12000', 10),

  // Daily alert notification cron schedule (Default: 08:00 AM Iran Time / 04:30 UTC)
  notificationCron: process.env.NOTIFICATION_CRON || '30 4 * * *',

  // Admin Telegram User IDs (comma-separated)
  adminIds: (process.env.ADMIN_IDS || '7250238664').split(',').map(s => s.trim()).filter(Boolean),

  // Database storage file path
  dbFilePath: process.env.DB_FILE_PATH || './data/database.json',

  // Webhook settings (optional, for production webhooks)
  useWebhook: process.env.USE_WEBHOOK === 'true',
  webhookDomain: process.env.WEBHOOK_DOMAIN || '',
  webhookPort: parseInt(process.env.PORT || '3000', 10),
  webhookSecret: process.env.WEBHOOK_SECRET || '',
};
