import {
  toPersianDigits,
  parseDateInfo,
  getIranGregorianDate,
  getTodayJalali,
  getPersianWeekdayName,
  formatTimeShort,
  getCurrentTehranTimeShort
} from '../utils/persianDate.js';
import { escapeHtml } from '../utils/html.js';

/**
 * Formats a single blackout entry into a clean Persian card.
 */
export function formatBlackoutCard(blackout, forceToday = false, forceTomorrow = false) {
  const dateInfo = parseDateInfo(blackout.date);
  const persianDate = toPersianDigits(dateInfo.jalaliStr || blackout.date);
  const weekday = dateInfo.weekday ? ` (${dateInfo.weekday})` : '';
  
  const isToday = forceToday || dateInfo.isToday;
  const isTomorrow = forceTomorrow || dateInfo.isTomorrow;
  const isYesterday = dateInfo.isYesterday;

  let prefix = '📅';
  let badge = '';
  if (isToday) {
    prefix = '⚡️';
    badge = ' 🔴 <b>[امروز]</b>';
  } else if (isTomorrow) {
    prefix = '⚡️';
    badge = ' 🟡 <b>[فردا]</b>';
  } else if (isYesterday) {
    badge = ' ⚪️ <i>[گذشته]</i>';
  }

  let text = `${prefix} <b>تاریخ:</b> ${persianDate}${weekday}${badge}\n`;

  const fromShort = formatTimeShort(blackout.from);
  const toShort = formatTimeShort(blackout.to);

  if (fromShort && toShort) {
    if (fromShort === '00:00' && toShort === '00:00') {
      text += `   🟢 <b>وضعیت:</b> بدون خاموشی\n`;
    } else {
      text += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(fromShort)}</code> تا <code>${toPersianDigits(toShort)}</code>\n`;
    }
  }

  const r1From = formatTimeShort(blackout.reserve1From);
  const r1To = formatTimeShort(blackout.reserve1To);
  if (r1From && r1To && !(r1From === '00:00' && r1To === '00:00')) {
    text += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(r1From)}</code> تا <code>${toPersianDigits(r1To)}</code>\n`;
  }

  const r2From = formatTimeShort(blackout.reserve2From);
  const r2To = formatTimeShort(blackout.reserve2To);
  if (r2From && r2To && !(r2From === '00:00' && r2To === '00:00')) {
    text += `   ⚠️ <b>نوبت دوم احتمالی:</b> <code>${toPersianDigits(r2From)}</code> تا <code>${toPersianDigits(r2To)}</code>\n`;
  }

  return text;
}

/**
 * Formats full schedule response from GOPED API.
 * @param {object} data - Data returned by gopedApi.getSchedule()
 * @param {'today' | 'tomorrow' | 'all'} mode - Filter mode
 * @param {string} [customLabel] - User's custom label for this bill (e.g. "خانه")
 */
export function formatScheduleMessage(data, mode = 'all', customLabel = '') {
  if (!data || !data.success) {
    return `❌ <b>خطا در دریافت اطلاعات:</b>\n${data?.message || 'اطلاعاتی یافت نشد.'}\n\n<i>💡 نکته: از صحت شناسه قبض ۱۳ رقمی خود اطمینان حاصل فرمایید.</i>`;
  }

  const customer = data.customer || {};
  const blackouts = data.blackouts || [];
  const queryTime = data.queryTime || getCurrentTehranTimeShort();

  const todayGregorian = getIranGregorianDate(0);
  const tomorrowGregorian = getIranGregorianDate(1);
  const todayJalali = getTodayJalali(0);
  const tomorrowJalali = getTodayJalali(1);
  const todayWeekday = getPersianWeekdayName(0);
  const tomorrowWeekday = getPersianWeekdayName(1);

  let header = `⚡️ <b>برنامه قطعی برق گلستان</b>\n`;
  if (customLabel) {
    header += `🏷 <b>عنوان نشان:</b> ${escapeHtml(customLabel)}\n`;
  }
  if (customer.billId) {
    header += `📄 <b>شناسه قبض:</b> <code>${toPersianDigits(customer.billId)}</code>\n`;
  }
  if (customer.name) {
    header += `👤 <b>مشترک:</b> ${escapeHtml(customer.name)}\n`;
  }
  if (customer.distributionTitle || customer.desc) {
    const loc = [customer.distributionTitle, customer.desc].filter(Boolean).join(' - ');
    header += `📍 <b>منطقه / امور:</b> ${escapeHtml(loc)}\n`;
  }
  header += `━━━━━━━━━━━━━━━━━━━━\n`;

  // Helper to check date match
  const matchesTarget = (bDate, targetG, targetJ) => {
    const info = parseDateInfo(bDate);
    return info.gregorianStr === targetG || info.jalaliStr === targetJ;
  };

  // Filter based on mode
  if (mode === 'today') {
    const todayBlackouts = blackouts.filter(b => matchesTarget(b.date, todayGregorian, todayJalali));
    let body = `📅 <b>برنامه خاموشی امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b>\n\n`;

    if (todayBlackouts.length === 0) {
      body += `🟢 <b>خوشبختانه برای امروز هیچ قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      todayBlackouts.forEach((b) => {
        body += formatBlackoutCard(b, true, false) + '\n';
      });
      body += `<i>⚠️ توجه: مدت زمان احتمالی خاموشی معمولاً تا ۲ ساعت می‌باشد.</i>\n`;
    }

    body += `\n🕒 <i>استعلام شده در ساعت ${toPersianDigits(queryTime)}</i>`;
    if (data.warningMessage) body += `\n\n${data.warningMessage}`;
    return header + body;
  }

  if (mode === 'tomorrow') {
    const tomorrowBlackouts = blackouts.filter(b => matchesTarget(b.date, tomorrowGregorian, tomorrowJalali));
    let body = `📅 <b>برنامه خاموشی فردا (${tomorrowWeekday} - ${toPersianDigits(tomorrowJalali)}):</b>\n\n`;

    if (tomorrowBlackouts.length === 0) {
      body += `🟢 <b>برای فردا هنوز قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      tomorrowBlackouts.forEach((b) => {
        body += formatBlackoutCard(b, false, true) + '\n';
      });
      body += `<i>⚠️ توجه: جدول خاموشی ممکن است در ساعات پایانی روز یا اوایل صبح به‌روزرسانی شود.</i>\n`;
    }

    body += `\n🕒 <i>استعلام شده در ساعت ${toPersianDigits(queryTime)}</i>`;
    if (data.warningMessage) body += `\n\n${data.warningMessage}`;
    return header + body;
  }

  // All schedules
  const todayBlackouts = blackouts.filter(b => matchesTarget(b.date, todayGregorian, todayJalali));
  let body = `📋 <b>جدول کامل زمان‌بندی خاموشی:</b>\n\n`;

  if (todayBlackouts.length === 0 && blackouts.length > 0) {
    body += `🟢 <b>امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b> بدون قطعی برق برنامه‌ریزی‌شده\n\n`;
  }

  if (blackouts.length === 0) {
    body += `🟢 در حال حاضر هیچ جدول خاموشی فعالی برای این شناسه در سامانه ثبت نشده است.\n`;
  } else {
    blackouts.forEach(b => {
      const isToday = matchesTarget(b.date, todayGregorian, todayJalali);
      const isTomorrow = matchesTarget(b.date, tomorrowGregorian, tomorrowJalali);
      body += formatBlackoutCard(b, isToday, isTomorrow) + '\n';
    });
    body += `<i>ℹ️ منبع: سامانه شرکت توزیع نیروی برق استان گلستان</i>\n`;
  }

  body += `🕒 <i>استعلام شده در ساعت ${toPersianDigits(queryTime)}</i>`;
  if (data.warningMessage) body += `\n\n${data.warningMessage}`;
  return header + body;
}

/**
 * Formats official GOPED announcement.
 */
export function formatNoticeMessage(noticeData) {
  if (!noticeData || !noticeData.success) {
    return `📢 <b>اطلاعیه شرکت توزیع برق:</b>\nدر حال حاضر اطلاعیه جدیدی منتشر نشده است.`;
  }

  const queryTime = noticeData.queryTime ? `\n🕒 <i>بروزرسانی: ${toPersianDigits(noticeData.queryTime)}</i>` : '';
  return `📢 <b>اطلاعیه شرکت توزیع نیروی برق گلستان:</b>\n\n${noticeData.text}${queryTime}\n\n<i>🌐 سامانه اطلاع‌رسانی: modiriattolid.goped.ir</i>`;
}

/**
 * Formats welcome and home message.
 * @param {string} firstName
 * @param {boolean} hasBookmarks
 */
export function formatWelcomeMessage(firstName = '', hasBookmarks = false) {
  const name = firstName ? ` <b>${firstName}</b>` : '';
  let text = `سلام${name} عزیز! 👋\n` +
    `به <b>سامانه هوشمند اطلاع‌رسانی خاموشی برق گلستان</b> خوش آمدید. ⚡️💡\n\n` +
    `با استفاده از این سامانه می‌توانید در هر لحظه از برنامه دقیق مدیریت اضطراری بار و قطعی برق مطلع شوید.\n\n` +
    `🌟 <b>امکانات ربات:</b>\n` +
    `⚡️ <b>استعلام آنی:</b> مشاهده برنامه خاموشی امروز، فردا و کل هفته\n` +
    `🔖 <b>نشان کردن (Bookmark):</b> ذخیره آسان شناسه قبض‌ها (منزل، محل کار، مغازه...) برای دسترسی سریع\n` +
    `🔔 <b>هشدار هوشمند:</b> اطلاع‌رسانی خودکار روزانه قبل از شروع خاموشی\n` +
    `📢 <b>اطلاعیه‌ها:</b> دسترسی به آخرین اخبار رسمی شرکت توزیع نیروی برق استان گلستان\n\n`;

  if (!hasBookmarks) {
    text += `👇 <b>شروع سریع:</b>\n` +
      `برای شروع، شناسه قبض <b>۱۳ رقمی</b> خود را ارسال کنید یا دکمهٔ <b>«افزودن اولین نشان»</b> زیر را لمس نمایید:`;
  } else {
    text += `👇 <b>انتخاب عملیات:</b>\n` +
      `شناسه قبض مورد نظر خود را ارسال نمایید یا یکی از گزینه‌های منوی زیر را انتخاب کنید:`;
  }

  return text;
}

/**
 * Formats user's saved bookmarked bills list.
 */
export function formatSavedBillsList(savedBills = [], activeBillId = null) {
  if (!savedBills || savedBills.length === 0) {
    return `🔖 <b>لیست قبض‌های نشان‌شده (Bookmarks):</b>\n\n` +
      `هنوز هیچ شناسه قبضی را نشان نکرده‌اید!\n` +
      `کافیست شناسه قبض ۱۳ رقمی خود را بفرستید تا ذخیره شود و همیشه روی کیبورد شما قرار بگیرد.`;
  }

  let text = `🔖 <b>قبض‌های نشان‌شده شما (Bookmarks):</b>\n\n`;
  savedBills.forEach((b, idx) => {
    const isActive = b.billId === activeBillId ? ' ⭐️ (فعال)' : '';
    text += `${toPersianDigits(idx + 1)}. <b>${escapeHtml(b.label)}</b>${isActive}\n   📄 شناسه: <code>${toPersianDigits(b.billId)}</code>\n\n`;
  });

  text += `👇 برای مشاهده آنی برنامه یا مدیریت، روی دکمه‌های زیر بزنید:`;
  return text;
}
