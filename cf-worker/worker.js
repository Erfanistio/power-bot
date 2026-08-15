/**
 * Cloudflare Worker for Golestan Electricity Outage Telegram Bot
 * Runs 100% serverless on Cloudflare Workers.
 */
import { Bot, webhookCallback } from 'grammy';

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

function formatSchedule(data) {
  if (data.Code !== 1 || !data.Result) {
    return `❌ ${data.Description || 'شناسه قبض یافت نشد یا برنامه‌ای ثبت نشده است.'}`;
  }

  const customer = data.Result.Customer || {};
  const blackouts = data.Result.Blackouts || [];
  const todayGregorian = getIranGregorianDate(0);
  const tomorrowGregorian = getIranGregorianDate(1);

  let msg = `⚡️ <b>برنامه خاموشی برق گلستان</b>\n`;
  if (customer.BillId) msg += `📄 <b>شناسه قبض:</b> <code>${toPersianDigits(customer.BillId)}</code>\n`;
  if (customer.Name) msg += `👤 <b>مشترک:</b> ${customer.Name}\n`;
  if (customer.DistributionTitle) msg += `📍 <b>منطقه:</b> ${customer.DistributionTitle}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (blackouts.length === 0) {
    msg += `🟢 در حال حاضر جدول خاموشی فعالی برای این شناسه ثبت نشده است.\n`;
  } else {
    msg += `📋 <b>جدول کامل زمان‌بندی خاموشی:</b>\n\n`;
    blackouts.forEach(b => {
      const info = parseDateInfo(b.Date || b.date);
      const isToday = info.gregorianStr === todayGregorian;
      const isTomorrow = info.gregorianStr === tomorrowGregorian;

      let tag = '';
      if (isToday) tag = ' 🔴 [امروز]';
      else if (isTomorrow) tag = ' 🟡 [فردا]';

      const weekday = info.weekday ? ` (${info.weekday})` : '';
      msg += `📅 <b>تاریخ:</b> ${toPersianDigits(info.jalaliStr || b.Date)}${weekday}${tag}\n`;

      if (b.From && b.To) {
        msg += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(formatTimeShort(b.From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.To))}</code>\n`;
      }
      if (b.Reserve1From && b.Reserve1To) {
        msg += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(formatTimeShort(b.Reserve1From))}</code> تا <code>${toPersianDigits(formatTimeShort(b.Reserve1To))}</code>\n`;
      }
      msg += '\n';
    });
  }

  return msg;
}

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response('BOT_TOKEN is not configured', { status: 500 });
    }

    const bot = new Bot(env.BOT_TOKEN);

    bot.command('start', async (ctx) => {
      await ctx.reply(
        `سلام! 👋\nبه بات استعلام خاموشی برق گلستان خوش آمدید. ⚡️\n\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال فرمایید:`,
        { parse_mode: 'HTML' }
      );
    });

    bot.command('notice', async (ctx) => {
      try {
        const notice = await fetchGopedNotice();
        const text = (notice.Result || '').replace(/<[^>]+>/g, '').trim();
        await ctx.reply(`📢 <b>اطلاعیه شرکت توزیع برق:</b>\n\n${text || 'اطلاعیه‌ای وجود ندارد.'}`, { parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`❌ خطا در دریافت اطلاعیه: ${err.message}`);
      }
    });

    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      const digits = toEnglishDigits(text).replace(/\D/g, '');

      if (digits.length >= 8 && digits.length <= 15) {
        try {
          const data = await fetchGopedSchedule(digits);
          const formatted = formatSchedule(data);
          await ctx.reply(formatted, { parse_mode: 'HTML' });
        } catch (err) {
          await ctx.reply(`❌ خطا در دریافت اطلاعات از سامانه برق: ${err.message}`);
        }
      } else {
        await ctx.reply('لطفاً یک شناسه قبض معتبر ارسال فرمایید.');
      }
    });

    return webhookCallback(bot, 'cloudflare-mod')(request);
  }
};
