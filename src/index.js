import http from 'http';
import { Bot } from 'grammy';
import { config } from './config.js';
import { db } from './db/database.js';
import { registerBotHandlers } from './bot/handlers.js';
import { OutageNotificationService } from './services/notifier.js';

async function main() {
  console.log('⚡️ Starting GOPED Electricity Outage Telegram Bot on Railway/Node.js...');

  if (!config.botToken) {
    console.error('❌ Error: BOT_TOKEN is not configured in environment variables!');
    console.error('👉 Please configure BOT_TOKEN in Railway Variables or .env file:');
    console.error('   BOT_TOKEN=your_telegram_bot_token_here\n');
    process.exit(1);
  }

  // 1. Start lightweight HTTP server for Railway health checks & monitoring
  const port = parseInt(process.env.PORT || config.webhookPort || '3000', 10);
  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS & JSON headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (url.pathname === '/' || url.pathname === '/health') {
      const stats = db.getStats();
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'online',
        service: 'GOPED Electricity Outage Telegram Bot',
        platform: 'Railway / Node.js',
        uptimeSeconds: Math.floor(process.uptime()),
        stats,
        timestamp: new Date().toISOString()
      }, null, 2));
      return;
    }

    if (url.pathname === '/stats') {
      res.writeHead(200);
      res.end(JSON.stringify(db.getStats(), null, 2));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  httpServer.listen(port, () => {
    console.log(`🌐 HTTP Healthcheck server listening on port ${port} (Railway ready)`);
  });

  // 2. Initialize Telegram Bot
  const bot = new Bot(config.botToken);

  // Global error handler
  bot.catch((err) => {
    console.error('[Bot Error]:', err.error || err);
  });

  // 3. Clear any existing webhook (e.g. Cloudflare Worker webhook) before starting long polling
  try {
    console.log('🧹 Checking and clearing any previous Telegram Webhooks...');
    const delRes = await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Telegram Webhook cleared successfully:', delRes);
  } catch (whErr) {
    console.warn('⚠️ Webhook delete note:', whErr.message);
  }

  // 4. Initialize and start background notification scheduler
  const notifier = new OutageNotificationService(bot);
  notifier.start();

  // 5. Register command and callback handlers
  registerBotHandlers(bot, notifier);

  // 6. Set bot commands menu for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'شروع و منوی اصلی' },
    { command: 'check', description: 'استعلام قطعی برق (مثال: /check 1234567890123)' },
    { command: 'bookmarks', description: 'لیست و مدیریت قبض‌های نشان‌شده' },
    { command: 'bookmark', description: 'افزودن شناسه قبض جدید' },
    { command: 'notice', description: 'آخرین اطلاعیه‌های شرکت توزیع' },
    { command: 'shout', description: 'ارسال پیام همگانی به همه کاربران (ادمین)' },
    { command: 'users', description: 'مشاهده آمار و لیست کاربران (ادمین)' },
    { command: 'testnotif', description: 'تست ارسال هشدار روزانه (ادمین)' },
    { command: 'help', description: 'راهنما' }
  ]).catch(err => {
    console.warn('⚠️ Warning: Failed to set bot commands on Telegram API:', err.message);
  });

  // 7. Handle graceful shutdowns
  const shutdown = async () => {
    console.log('\n🛑 Shutting down bot...');
    notifier.stop();
    httpServer.close();
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // 8. Start polling for updates
  console.log('🚀 Bot is running and listening for Telegram updates...');
  await bot.start({
    drop_pending_updates: true,
    onStart(botInfo) {
      console.log(`🤖 Bot @${botInfo.username} (${botInfo.first_name}) started successfully!`);
    }
  });
}

main().catch(err => {
  console.error('Fatal error running bot:', err);
  process.exit(1);
});
