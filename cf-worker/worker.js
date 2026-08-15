/**
 * Cloudflare Worker for Golestan Electricity Outage Telegram Bot
 * Runs 100% serverless on Cloudflare Workers.
 */
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from 'grammy';

const GOPED_API_URL = 'https://modiriattolid.goped.ir:8090/';
const GOPED_AUTH_TOKEN = '7f3c2a91-6d84-4b17-a5e9-2c0f8d6b31a4';

// Helper: Persian number converter
function toEnglishDigits(str) {
  if (!str) return '';
  const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const a = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let res = String(str);
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(p[i], i.toString()).replaceAll(a[i], i.toString());
  }
  return res;
}

function toPersianDigits(str) {
  if (str === null || str === undefined) return '';
  const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(str).replace(/\d/g, d => p[parseInt(d, 10)]);
}

function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return timeStr;
}

function parseDateInfo(dateStr) {
  if (!dateStr) return { jalaliStr: '', weekday: '', gregorianStr: '' };
  const cleaned = toEnglishDigits(String(dateStr)).trim().split('T')[0].split(' ')[0];
  const parts = cleaned.replace(/[-.]/g, '/').split('/');
  
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);

    if (y > 1800) {
      const gDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const jFormatter = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const wFormatter = new Intl.DateTimeFormat('fa-IR', {
        timeZone: 'Asia/Tehran',
        weekday: 'long'
      });
      return {
        jalaliStr: jFormatter.format(gDate),
        weekday: wFormatter.format(gDate),
        gregorianStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      };
    } else {
      return {
        jalaliStr: `${String(y).padStart(4, '0')}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
        weekday: '',
        gregorianStr: ''
      };
    }
  }

  return { jalaliStr: cleaned, weekday: '', gregorianStr: cleaned };
}

function getIranGregorianDate(offsetDays = 0) {
  const now = new Date();
  const d = new Date(now.getTime() + (offsetDays * 24 * 60 * 60 * 1000));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d).split('-');
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

async function fetchGopedSchedule(billId) {
  const cleanId = toEnglishDigits(billId).replace(/\D/g, '');
  const url = `${GOPED_API_URL}Api/GetSchedule_Web?BillId=${encodeURIComponent(cleanId)}`;
  const res = await fetch(url, {
    headers: {
      'Auth-Token': GOPED_AUTH_TOKEN,
      'User-Agent': 'Mozilla/5.0 (CF-Worker; PowerBot)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchGopedNotice() {
  const url = `${GOPED_API_URL}Api/GetNotice`;
  const res = await fetch(url, {
    headers: {
      'Auth-Token': GOPED_AUTH_TOKEN,
      'User-Agent': 'Mozilla/5.0 (CF-Worker; PowerBot)',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function formatSchedule(data, mode = 'all') {
  if (data.Code !== 1 || !data.Result) {
    return `❌ ${data.Description || 'شناسه قبض یافت نشد یا برنامه‌ای ثبت نشده است.'}`;
  }

  const customer = data.Result.Customer || {};
  const blackouts = data.Result.Blackouts || [];
  const todayGregorian = getIranGregorianDate(0);
  const tomorrowGregorian = getIranGregorianDate(1);
  const todayInfo = parseDateInfo(todayGregorian);
  const tomorrowInfo = parseDateInfo(tomorrowGregorian);

  let header = `⚡️ <b>برنامه خاموشی برق گلستان</b>\n`;
  if (customer.BillId) header += `📄 <b>شناسه قبض:</b> <code>${toPersianDigits(customer.BillId)}</code>\n`;
  if (customer.Name) header += `👤 <b>مشترک:</b> ${customer.Name}\n`;
  if (customer.DistributionTitle) header += `📍 <b>منطقه:</b> ${customer.DistributionTitle}\n`;
  header += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  const matchesDate = (bDate, targetG) => {
    const info = parseDateInfo(bDate);
    return info.gregorianStr === targetG;
  };

  if (mode === 'today') {
    const todayBlackouts = blackouts.filter(b => matchesDate(b.Date || b.date, todayGregorian));
    let body = `📅 <b>برنامه خاموشی امروز (${todayInfo.weekday} - ${toPersianDigits(todayInfo.jalaliStr)}):</b>\n\n`;
    if (todayBlackouts.length === 0) {
      body += `🟢 <b>خوشبختانه برای امروز هیچ قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      todayBlackouts.forEach(b => {
        body += `⚡️ <b>تاریخ:</b> ${toPersianDigits(todayInfo.jalaliStr)} 🔴 [امروز]\n`;
        if (b.From && b.To) body += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(formatTimeShort(b.From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.To))}</code>\n`;
        if (b.Reserve1From && b.Reserve1To) body += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(formatTimeShort(b.Reserve1From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.Reserve1To))}</code>\n`;
        body += '\n';
      });
    }
    return header + body;
  }

  if (mode === 'tomorrow') {
    const tomorrowBlackouts = blackouts.filter(b => matchesDate(b.Date || b.date, tomorrowGregorian));
    let body = `📅 <b>برنامه خاموشی فردا (${tomorrowInfo.weekday} - ${toPersianDigits(tomorrowInfo.jalaliStr)}):</b>\n\n`;
    if (tomorrowBlackouts.length === 0) {
      body += `🟢 <b>برای فردا قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      tomorrowBlackouts.forEach(b => {
        body += `⚡️ <b>تاریخ:</b> ${toPersianDigits(tomorrowInfo.jalaliStr)} 🟡 [فردا]\n`;
        if (b.From && b.To) body += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(formatTimeShort(b.From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.To))}</code>\n`;
        if (b.Reserve1From && b.Reserve1To) body += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(formatTimeShort(b.Reserve1From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.Reserve1To))}</code>\n`;
        body += '\n';
      });
    }
    return header + body;
  }

  // All mode
  if (blackouts.length === 0) {
    return header + `🟢 در حال حاضر هیچ جدول خاموشی فعالی برای این شناسه در سامانه ثبت نشده است.\n`;
  }

  let body = `📋 <b>جدول کامل زمان‌بندی خاموشی:</b>\n\n`;
  blackouts.forEach(b => {
    const info = parseDateInfo(b.Date || b.date);
    const isToday = info.gregorianStr === todayGregorian;
    const isTomorrow = info.gregorianStr === tomorrowGregorian;

    let tag = '';
    if (isToday) tag = ' 🔴 [امروز]';
    else if (isTomorrow) tag = ' 🟡 [فردا]';

    const weekday = info.weekday ? ` (${info.weekday})` : '';
    body += `📅 <b>تاریخ:</b> ${toPersianDigits(info.jalaliStr || b.Date)}${weekday}${tag}\n`;

    if (b.From && b.To) {
      body += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(formatTimeShort(b.From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.To))}</code>\n`;
    }
    if (b.Reserve1From && b.Reserve1To) {
      body += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(formatTimeShort(b.Reserve1From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.Reserve1To))}</code>\n`;
    }
    body += '\n';
  });

  return header + body + `<i>ℹ️ منبع: سامانه شرکت توزیع نیروی برق استان گلستان</i>`;
}

function getReplyKeyboard() {
  return new Keyboard()
    .text('⚡️ خاموشی امروز').text('🗓 خاموشی فردا')
    .row()
    .text('📋 کل برنامه هفتگی').text('📢 اطلاعیه‌ها')
    .row()
    .text('ℹ️ راهنما')
    .resized();
}

function getInlineButtons(billId, mode = 'all') {
  const kb = new InlineKeyboard();
  if (mode !== 'today') kb.text('⚡️ امروز', `cf:today:${billId}`);
  if (mode !== 'tomorrow') kb.text('🗓 فردا', `cf:tom:${billId}`);
  if (mode !== 'all') kb.text('📋 کل جدول', `cf:all:${billId}`);
  kb.row().text('🔄 بروزرسانی', `cf:${mode}:${billId}`);
  return kb;
}

export default {
  async fetch(request, env) {
    const token = env.BOT_TOKEN || '8931573991:AAEFAPuyGHGvKi8okFQFCKuHRUGqw6_fRDY';
    const bot = new Bot(token);

    bot.command('start', async (ctx) => {
      await ctx.reply(
        `سلام ${ctx.from.first_name || ''}! 👋\nبه بات استعلام خاموشی برق گلستان خوش آمدید. ⚡️\n\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال فرمایید:`,
        { parse_mode: 'HTML', reply_markup: getReplyKeyboard() }
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(
        `📖 <b>راهنمای ربات:</b>\n\nبرای استعلام، شناسه قبض ۱۳ رقمی خود را ارسال کنید.`,
        { parse_mode: 'HTML', reply_markup: getReplyKeyboard() }
      );
    });

    bot.command('notice', async (ctx) => {
      try {
        const notice = await fetchGopedNotice();
        const text = (notice.Result || '').replace(/<[^>]+>/g, '').trim();
        await ctx.reply(`📢 <b>اطلاعیه شرکت توزیع برق:</b>\n\n${text || 'اطلاعیه‌ای وجود ندارد.'}`, {
          parse_mode: 'HTML',
          reply_markup: getReplyKeyboard()
        });
      } catch (err) {
        await ctx.reply(`❌ خطا در دریافت اطلاعیه: ${err.message}`);
      }
    });

    bot.command('check', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/).slice(1);
      if (parts.length === 0) {
        await ctx.reply('لطفاً شناسه قبض را به همراه دستور ارسال کنید: <code>/check 1234567890123</code>', { parse_mode: 'HTML' });
        return;
      }
      const digits = toEnglishDigits(parts[0]).replace(/\D/g, '');
      const data = await fetchGopedSchedule(digits);
      const formatted = formatSchedule(data, 'all');
      await ctx.reply(formatted, { parse_mode: 'HTML', reply_markup: getInlineButtons(digits, 'all') });
    });

    bot.hears('📢 اطلاعیه‌ها', async (ctx) => {
      try {
        const notice = await fetchGopedNotice();
        const text = (notice.Result || '').replace(/<[^>]+>/g, '').trim();
        await ctx.reply(`📢 <b>اطلاعیه شرکت توزیع برق:</b>\n\n${text || 'اطلاعیه‌ای وجود ندارد.'}`, {
          parse_mode: 'HTML',
          reply_markup: getReplyKeyboard()
        });
      } catch (err) {
        await ctx.reply(`❌ خطا در دریافت اطلاعیه: ${err.message}`);
      }
    });

    bot.hears('ℹ️ راهنما', async (ctx) => {
      await ctx.reply(`⚡️ برای استعلام، کافیست شناسه قبض ۱۳ رقمی خود را بفرستید.`, { reply_markup: getReplyKeyboard() });
    });

    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery().catch(() => {});
      if (data.startsWith('cf:')) {
        const [, mode, billId] = data.split(':');
        const sched = await fetchGopedSchedule(billId);
        const text = formatSchedule(sched, mode === 'tom' ? 'tomorrow' : mode);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: getInlineButtons(billId, mode === 'tom' ? 'tomorrow' : mode)
        }).catch(async () => {
          await ctx.reply(text, { parse_mode: 'HTML', reply_markup: getInlineButtons(billId, mode === 'tom' ? 'tomorrow' : mode) });
        });
      }
    });

    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      const digits = toEnglishDigits(text).replace(/\D/g, '');

      if (digits.length >= 8 && digits.length <= 15) {
        try {
          const data = await fetchGopedSchedule(digits);
          const formatted = formatSchedule(data, 'all');
          await ctx.reply(formatted, {
            parse_mode: 'HTML',
            reply_markup: getInlineButtons(digits, 'all')
          });
        } catch (err) {
          await ctx.reply(`❌ خطا در دریافت اطلاعات از سامانه برق: ${err.message}`);
        }
      } else {
        await ctx.reply('لطفاً یک شناسه قبض معتبر ارسال فرمایید.', { reply_markup: getReplyKeyboard() });
      }
    });

    return webhookCallback(bot, 'cloudflare-mod')(request);
  }
};
