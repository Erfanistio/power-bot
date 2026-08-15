import { Bot } from 'grammy';
import { config } from './config.js';
import { registerBotHandlers } from './bot/handlers.js';
import { OutageNotificationService } from './services/notifier.js';

async function main() {
  console.log('⚡️ Starting GOPED Electricity Outage Telegram Bot...');

  if (!config.botToken) {
    console.error('❌ Error: BOT_TOKEN is not configured in .env file!');
    console.error('👉 Please create a .env file and set your Telegram Bot token from @BotFather:');
    console.error('   BOT_TOKEN=your_telegram_bot_token_here\n');
    process.exit(1);
  }

  const bot = new Bot(config.botToken);

  // Register command and callback handlers
  registerBotHandlers(bot);

  // Initialize and start background notification scheduler
  const notifier = new OutageNotificationService(bot);
  notifier.start();

  // Set bot commands menu for Telegram UI
  await bot.api.setMyCommands([
    { command: 'start', description: 'شروع و منوی اصلی' },
    { command: 'check', description: 'استعلام قطعی برق (مثال: /check 1234567890123)' },
    { command: 'bookmarks', description: 'لیست و مدیریت قبض‌های نشان‌شده' },
    { command: 'bookmark', description: 'افزودن شناسه قبض جدید' },
    { command: 'notice', description: 'آخرین اطلاعیه‌های شرکت توزیع' },
    { command: 'shout', description: 'ارسال پیام همگانی به همه کاربران (ادمین)' },
    { command: 'users', description: 'مشاهده آمار و لیست کاربران (ادمین)' },
    { command: 'help', description: 'راهنما' }
  ]).catch(err => {
    console.warn('⚠️ Warning: Failed to set bot commands on Telegram API:', err.message);
  });

  // Handle graceful shutdowns
  const shutdown = async () => {
    console.log('\n🛑 Shutting down bot...');
    notifier.stop();
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log('🚀 Bot is running and listening for Telegram updates...');
  await bot.start({
    onStart(botInfo) {
      console.log(`🤖 Bot @${botInfo.username} (${botInfo.first_name}) started successfully!`);
    }
  });
}

main().catch(err => {
  console.error('Fatal error running bot:', err);
  process.exit(1);
});
