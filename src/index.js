import http from 'http';
import { Bot } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
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
        platform: 'Railway / Node.js (Concurrent Runner)',
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

    if (url.pathname === '/test-schedule') {
      const billId = url.searchParams.get('billId') || '6357330214322';
      import('./api/gopedApi.js').then(async ({ gopedApi }) => {
        try {
          const data = await gopedApi.getSchedule(billId, true);
          res.writeHead(200);
          res.end(JSON.stringify(data, null, 2));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message, stack: e.stack }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🌐 HTTP Healthcheck server listening on 0.0.0.0:${port} (Railway ready)`);
  });

  // 2. Initialize Telegram Bot
  const bot = new Bot(config.botToken);

  // Global error handler
  bot.catch((err) => {
    console.error('[Bot Error]:', err.error || err);
  });

  // 3. User-level sequentialization: guarantees sequential message order for individual chats,
  // while allowing 100% PARALLEL execution for all different users!
  bot.use(sequentialize((ctx) => {
    return ctx.chat?.id ? [ctx.chat.id.toString()] : undefined;
  }));

  // 4. Clear any existing webhook before starting long polling runner
  try {
    console.log('🧹 Checking and clearing any previous Telegram Webhooks...');
    const delRes = await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Telegram Webhook cleared successfully:', delRes);
  } catch (whErr) {
    console.warn('⚠️ Webhook delete note:', whErr.message);
  }

  // 5. Initialize and start background notification scheduler
  const notifier = new OutageNotificationService(bot);
  notifier.start();

  // 6. Register command and callback handlers
  registerBotHandlers(bot, notifier);

  // 7. Set bot commands menu for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'شروع و منوی اصلی' },
    { command: 'check', description: 'استعلام قطعی برق (مثال: /check 1234567890123)' },
    { command: 'setbill', description: 'تنظیم شناسه قبض برای گروه یا حساب شما' },
    { command: 'today', description: 'برنامه قطعی برق امروز' },
    { command: 'tomorrow', description: 'برنامه قطعی برق فردا' },
    { command: 'groupinfo', description: 'مشاهده مشخصات و وضعیت هشدار گروه' },
    { command: 'notif', description: 'فعال/غیرفعال‌سازی هشدار روزانه' },
    { command: 'bookmarks', description: 'لیست و مدیریت قبض‌های نشان‌شده' },
    { command: 'notice', description: 'آخرین اطلاعیه‌های شرکت توزیع' },
    { command: 'help', description: 'راهنما' }
  ]).catch(err => {
    console.warn('⚠️ Warning: Failed to set bot commands on Telegram API:', err.message);
  });

  // 8. Initialize bot metadata
  await bot.init();

  // 9. Start concurrent multi-threaded runner (up to 50 parallel updates)
  console.log('🚀 Starting concurrent update runner (no user blocks another)...');
  const runner = run(bot, {
    runner: {
      maxConcurrency: 50
    }
  });

  console.log(`🤖 Bot @${bot.botInfo.username} (${bot.botInfo.first_name}) is running concurrently!`);

  // 10. Handle graceful shutdowns
  const shutdown = async () => {
    console.log('\n🛑 Shutting down bot...');
    notifier.stop();
    httpServer.close();
    if (runner && runner.isRunning()) {
      await runner.stop();
    }
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error running bot:', err);
  process.exit(1);
});
