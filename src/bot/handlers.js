import { gopedApi } from '../api/gopedApi.js';
import { db } from '../db/database.js';
import {
  formatScheduleMessage,
  formatNoticeMessage,
  formatWelcomeMessage,
  formatSavedBillsList
} from './formatters.js';
import {
  getMainReplyKeyboard,
  getScheduleInlineKeyboard,
  getSavedBillsInlineKeyboard,
  getDeleteBillsInlineKeyboard,
  getRenameBillsInlineKeyboard,
  getNotificationSettingsKeyboard
} from './keyboards.js';
import { config } from '../config.js';
import { toEnglishDigits, toPersianDigits, parseDateInfo } from '../utils/persianDate.js';

// In-memory conversation state for step-by-step inputs (e.g. adding a bill with label)
const userStates = new Map();

/**
 * Checks if a Telegram user is an authorized bot admin.
 */
function isUserAdmin(userId) {
  const idStr = String(userId);
  if (config.adminIds && config.adminIds.length > 0) {
    return config.adminIds.includes(idStr);
  }
  return false;
}

/**
 * Registers all Telegram bot handlers and callbacks.
 * @param {import('grammy').Bot} bot
 */
export function registerBotHandlers(bot) {
  // Save user profile info in database on any update
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      const user = db.getUser(ctx.from.id);
      if (ctx.from.username) user.username = ctx.from.username;
      if (ctx.from.first_name) user.firstName = ctx.from.first_name;
    }
    await next();
  });

  // /start command
  bot.command('start', async (ctx) => {
    userStates.delete(ctx.from.id);
    const user = db.getUser(ctx.from.id);
    const welcome = formatWelcomeMessage(ctx.from.first_name);
    await ctx.reply(welcome, {
      parse_mode: 'HTML',
      reply_markup: getMainReplyKeyboard(user.savedBills)
    });
  });

  // /help command
  bot.command('help', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    const helpText = `📖 <b>راهنمای استفاده از ربات خاموشی برق گلستان:</b>\n\n` +
      `1️⃣ <b>استعلام سریع:</b> شناسه قبض ۱۳ رقمی خود را مستقیم بفرستید.\n` +
      `2️⃣ <b>نشان کردن (Bookmark):</b> شناسه‌های خود را با نام دلخواه (مثلاً: <code>/bookmark 1234567890123 خونه</code>) نشان کنید تا همیشه روی کیبورد در دسترس باشند.\n` +
      `3️⃣ <b>مدیریت نشان‌ها:</b> با زدن دکمه 🔖 نشان‌شده‌های من یا دستور <code>/bookmarks</code> نشان‌های خود را تغییر نام داده یا حذف کنید.\n` +
      `4️⃣ <b>هشدار روزانه:</b> با فعال بودن هشدار، هر روز صبح در صورت وجود قطعی برق، پیام هشدار دریافت خواهید کرد.\n` +
      `5️⃣ <b>اطلاعیه‌ها:</b> مشاهده آخرین اخبار و اطلاعیه‌های رسمی شرکت توزیع با دکمه 📢 اطلاعیه‌ها.`;
    await ctx.reply(helpText, {
      parse_mode: 'HTML',
      reply_markup: getMainReplyKeyboard(user.savedBills)
    });
  });

  // /notice command
  bot.command('notice', async (ctx) => {
    await handleNoticeQuery(ctx);
  });

  // /bookmarks and /bills command
  bot.command(['bookmarks', 'bills', 'saved'], async (ctx) => {
    await handleSavedBillsQuery(ctx);
  });

  // /bookmark, /add, /save command: /bookmark <billId> [label]
  bot.command(['bookmark', 'save', 'add'], async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);
    if (parts.length === 0) {
      userStates.set(ctx.from.id, { step: 'awaiting_bill_id' });
      await ctx.reply('لطفاً شناسه قبض ۱۳ رقمی را ارسال کنید:');
      return;
    }

    const rawBillId = parts[0];
    const label = parts.slice(1).join(' ') || '';
    const billId = toEnglishDigits(rawBillId).replace(/\D/g, '');

    if (billId.length < 8 || billId.length > 15) {
      await ctx.reply('❌ شناسه قبض باید بین ۸ تا ۱۵ رقم باشد.');
      return;
    }

    const res = db.addBillId(ctx.from.id, billId, label);
    const user = db.getUser(ctx.from.id);
    await ctx.reply(
      `🔖 شناسه قبض <code>${toPersianDigits(billId)}</code> با عنوان <b>${res.label}</b> به نشان‌شده‌ها اضافه شد و به کیبورد شما افزوده شد!`,
      { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(user.savedBills) }
    );
    await handleScheduleQuery(ctx, billId, 'all');
  });

  // /check command: /check <billId>
  bot.command('check', async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('لطفاً شناسه قبض را به همراه دستور ارسال کنید. مثال:\n<code>/check 1234567890123</code>', { parse_mode: 'HTML' });
      return;
    }
    const billId = toEnglishDigits(parts[0]).replace(/\D/g, '');
    await handleScheduleQuery(ctx, billId, 'all');
  });

  // ================= ADMIN COMMANDS =================

  // /users and /stats admin command
  bot.command(['users', 'userlist', 'stats', 'admin'], async (ctx) => {
    if (!isUserAdmin(ctx.from.id)) {
      await ctx.reply('⛔️ شما دسترسی مدیریت برای اجرای این دستور را ندارید.');
      return;
    }

    const stats = db.getStats();
    const allUsers = db.getAllUsers();

    let text = `📊 <b>آمار و گزارش کاربران ربات:</b>\n\n` +
      `👥 <b>تعداد کل کاربران:</b> <code>${toPersianDigits(stats.totalUsers)}</code>\n` +
      `🔖 <b>تعداد کل نشان‌ها:</b> <code>${toPersianDigits(stats.totalSavedBills)}</code>\n` +
      `🔔 <b>کاربران با هشدار فعال:</b> <code>${toPersianDigits(stats.subscribedUsers)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 <b>لیست کاربران استارت‌زده:</b>\n\n`;

    allUsers.slice(0, 30).forEach((u, idx) => {
      const name = u.firstName || 'بی‌نام';
      const username = u.username ? `@${u.username}` : 'ندارد';
      const billsCount = u.savedBills ? u.savedBills.length : 0;
      const notifStatus = u.notifications?.enabled ? '🔔' : '🔕';
      const joinDate = u.createdAt ? parseDateInfo(u.createdAt).jalaliStr : '-';

      text += `${toPersianDigits(idx + 1)}. <b>${name}</b> (${username})\n` +
        `   🆔 <code>${u.userId}</code> | 🔖 ${toPersianDigits(billsCount)} نشان | ${notifStatus}\n` +
        `   📅 عضویت: ${toPersianDigits(joinDate)}\n\n`;
    });

    if (allUsers.length > 30) {
      text += `<i>... و ${toPersianDigits(allUsers.length - 30)} کاربر دیگر</i>\n`;
    }

    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /shout and /broadcast admin command
  bot.command(['shout', 'broadcast', 'announce'], async (ctx) => {
    if (!isUserAdmin(ctx.from.id)) {
      await ctx.reply('⛔️ شما دسترسی مدیریت برای اجرای این دستور را ندارید.');
      return;
    }

    const replyMsg = ctx.message.reply_to_message;
    const textArg = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();

    if (!replyMsg && !textArg) {
      await ctx.reply(
        `📢 <b>راهنمای ارسال همگانی (Shout):</b>\n\n` +
        `• <b>روش اول:</b> دستور را همراه با متن پیام ارسال کنید:\n` +
        `<code>/shout متن پیام شما به تمامی کاربران...</code>\n\n` +
        `• <b>روش دوم:</b> روی یک پیام (عکس، متن، ویدیو، ویس، فایل) ریپلای کرده و بنویسید <code>/shout</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const allUsers = db.getAllUsers();
    const realUsers = allUsers.filter(u => u.userId !== '999888777');
    const totalUsers = realUsers.length;

    const statusMsg = await ctx.reply(`🚀 در حال ارسال پیام به <b>${toPersianDigits(totalUsers)}</b> کاربر...`, {
      parse_mode: 'HTML'
    });

    let successCount = 0;
    let blockedCount = 0;
    let failedCount = 0;
    const startTime = Date.now();

    for (const u of realUsers) {
      try {
        if (replyMsg) {
          await ctx.api.copyMessage(u.userId, ctx.chat.id, replyMsg.message_id);
        } else {
          await ctx.api.sendMessage(u.userId, textArg, { parse_mode: 'HTML' });
        }
        successCount++;
      } catch (err) {
        if (err.description && (err.description.includes('bot was blocked') || err.description.includes('user is deactivated') || err.description.includes('chat not found'))) {
          blockedCount++;
        } else {
          failedCount++;
        }
      }

      // Delay between sends to avoid hitting Telegram flood limits (30 msgs/sec max)
      await new Promise(r => setTimeout(r, 45));
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    const report = `📢 <b>گزارش ارسال همگانی (Shout):</b>\n\n` +
      `👥 <b>کل مخاطبان:</b> <code>${toPersianDigits(totalUsers)}</code>\n` +
      `✅ <b>ارسال موفق:</b> <code>${toPersianDigits(successCount)}</code>\n` +
      `🚫 <b>بلاک / غیرفعال:</b> <code>${toPersianDigits(blockedCount)}</code>\n` +
      `❌ <b>خطاهای دیگر:</b> <code>${toPersianDigits(failedCount)}</code>\n` +
      `⏱ <b>مدت زمان:</b> <code>${toPersianDigits(durationSec)}</code> ثانیه`;

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, report, {
      parse_mode: 'HTML'
    }).catch(async () => {
      await ctx.reply(report, { parse_mode: 'HTML' });
    });
  });

  // Handle Main Menu Button Texts
  bot.hears('⚡️ خاموشی امروز', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user.activeBillId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await handleScheduleQuery(ctx, user.activeBillId, 'today');
  });

  bot.hears('🗓 خاموشی فردا', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user.activeBillId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await handleScheduleQuery(ctx, user.activeBillId, 'tomorrow');
  });

  bot.hears('📋 کل برنامه هفتگی', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user.activeBillId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await handleScheduleQuery(ctx, user.activeBillId, 'all');
  });

  bot.hears(['🔖 نشان‌شده‌های من', '📂 شناسه‌های من'], async (ctx) => {
    await handleSavedBillsQuery(ctx);
  });

  bot.hears(['➕ افزودن نشان جدید', '➕ افزودن شناسه جدید'], async (ctx) => {
    userStates.set(ctx.from.id, { step: 'awaiting_bill_id' });
    await ctx.reply('لطفاً شناسه قبض ۱۳ رقمی را ارسال فرمایید:');
  });

  bot.hears('🔔 هشدار خودکار', async (ctx) => {
    await handleNotificationSettings(ctx);
  });

  bot.hears('📢 اطلاعیه‌ها', async (ctx) => {
    await handleNoticeQuery(ctx);
  });

  bot.hears('ℹ️ راهنما', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    const helpText = `📖 <b>راهنمای ربات:</b>\n\n` +
      `⚡️ این ربات اطلاعات خاموشی را مستقیماً از سامانه رسمی شرکت توزیع نیروی برق استان گلستان (goped.ir) دریافت می‌کند.\n\n` +
      `• برای استعلام، کافیست شناسه قبض خود را بنویسید و بفرستید.\n` +
      `• می‌توانید چندین شناسه قبض (مثلاً خانه، مغازه، کارگاه) را نشان (Bookmark) کنید.\n` +
      `• با فعال بودن هشدار روزانه، هر روز صبح در صورت خاموشی احتمالی، پیام یادآوری دریافت خواهید کرد.`;
    await ctx.reply(helpText, { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(user.savedBills) });
  });

  // Handle Freeform Text (Bill IDs, Bookmark button clicks, States, etc.)
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const state = userStates.get(userId);

    // If user clicked on a dynamic bookmark button (e.g. "🔖 خونه" or "🔖 مغازه")
    if (user.savedBills && user.savedBills.length > 0) {
      const cleanText = text.replace(/^🔖\s*/, '').trim();
      const matchedBookmark = user.savedBills.find(
        b => b.label === cleanText || `🔖 ${b.label}` === text || b.billId === cleanText
      );
      if (matchedBookmark) {
        db.setActiveBillId(userId, matchedBookmark.billId);
        await handleScheduleQuery(ctx, matchedBookmark.billId, 'all');
        return;
      }
    }

    // If user is in a multi-step conversation
    if (state) {
      if (state.step === 'awaiting_bill_id') {
        const billId = toEnglishDigits(text).replace(/\D/g, '');
        if (billId.length < 8 || billId.length > 15) {
          await ctx.reply('❌ شناسه قبض نامعتبر است. لطفاً شناسه قبض معتبر ارسال کنید:');
          return;
        }
        userStates.set(userId, { step: 'awaiting_label', billId });
        await ctx.reply(`برای شناسه <code>${toPersianDigits(billId)}</code> یک عنوان برای نشان بنویسید (مثلاً: 🏠 خانه):`, {
          parse_mode: 'HTML'
        });
        return;
      }

      if (state.step === 'awaiting_label') {
        const billId = state.billId;
        const label = text;
        userStates.delete(userId);
        db.addBillId(userId, billId, label);
        const updatedUser = db.getUser(userId);
        await ctx.reply(
          `🔖 شناسه <code>${toPersianDigits(billId)}</code> با عنوان <b>${label}</b> با موفقیت نشان (Bookmark) شد و روی کیبورد شما قرار گرفت!`,
          { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(updatedUser.savedBills) }
        );
        // Immediately fetch full schedule
        await handleScheduleQuery(ctx, billId, 'all');
        return;
      }

      if (state.step === 'awaiting_custom_save_label') {
        const billId = state.billId;
        const label = text;
        userStates.delete(userId);
        db.addBillId(userId, billId, label);
        const updatedUser = db.getUser(userId);
        await ctx.reply(
          `🔖 شناسه <code>${toPersianDigits(billId)}</code> با عنوان <b>${label}</b> نشان شد!`,
          { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(updatedUser.savedBills) }
        );
        // Immediately fetch full schedule
        await handleScheduleQuery(ctx, billId, 'all');
        return;
      }

      if (state.step === 'awaiting_rename') {
        const billId = state.billId;
        const newLabel = text;
        userStates.delete(userId);
        db.renameBillId(userId, billId, newLabel);
        const updatedUser = db.getUser(userId);
        await ctx.reply(
          `✏️ نام نشان با موفقیت به <b>${newLabel}</b> تغییر یافت!`,
          { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(updatedUser.savedBills) }
        );
        await handleSavedBillsQuery(ctx);
        return;
      }
    }

    // Check if the text is or contains a Bill ID (8 to 15 digits)
    const englishDigitsOnly = toEnglishDigits(text).replace(/\D/g, '');
    if (englishDigitsOnly.length >= 8 && englishDigitsOnly.length <= 15) {
      await handleScheduleQuery(ctx, englishDigitsOnly, 'all');
      return;
    }

    // Fallback response
    await ctx.reply(
      '❓ متوجه دستور نشدم.\nبرای استعلام، لطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید یا از نشان‌های روی کیبورد انتخاب فرمایید.',
      { reply_markup: getMainReplyKeyboard(user.savedBills) }
    );
  });

  // Handle Callback Queries (Inline Button Clicks)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    await ctx.answerCallbackQuery().catch(() => {});

    // Schedule view mode change: sched:<mode>:<billId>
    if (data.startsWith('sched:')) {
      const [, mode, billId] = data.split(':');
      await handleScheduleQuery(ctx, billId, mode, true);
      return;
    }

    // Select active bill: select_bill:<billId>
    if (data.startsWith('select_bill:')) {
      const billId = data.replace('select_bill:', '');
      db.setActiveBillId(userId, billId);
      const user = db.getUser(userId);
      const active = user.savedBills.find(b => b.billId === billId);
      const label = active ? active.label : billId;
      await ctx.reply(`⭐️ نشان <b>${label}</b> انتخاب شد:`, {
        parse_mode: 'HTML',
        reply_markup: getMainReplyKeyboard(user.savedBills)
      });
      await handleScheduleQuery(ctx, billId, 'all');
      return;
    }

    // Save prompt for queried bill: save_prompt:<billId>
    if (data.startsWith('save_prompt:')) {
      const billId = data.replace('save_prompt:', '');
      userStates.set(userId, { step: 'awaiting_custom_save_label', billId });
      await ctx.reply(`🏷 برای نشان کردن شناسه <code>${toPersianDigits(billId)}</code> یک نام دلخواه بفرستید (مثلاً: 🏠 خانه یا 🏢 محل کار):`, {
        parse_mode: 'HTML'
      });
      return;
    }

    // Rename bookmark prompt: rename_prompt:<billId>
    if (data.startsWith('rename_prompt:')) {
      const billId = data.replace('rename_prompt:', '');
      userStates.set(userId, { step: 'awaiting_rename', billId });
      await ctx.reply(`✏️ لطفاً نام جدید را برای این نشان وارد نمایید:`);
      return;
    }

    // Rename bookmarks list menu
    if (data === 'rename_bill_menu') {
      const user = db.getUser(userId);
      if (user.savedBills.length === 0) {
        await ctx.reply('نشانی برای تغییر نام وجود ندارد.');
        return;
      }
      await ctx.editMessageText('✏️ نشان مورد نظر برای تغییر نام را انتخاب کنید:', {
        reply_markup: getRenameBillsInlineKeyboard(user.savedBills)
      }).catch(async () => {
        await ctx.reply('✏️ نشان مورد نظر برای تغییر نام را انتخاب کنید:', {
          reply_markup: getRenameBillsInlineKeyboard(user.savedBills)
        });
      });
      return;
    }

    // Add bill prompt
    if (data === 'add_bill_prompt') {
      userStates.set(userId, { step: 'awaiting_bill_id' });
      await ctx.reply('لطفاً شناسه قبض ۱۳ رقمی را ارسال فرمایید:');
      return;
    }

    // View saved bills menu
    if (data === 'view_saved_bills') {
      await handleSavedBillsQuery(ctx, true);
      return;
    }

    // Delete bill menu
    if (data === 'delete_bill_menu') {
      const user = db.getUser(userId);
      if (user.savedBills.length === 0) {
        await ctx.reply('نشانی برای حذف وجود ندارد.');
        return;
      }
      await ctx.editMessageText('🗑 نشان مورد نظر برای حذف را انتخاب کنید:', {
        reply_markup: getDeleteBillsInlineKeyboard(user.savedBills)
      }).catch(async () => {
        await ctx.reply('🗑 نشان مورد نظر برای حذف را انتخاب کنید:', {
          reply_markup: getDeleteBillsInlineKeyboard(user.savedBills)
        });
      });
      return;
    }

    // Execute delete bill: delete_bill_do:<billId>
    if (data.startsWith('delete_bill_do:')) {
      const billId = data.replace('delete_bill_do:', '');
      db.removeBillId(userId, billId);
      const user = db.getUser(userId);
      await ctx.reply(`🗑 شناسه قبض <code>${toPersianDigits(billId)}</code> از نشان‌شده‌ها حذف شد.`, {
        parse_mode: 'HTML',
        reply_markup: getMainReplyKeyboard(user.savedBills)
      });
      await handleSavedBillsQuery(ctx);
      return;
    }

    // Toggle notification preferences: toggle_notifications:<val>
    if (data.startsWith('toggle_notifications:')) {
      const enabled = data.split(':')[1] === '1';
      db.setNotifications(userId, enabled);
      const user = db.getUser(userId);
      const statusText = enabled ? '✅ اطلاع‌رسانی خودکار روزانه فعال شد.' : '🔕 اطلاع‌رسانی خودکار غیرفعال شد.';
      await ctx.reply(statusText, { reply_markup: getMainReplyKeyboard(user.savedBills) });
      return;
    }

    // Back to main
    if (data === 'back_to_main') {
      const user = db.getUser(userId);
      await ctx.reply('منوی اصلی:', { reply_markup: getMainReplyKeyboard(user.savedBills) });
      return;
    }
  });
}

/**
 * Executes a schedule lookup from GOPED API and updates or sends message.
 */
async function handleScheduleQuery(ctx, rawBillId, mode = 'all', isEdit = false) {
  const billId = toEnglishDigits(rawBillId).replace(/\D/g, '');
  const user = db.getUser(ctx.from.id);
  const savedItem = user.savedBills.find(b => b.billId === billId);
  const customLabel = savedItem ? savedItem.label : '';
  const isBookmarked = Boolean(savedItem);

  let loadingMsg = null;
  if (!isEdit) {
    loadingMsg = await ctx.reply('⏳ در حال دریافت برنامه خاموشی از سامانه برق گلستان...').catch(() => null);
  }

  try {
    const result = await gopedApi.getSchedule(billId);
    const text = formatScheduleMessage(result, mode, customLabel);
    const replyMarkup = result.success ? getScheduleInlineKeyboard(billId, mode, isBookmarked) : undefined;

    if (isEdit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      }).catch(async () => {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
      });
    } else {
      if (loadingMsg) {
        await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
      }
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }

    // If billId not already in user's saved list, update activeBillId
    if (result.success && !user.activeBillId) {
      db.addBillId(ctx.from.id, billId, 'قبض من');
    }
  } catch (err) {
    const errText = `❌ خطا در دریافت اطلاعات:\n${err.message}`;
    if (loadingMsg) {
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    }
    await ctx.reply(errText);
  }
}

/**
 * Handles official notice lookup.
 */
async function handleNoticeQuery(ctx) {
  const user = db.getUser(ctx.from.id);
  const loading = await ctx.reply('⏳ در حال دریافت آخرین اطلاعیه...').catch(() => null);
  try {
    const notice = await gopedApi.getNotice();
    const text = formatNoticeMessage(notice);
    if (loading) await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: getMainReplyKeyboard(user.savedBills) });
  } catch (err) {
    if (loading) await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('❌ خطا در دریافت اطلاعیه.');
  }
}

/**
 * Handles viewing saved bill list and management buttons.
 */
async function handleSavedBillsQuery(ctx, isEdit = false) {
  const user = db.getUser(ctx.from.id);
  const text = formatSavedBillsList(user.savedBills, user.activeBillId);
  const kb = getSavedBillsInlineKeyboard(user.savedBills, user.activeBillId);

  if (isEdit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

/**
 * Handles notification toggle menu.
 */
async function handleNotificationSettings(ctx) {
  const user = db.getUser(ctx.from.id);
  const isEnabled = user.notifications?.enabled !== false;
  const statusStr = isEnabled ? '🟢 فعال' : '🔴 غیرفعال';
  const text = `🔔 <b>تنظیمات هشدار خودکار روزانه:</b>\n\n` +
    `وضعیت فعلی: <b>${statusStr}</b>\n\n` +
    `در صورت فعال بودن، هر روز صبح (ساعت ۸:۰۰) در صورتی که قطعی برق برای نشان‌های شما برنامه‌ریزی شده باشد، پیام هشدار دریافت خواهید کرد.`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: getNotificationSettingsKeyboard(isEnabled)
  });
}
