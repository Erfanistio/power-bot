/**
 * Cloudflare Worker for Golestan Electricity Outage Telegram Bot
 * Runs 100% serverless on Cloudflare Workers with Cloudflare KV storage
 * and Cloudflare Cron Triggers for daily automated outage alerts.
 */
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from 'grammy';

const GOPED_API_URL = 'https://modiriattolid.goped.ir:8090/';
const GOPED_AUTH_TOKEN = '7f3c2a91-6d84-4b17-a5e9-2c0f8d6b31a4';

// ================= UTILITIES =================

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

function normalizePersianText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u200c\u200d\u200e\u200f\uFEFF]/g, '') // strip ZWNJ and invisible zero-width chars
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .replace(/[ؤ]/g, 'و')
    .replace(/[إأآ]/g, 'ا')
    .trim();
}

const WEEKDAY_NAMES_MAP = {
  0: 'یکشنبه',
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنج‌شنبه',
  5: 'جمعه',
  6: 'شنبه'
};

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { jy, jm, jd };
}

function jalaliToGregorian(jy, jm, jd) {
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0);
  const sal_a = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && days >= sal_a[gm]; gm++) {
    days -= sal_a[gm];
  }
  const gd = days + 1;
  return { gy, gm, gd };
}

function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  if (parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  return String(timeStr).trim();
}

function getTehranNow(offsetDays = 0) {
  const now = new Date();
  const target = new Date(now.getTime() + (offsetDays * 24 * 60 * 60 * 1000));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(target);

  const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
  return {
    year: parseInt(getPart('year'), 10),
    month: parseInt(getPart('month'), 10),
    day: parseInt(getPart('day'), 10),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second')
  };
}

function parseDateInfo(dateStr) {
  if (!dateStr) return { jalaliStr: '', weekday: '', gregorianStr: '', isToday: false, isTomorrow: false };
  const cleaned = toEnglishDigits(String(dateStr)).trim().split('T')[0].split(' ')[0];
  const parts = cleaned.replace(/[-.]/g, '/').split('/');
  
  let gy, gm, gd, jy, jm, jd;

  if (parts.length === 3) {
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    const p3 = parseInt(parts[2], 10);

    if (p1 > 1800) {
      gy = p1;
      gm = p2;
      gd = p3;
      const j = gregorianToJalali(gy, gm, gd);
      jy = j.jy;
      jm = j.jm;
      jd = j.jd;
    } else {
      jy = p1;
      jm = p2;
      jd = p3;
      const g = jalaliToGregorian(jy, jm, jd);
      gy = g.gy;
      gm = g.gm;
      gd = g.gd;
    }
  } else {
    return { jalaliStr: cleaned, weekday: '', gregorianStr: cleaned, isToday: false, isTomorrow: false };
  }

  const gregorianStr = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  const jalaliStr = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;

  const dObj = new Date(Date.UTC(gy, gm - 1, gd, 12, 0, 0));
  const dayOfWeek = dObj.getUTCDay();
  const weekday = WEEKDAY_NAMES_MAP[dayOfWeek] || '';

  const todayG = getIranGregorianDate(0);
  const tomorrowG = getIranGregorianDate(1);

  return {
    jalaliStr,
    weekday,
    gregorianStr,
    isToday: gregorianStr === todayG,
    isTomorrow: gregorianStr === tomorrowG
  };
}

function getIranGregorianDate(offsetDays = 0) {
  const t = getTehranNow(offsetDays);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function getTodayJalali(offsetDays = 0) {
  return parseDateInfo(getIranGregorianDate(offsetDays)).jalaliStr;
}

function getPersianWeekdayName(offsetDays = 0) {
  return parseDateInfo(getIranGregorianDate(offsetDays)).weekday;
}

function isUserAdmin(env, userId) {
  const adminIds = (env.ADMIN_IDS || '7250238664').split(',').map(s => s.trim()).filter(Boolean);
  return adminIds.includes(String(userId));
}

// Module-level in-memory cache for warm isolates
const memScheduleCache = new Map();
const memUserCache = new Map();

async function fetchGopedSchedule(billId, forceFresh = false, storage = null) {
  const cleanId = toEnglishDigits(billId).replace(/\D/g, '');
  const now = Date.now();
  const cached = memScheduleCache.get(cleanId);
  if (!forceFresh && cached && (now - cached.timestamp < 3 * 60 * 1000)) {
    return cached.data;
  }

  const url = `${GOPED_API_URL}Api/GetSchedule_Web?BillId=${encodeURIComponent(cleanId)}`;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    try {
      const res = await fetch(url, {
        headers: {
          'Auth-Token': GOPED_AUTH_TOKEN,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.Code === 1) {
        memScheduleCache.set(cleanId, { timestamp: now, data });
        if (storage && typeof storage.saveScheduleCache === 'function') {
          storage.saveScheduleCache(cleanId, data).catch(() => {});
        }
        return data;
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }

  // Graceful fallback to memory or KV cache if GOPED server is down/slow
  if (cached && cached.data) {
    return { ...cached.data, isStaleFallback: true };
  }

  if (storage && typeof storage.getScheduleCache === 'function') {
    const kvCached = await storage.getScheduleCache(cleanId).catch(() => null);
    if (kvCached) {
      return { ...kvCached, isStaleFallback: true };
    }
  }

  throw lastError || new Error('خطا در برقراری ارتباط با سرور برق');
}

async function fetchGopedNotice() {
  const url = `${GOPED_API_URL}Api/GetNotice`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      headers: {
        'Auth-Token': GOPED_AUTH_TOKEN,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; TelegramBot)',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ================= CLOUDFLARE KV DATABASE =================

class CloudflareStorage {
  constructor(kv) {
    this.kv = kv;
  }

  async getScheduleCache(billId) {
    if (!this.kv) return null;
    return await this.kv.get(`sched_cache:${billId}`, 'json');
  }

  async saveScheduleCache(billId, data) {
    if (!this.kv || !data) return;
    await this.kv.put(`sched_cache:${billId}`, JSON.stringify(data), { expirationTtl: 86400 });
  }

  async getUser(userId) {
    const id = String(userId);
    let user = memUserCache.get(id);
    if (!user && this.kv) {
      try {
        user = await this.kv.get(`user:${id}`, 'json');
        if (user) memUserCache.set(id, user);
      } catch (e) {
        console.error(`KV parse error for user ${id}:`, e);
      }
    }
    if (!user) {
      user = {
        userId: id,
        username: '',
        firstName: '',
        savedBills: [],
        activeBillId: null,
        notifications: {
          enabled: true,
          time: '08:00',
          lastNotifiedDate: null
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await this.saveUser(user);
    } else {
      if (!Array.isArray(user.savedBills)) {
        user.savedBills = [];
      }
      if (!user.activeBillId && user.savedBills.length > 0) {
        user.activeBillId = user.savedBills[0].billId;
        await this.saveUser(user);
      }
    }
    return user;
  }

  async saveUser(user) {
    if (!user) return;
    user.updatedAt = new Date().toISOString();
    memUserCache.set(String(user.userId), user);
    if (!this.kv) return;
    await this.kv.put(`user:${user.userId}`, JSON.stringify(user));

    // Update users index list
    let index = await this.kv.get('users_index', 'json');
    if (!Array.isArray(index)) index = [];
    if (!index.includes(String(user.userId))) {
      index.push(String(user.userId));
      await this.kv.put('users_index', JSON.stringify(index));
    }
  }

  async getAllUsers() {
    if (!this.kv) return [];
    let index = await this.kv.get('users_index', 'json');
    if (!Array.isArray(index)) index = ['7250238664'];
    const users = [];
    for (const uid of index) {
      const u = await this.kv.get(`user:${uid}`, 'json');
      if (u) users.push(u);
    }
    return users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async getStats() {
    const users = await this.getAllUsers();
    let totalSavedBills = 0;
    let subscribedUsers = 0;
    users.forEach(u => {
      if (u.savedBills) totalSavedBills += u.savedBills.length;
      if (u.notifications?.enabled) subscribedUsers++;
    });
    return {
      totalUsers: users.length,
      totalSavedBills,
      subscribedUsers
    };
  }

  async addBillId(userId, rawBillId, label = '') {
    const user = await this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    if (!billId) return { success: false, message: 'شناسه نامعتبر است.' };

    const existingIdx = user.savedBills.findIndex(b => b.billId === billId);
    const finalLabel = label && label.trim() ? label.trim() : `قبض ${user.savedBills.length + 1}`;

    if (existingIdx >= 0) {
      user.savedBills[existingIdx].label = finalLabel;
    } else {
      user.savedBills.push({
        billId,
        label: finalLabel,
        addedAt: new Date().toISOString()
      });
    }
    user.activeBillId = billId;
    await this.saveUser(user);
    return { success: true, billId, label: finalLabel };
  }

  async removeBillId(userId, rawBillId) {
    const user = await this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    user.savedBills = user.savedBills.filter(b => b.billId !== billId);
    if (user.activeBillId === billId) {
      user.activeBillId = user.savedBills.length > 0 ? user.savedBills[0].billId : null;
    }
    await this.saveUser(user);
    return true;
  }

  async renameBillId(userId, rawBillId, newLabel) {
    const user = await this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    const item = user.savedBills.find(b => b.billId === billId);
    if (item && newLabel && newLabel.trim()) {
      item.label = newLabel.trim();
      await this.saveUser(user);
      return true;
    }
    return false;
  }

  async setActiveBillId(userId, rawBillId) {
    const user = await this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    if (user.savedBills.some(b => b.billId === billId)) {
      user.activeBillId = billId;
      await this.saveUser(user);
      return true;
    }
    return false;
  }

  async setNotifications(userId, enabled) {
    const user = await this.getUser(userId);
    user.notifications.enabled = Boolean(enabled);
    await this.saveUser(user);
    return user.notifications;
  }

  async getState(userId) {
    if (!this.kv) return null;
    return await this.kv.get(`state:${userId}`, 'json');
  }

  async setState(userId, stateObj) {
    if (!this.kv) return;
    if (!stateObj) {
      await this.kv.delete(`state:${userId}`);
    } else {
      await this.kv.put(`state:${userId}`, JSON.stringify(stateObj), { expirationTtl: 600 });
    }
  }
}

// ================= KEYBOARDS & FORMATTERS =================

function getMainReplyKeyboard(savedBills = []) {
  const kb = new Keyboard();

  if (savedBills && savedBills.length > 0) {
    let countInRow = 0;
    savedBills.forEach((b, idx) => {
      kb.text(`🔖 ${b.label}`);
      countInRow++;
      if (countInRow === 2 && idx < savedBills.length - 1) {
        kb.row();
        countInRow = 0;
      }
    });
    kb.row();
  }

  kb.text('⚡️ خاموشی امروز').text('🗓 خاموشی فردا')
    .row()
    .text('📋 کل برنامه هفتگی').text('🔖 نشان‌شده‌های من')
    .row()
    .text('🔔 هشدار خودکار').text('📢 اطلاعیه‌ها')
    .row()
    .text('➕ افزودن نشان جدید').text('ℹ️ راهنما')
    .resized();

  return kb;
}

function getPrivateReplyKeyboard(ctx, savedBills = []) {
  if (ctx.chat && ctx.chat.type !== 'private') {
    return undefined;
  }
  return getMainReplyKeyboard(savedBills);
}

function getScheduleInlineKeyboard(billId, currentMode = 'all', isBookmarked = false) {
  const kb = new InlineKeyboard();
  if (currentMode !== 'today') kb.text('⚡️ امروز', `sched:today:${billId}`);
  if (currentMode !== 'tomorrow') kb.text('🗓 فردا', `sched:tom:${billId}`);
  if (currentMode !== 'all') kb.text('📋 کل جدول', `sched:all:${billId}`);
  kb.row().text('🔄 بروزرسانی', `sched_refresh:${currentMode}:${billId}`);

  if (!isBookmarked) {
    kb.text('🔖 نشان کردن این قبض', `save_prompt:${billId}`);
  } else {
    kb.text('✏️ تغییر نام', `rename_prompt:${billId}`);
    kb.text('🗑 حذف نشان', `delete_bill_do:${billId}`);
  }
  return kb;
}

function getSavedBillsInlineKeyboard(savedBills = [], activeBillId = null) {
  const kb = new InlineKeyboard();
  savedBills.forEach(b => {
    const isAct = b.billId === activeBillId ? '⭐️ ' : '';
    kb.text(`${isAct}🔖 ${b.label} (${toPersianDigits(b.billId.slice(-4))})`, `select_bill:${b.billId}`).row();
  });
  kb.text('➕ افزودن نشان جدید', 'add_bill_prompt').row();
  if (savedBills.length > 0) {
    kb.text('✏️ تغییر نام نشان', 'rename_bill_menu');
    kb.text('🗑 حذف نشان', 'delete_bill_menu').row();
  }
  return kb;
}

function getRenameBillsInlineKeyboard(savedBills = []) {
  const kb = new InlineKeyboard();
  savedBills.forEach(b => {
    kb.text(`✏️ ${b.label}`, `rename_prompt:${b.billId}`).row();
  });
  kb.text('🔙 بازگشت', 'view_saved_bills');
  return kb;
}

function getDeleteBillsInlineKeyboard(savedBills = []) {
  const kb = new InlineKeyboard();
  savedBills.forEach(b => {
    kb.text(`🗑 حذف ${b.label}`, `delete_bill_do:${b.billId}`).row();
  });
  kb.text('🔙 بازگشت', 'view_saved_bills');
  return kb;
}

function getNotificationSettingsKeyboard(isEnabled = true) {
  const kb = new InlineKeyboard();
  const toggleText = isEnabled ? '🔕 غیرفعال‌سازی اطلاع‌رسانی روزانه' : '🔔 فعال‌سازی اطلاع‌رسانی روزانه';
  kb.text(toggleText, `toggle_notifications:${isEnabled ? '0' : '1'}`).row();
  kb.text('🔙 بازگشت به منوی اصلی', 'back_to_main');
  return kb;
}

function formatBlackoutCard(blackout, isToday = false, isTomorrow = false) {
  const dateInfo = parseDateInfo(blackout.date || blackout.Date);
  const persianDate = toPersianDigits(dateInfo.jalaliStr || blackout.date || blackout.Date);
  const weekday = dateInfo.weekday ? ` (${dateInfo.weekday})` : '';

  let prefix = '📅';
  let badge = '';
  if (isToday) {
    prefix = '⚡️';
    badge = ' 🔴 [امروز]';
  } else if (isTomorrow) {
    prefix = '⚡️';
    badge = ' 🟡 [فردا]';
  }

  let text = `${prefix} <b>تاریخ:</b> ${persianDate}${weekday}${badge}\n`;
  const from = blackout.from || blackout.From;
  const to = blackout.to || blackout.To;
  if (from && to) {
    text += `   ⏳ <b>ساعت خاموشی:</b> <code>${toPersianDigits(formatTimeShort(from))}</code> تا <code>${toPersianDigits(formatTimeShort(to))}</code>\n`;
  }
  const r1From = blackout.reserve1From || blackout.Reserve1From;
  const r1To = blackout.reserve1To || blackout.Reserve1To;
  if (r1From && r1To) {
    text += `   ⚠️ <b>نوبت اول احتمالی:</b> <code>${toPersianDigits(formatTimeShort(r1From))}</code> تا <code>${toPersianDigits(formatTimeShort(r1To))}</code>\n`;
  }
  return text;
}

function formatScheduleMessage(data, mode = 'all', customLabel = '') {
  if (data.Code !== 1 || !data.Result) {
    return `❌ <b>خطا در دریافت اطلاعات:</b>\n${data.Description || 'شناسه قبض یافت نشد یا برنامه‌ای ثبت نشده است.'}`;
  }

  const customer = data.Result.Customer || {};
  const blackouts = data.Result.Blackouts || [];
  const todayGregorian = getIranGregorianDate(0);
  const tomorrowGregorian = getIranGregorianDate(1);
  const todayJalali = getTodayJalali(0);
  const tomorrowJalali = getTodayJalali(1);
  const todayWeekday = getPersianWeekdayName(0);
  const tomorrowWeekday = getPersianWeekdayName(1);

  let header = '';
  if (data.isStaleFallback) {
    header += `⚠️ <i>توجه: به دلیل کندی لحظه‌ای در سرور توزیع برق، آخرین اطلاعات دریافت شده نمایش داده می‌شود.</i>\n\n`;
  }
  header += `⚡️ <b>برنامه قطعی برق گلستان</b>\n`;
  if (customLabel) header += `🏷 <b>عنوان:</b> ${customLabel}\n`;
  if (customer.BillId) header += `📄 <b>شناسه قبض:</b> <code>${toPersianDigits(customer.BillId)}</code>\n`;
  if (customer.Name) header += `👤 <b>مشترک:</b> ${customer.Name}\n`;
  if (customer.DistributionTitle) header += `📍 <b>منطقه / امور:</b> ${customer.DistributionTitle}\n`;
  header += `━━━━━━━━━━━━━━━━━━━━\n`;

  const matchesDate = (bDate, targetG, targetJ) => {
    const info = parseDateInfo(bDate);
    return info.gregorianStr === targetG || info.jalaliStr === targetJ;
  };

  if (mode === 'today') {
    const todayBlackouts = blackouts.filter(b => matchesDate(b.Date || b.date, todayGregorian, todayJalali));
    let body = `📅 <b>برنامه خاموشی امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b>\n\n`;
    if (todayBlackouts.length === 0) {
      body += `🟢 <b>خوشبختانه برای امروز هیچ قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      todayBlackouts.forEach(b => {
        body += formatBlackoutCard(b, true, false) + '\n';
      });
      body += `<i>⚠️ توجه: مدت زمان احتمالی خاموشی معمولاً تا ۲ ساعت می‌باشد.</i>\n`;
    }
    return header + body;
  }

  if (mode === 'tomorrow') {
    const tomorrowBlackouts = blackouts.filter(b => matchesDate(b.Date || b.date, tomorrowGregorian, tomorrowJalali));
    let body = `📅 <b>برنامه خاموشی فردا (${tomorrowWeekday} - ${toPersianDigits(tomorrowJalali)}):</b>\n\n`;
    if (tomorrowBlackouts.length === 0) {
      body += `🟢 <b>برای فردا قطعی برق برنامه‌ریزی‌شده‌ای ثبت نشده است.</b>\n`;
    } else {
      tomorrowBlackouts.forEach(b => {
        body += formatBlackoutCard(b, false, true) + '\n';
      });
      body += `<i>⚠️ توجه: جدول خاموشی ممکن است در ساعات پایانی روز به‌روزرسانی شود.</i>\n`;
    }
    return header + body;
  }

  // All schedules mode
  const todayBlackouts = blackouts.filter(b => matchesDate(b.Date || b.date, todayGregorian, todayJalali));
  let body = `📋 <b>جدول کامل زمان‌بندی خاموشی:</b>\n\n`;

  if (todayBlackouts.length === 0 && blackouts.length > 0) {
    body += `🟢 <b>امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b> بدون قطعی برق برنامه‌ریزی‌شده\n\n`;
  }

  if (blackouts.length === 0) {
    body += `🟢 در حال حاضر هیچ جدول خاموشی فعالی برای این شناسه در سامانه ثبت نشده است.\n`;
  } else {
    blackouts.forEach(b => {
      const isToday = matchesDate(b.Date || b.date, todayGregorian, todayJalali);
      const isTomorrow = matchesDate(b.Date || b.date, tomorrowGregorian, tomorrowJalali);
      body += formatBlackoutCard(b, isToday, isTomorrow) + '\n';
    });
    body += `<i>ℹ️ منبع: سامانه شرکت توزیع نیروی برق استان گلستان</i>\n`;
  }

  return header + body;
}

function formatSavedBillsList(savedBills = [], activeBillId = null) {
  if (!savedBills || savedBills.length === 0) {
    return `🔖 <b>لیست قبض‌های نشان‌شده (Bookmarks):</b>\n\nهنوز هیچ شناسه قبضی را نشان نکرده‌اید!\nکافیست شناسه قبض ۱۳ رقمی خود را بفرستید تا ذخیره شود و همیشه روی کیبورد شما قرار بگیرد.`;
  }
  let text = `🔖 <b>قبض‌های نشان‌شده شما (Bookmarks):</b>\n\n`;
  savedBills.forEach((b, idx) => {
    const isActive = b.billId === activeBillId ? ' ⭐️ (فعال)' : '';
    text += `${toPersianDigits(idx + 1)}. <b>${b.label}</b>${isActive}\n   📄 شناسه: <code>${toPersianDigits(b.billId)}</code>\n\n`;
  });
  text += `👇 برای مشاهده آنی برنامه یا مدیریت، روی دکمه‌های زیر بزنید:`;
  return text;
}

// ================= WORKER BOT CORE =================

function createBot(env, executionCtx = null) {
  const token = env.BOT_TOKEN || '8931573991:AAEFAPuyGHGvKi8okFQFCKuHRUGqw6_fRDY';
  const bot = new Bot(token, {
    botInfo: {
      id: 8931573991,
      is_bot: true,
      first_name: 'Power Bot',
      username: 'goped_power_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    }
  });
  const storage = new CloudflareStorage(env.POWERBOT_KV);

  // Global error handler so bot never crashes unhandled
  bot.catch((err) => {
    console.error('[Bot Catch Error]:', err.error || err);
  });

  // User profile tracking
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      const user = await storage.getUser(ctx.from.id);
      let changed = false;
      if (ctx.from.username && user.username !== ctx.from.username) {
        user.username = ctx.from.username;
        changed = true;
      }
      if (ctx.from.first_name && user.firstName !== ctx.from.first_name) {
        user.firstName = ctx.from.first_name;
        changed = true;
      }
      if (changed) await storage.saveUser(user);
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await storage.setState(ctx.from.id, null);
    const user = await storage.getUser(ctx.from.id);
    const welcome = `سلام ${ctx.from.first_name || ''} عزیز! 👋\n` +
      `به <b>بات استعلام خاموشی برق استان گلستان</b> خوش آمدید. ⚡️💡\n\n` +
      `با این بات می‌توانید:\n` +
      `• برنامه قطعی برق امروز، فردا و کل هفته را در لحظه ببینید.\n` +
      `• قبض‌های خود را <b>نشان (Bookmark)</b> کنید تا همیشه روی کیبورد در دسترستان باشند.\n` +
      `• هر روز صبح ساعت ۸:۰۰ در صورت وجود قطعی، پیام هشدار خودکار دریافت کنید.\n\n` +
      `👇 <b>برای شروع:</b>\nشناسه قبض ۱۳ رقمی خود را ارسال کنید یا از دکمه‌های زیر استفاده نمایید.`;

    await ctx.reply(welcome, {
      parse_mode: 'HTML',
      reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills)
    });
  });

  bot.command('help', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const helpText = `📖 <b>راهنمای استفاده از ربات خاموشی برق گلستان:</b>\n\n` +
      `1️⃣ <b>استعلام سریع:</b> شناسه قبض ۱۳ رقمی خود را مستقیم بفرستید.\n` +
      `2️⃣ <b>نشان کردن (Bookmark):</b> شناسه‌های خود را با نام دلخواه (مثلاً: <code>/bookmark 1234567890123 خونه</code>) نشان کنید تا همیشه روی کیبورد در دسترس باشند.\n` +
      `3️⃣ <b>مدیریت نشان‌ها:</b> با زدن دکمه 🔖 نشان‌شده‌های من یا دستور <code>/bookmarks</code> نشان‌های خود را تغییر نام داده یا حذف کنید.\n` +
      `4️⃣ <b>هشدار روزانه:</b> با فعال بودن هشدار، هر روز صبح در صورت وجود قطعی برق، پیام هشدار دریافت خواهید کرد.\n` +
      `5️⃣ <b>اطلاعیه‌ها:</b> مشاهده آخرین اخبار و اطلاعیه‌های رسمی شرکت توزیع با دکمه 📢 اطلاعیه‌ها.`;
    await ctx.reply(helpText, {
      parse_mode: 'HTML',
      reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills)
    });
  });

  bot.command('notice', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    try {
      const notice = await fetchGopedNotice();
      const text = (notice.Result || '').replace(/<br\s*[\/]?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      await ctx.reply(`📢 <b>اطلاعیه شرکت توزیع برق:</b>\n\n${text || 'اطلاعیه‌ای وجود ندارد.'}`, {
        parse_mode: 'HTML',
        reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills)
      });
    } catch (err) {
      await ctx.reply(`❌ خطا در دریافت اطلاعیه: ${err.message}`);
    }
  });

  bot.command(['bookmarks', 'bills', 'saved'], async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const text = formatSavedBillsList(user.savedBills, user.activeBillId);
    const kb = getSavedBillsInlineKeyboard(user.savedBills, user.activeBillId);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.command(['bookmark', 'save', 'add'], async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await storage.setState(ctx.from.id, { step: 'awaiting_bill_id' });
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
    const res = await storage.addBillId(ctx.from.id, billId, label);
    const user = await storage.getUser(ctx.from.id);
    await ctx.reply(
      `🔖 شناسه قبض <code>${toPersianDigits(billId)}</code> با عنوان <b>${res.label}</b> به نشان‌شده‌ها اضافه شد و به کیبورد شما افزوده شد!`,
      { parse_mode: 'HTML', reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills) }
    );
    await executeScheduleLookup(ctx, storage, billId, 'all');
  });

  bot.command('check', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('لطفاً شناسه قبض را به همراه دستور ارسال کنید: <code>/check 1234567890123</code>', { parse_mode: 'HTML' });
      return;
    }
    const billId = toEnglishDigits(parts[0]).replace(/\D/g, '');
    await executeScheduleLookup(ctx, storage, billId, 'all');
  });

  // Admin Commands
  bot.command(['users', 'userlist', 'stats', 'admin'], async (ctx) => {
    if (!isUserAdmin(env, ctx.from.id)) {
      await ctx.reply('⛔️ شما دسترسی مدیریت برای اجرای این دستور را ندارید.');
      return;
    }
    const stats = await storage.getStats();
    const allUsers = await storage.getAllUsers();
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

    if (allUsers.length > 30) text += `<i>... و ${toPersianDigits(allUsers.length - 30)} کاربر دیگر</i>\n`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command(['shout', 'broadcast', 'announce'], async (ctx) => {
    if (!isUserAdmin(env, ctx.from.id)) {
      await ctx.reply('⛔️ شما دسترسی مدیریت برای اجرای این دستور را ندارید.');
      return;
    }
    const replyMsg = ctx.message.reply_to_message;
    const rawText = ctx.message.text || '';
    const textArg = rawText
      .replace(/^\/(?:shout|broadcast|announce)(?:@\w+)?[\s\n]*/i, '')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .trim();
    if (!replyMsg && !textArg) {
      await ctx.reply(
        `📢 <b>راهنمای ارسال همگانی (Shout):</b>\n\n` +
        `• <b>روش اول:</b> دستور را همراه با متن پیام ارسال کنید:\n<code>/shout متن پیام شما...</code>\n\n` +
        `• <b>روش دوم:</b> روی یک پیام ریپلای کرده و بنویسید <code>/shout</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const allUsers = await storage.getAllUsers();
    const realUsers = allUsers.filter(u => u.userId !== '999888777');
    const totalUsers = realUsers.length;
    const statusMsg = await ctx.reply(`🚀 در حال ارسال پیام به <b>${toPersianDigits(totalUsers)}</b> کاربر...`, { parse_mode: 'HTML' });

    const doBroadcast = async () => {
      let successCount = 0;
      let blockedCount = 0;
      let failedCount = 0;
      const startTime = Date.now();

      const chunkSize = 5;
      for (let i = 0; i < realUsers.length; i += chunkSize) {
        const chunk = realUsers.slice(i, i + chunkSize);
        await Promise.allSettled(chunk.map(async (u) => {
          try {
            if (replyMsg) {
              await ctx.api.copyMessage(u.userId, ctx.chat.id, replyMsg.message_id);
            } else {
              try {
                await ctx.api.sendMessage(u.userId, textArg, { parse_mode: 'HTML' });
              } catch {
                await ctx.api.sendMessage(u.userId, textArg);
              }
            }
            successCount++;
          } catch (err) {
            if (err.description && (err.description.includes('bot was blocked') || err.description.includes('user is deactivated') || err.description.includes('chat not found'))) {
              blockedCount++;
            } else {
              failedCount++;
            }
          }
        }));
        await new Promise(r => setTimeout(r, 40));
      }

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const report = `📢 <b>گزارش ارسال همگانی (Shout):</b>\n\n` +
        `👥 <b>کل مخاطبان:</b> <code>${toPersianDigits(totalUsers)}</code>\n` +
        `✅ <b>ارسال موفق:</b> <code>${toPersianDigits(successCount)}</code>\n` +
        `🚫 <b>بلاک / غیرفعال:</b> <code>${toPersianDigits(blockedCount)}</code>\n` +
        `❌ <b>خطاهای دیگر:</b> <code>${toPersianDigits(failedCount)}</code>\n` +
        `⏱ <b>مدت زمان:</b> <code>${toPersianDigits(durationSec)}</code> ثانیه`;

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, report, { parse_mode: 'HTML' }).catch(async () => {
        await ctx.reply(report, { parse_mode: 'HTML' }).catch(() => {});
      });
    };

    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(doBroadcast());
    } else {
      await doBroadcast();
    }
  });

  // /testnotif and /runnotif admin command
  bot.command(['testnotif', 'runnotif', 'checknotif'], async (ctx) => {
    if (!isUserAdmin(env, ctx.from.id)) {
      await ctx.reply('⛔️ شما دسترسی مدیریت برای اجرای این دستور را ندارید.');
      return;
    }

    const statusMsg = await ctx.reply('⏳ در حال بررسی و تست ارسال اعلانات روزانه...');
    const result = await runScheduledNotifications(env, bot, storage, true);

    const report = `🔔 <b>گزارش اجرای تست اعلان خاموشی (Cloudflare):</b>\n\n` +
      `📅 <b>تاریخ:</b> ${toPersianDigits(result.dateJalali)}\n` +
      `👥 <b>کاربران بررسی‌شده:</b> <code>${toPersianDigits(result.totalChecked)}</code>\n` +
      `📨 <b>پیام‌های ارسال‌شده:</b> <code>${toPersianDigits(result.totalNotified)}</code>\n` +
      `⚠️ <b>ناموفق / بدون قطعی:</b> <code>${toPersianDigits(result.totalFailed)}</code>`;

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, report, {
      parse_mode: 'HTML'
    }).catch(async () => {
      await ctx.reply(report, { parse_mode: 'HTML' });
    });
  });

  // Main Menu Buttons
  bot.hears('⚡️ خاموشی امروز', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const savedBills = Array.isArray(user.savedBills) ? user.savedBills : [];
    const billId = user.activeBillId || (savedBills.length > 0 ? savedBills[0].billId : null);
    if (!billId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await executeScheduleLookup(ctx, storage, billId, 'today');
  });

  bot.hears('🗓 خاموشی فردا', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const savedBills = Array.isArray(user.savedBills) ? user.savedBills : [];
    const billId = user.activeBillId || (savedBills.length > 0 ? savedBills[0].billId : null);
    if (!billId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await executeScheduleLookup(ctx, storage, billId, 'tomorrow');
  });

  bot.hears('📋 کل برنامه هفتگی', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const savedBills = Array.isArray(user.savedBills) ? user.savedBills : [];
    const billId = user.activeBillId || (savedBills.length > 0 ? savedBills[0].billId : null);
    if (!billId) {
      await ctx.reply('❌ شما هنوز شناسه قبضی ثبت نکرده‌اید!\nلطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید.');
      return;
    }
    await executeScheduleLookup(ctx, storage, billId, 'all');
  });

  bot.hears(['🔖 نشان‌شده‌های من', '📂 شناسه‌های من'], async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const text = formatSavedBillsList(user.savedBills, user.activeBillId);
    const kb = getSavedBillsInlineKeyboard(user.savedBills, user.activeBillId);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.hears(['➕ افزودن نشان جدید', '➕ افزودن شناسه جدید'], async (ctx) => {
    await storage.setState(ctx.from.id, { step: 'awaiting_bill_id' });
    await ctx.reply('لطفاً شناسه قبض ۱۳ رقمی را ارسال فرمایید:');
  });

  bot.hears('🔔 هشدار خودکار', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const isEnabled = user.notifications?.enabled !== false;
    const statusStr = isEnabled ? '🟢 فعال' : '🔴 غیرفعال';
    const text = `🔔 <b>تنظیمات هشدار خودکار روزانه:</b>\n\n` +
      `وضعیت فعلی: <b>${statusStr}</b>\n\n` +
      `در صورت فعال بودن، هر روز صبح (ساعت ۸:۰۰) در صورتی که قطعی برق برای نشان‌های شما برنامه‌ریزی شده باشد، پیام هشدار دریافت خواهید کرد.`;
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: getNotificationSettingsKeyboard(isEnabled) });
  });

  bot.hears('📢 اطلاعیه‌ها', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    try {
      const notice = await fetchGopedNotice();
      const text = (notice.Result || '').replace(/<br\s*[\/]?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      await ctx.reply(`📢 <b>اطلاعیه شرکت توزیع برق:</b>\n\n${text || 'اطلاعیه‌ای وجود ندارد.'}`, {
        parse_mode: 'HTML',
        reply_markup: getMainReplyKeyboard(user.savedBills)
      });
    } catch (err) {
      await ctx.reply(`❌ خطا در دریافت اطلاعیه: ${err.message}`);
    }
  });

  bot.hears('ℹ️ راهنما', async (ctx) => {
    const user = await storage.getUser(ctx.from.id);
    const helpText = `📖 <b>راهنمای ربات:</b>\n\n` +
      `⚡️ این ربات اطلاعات خاموشی را مستقیماً از سامانه رسمی شرکت توزیع نیروی برق استان گلستان (goped.ir) دریافت می‌کند.\n\n` +
      `• برای استعلام، کافیست شناسه قبض خود را بنویسید و بفرستید.\n` +
      `• می‌توانید چندین شناسه قبض (مثلاً خانه، مغازه، کارگاه) را نشان (Bookmark) کنید.\n` +
      `• با فعال بودن هشدار روزانه، هر روز صبح در صورت خاموشی احتمالی، پیام یادآوری دریافت خواهید کرد.`;
    await ctx.reply(helpText, { parse_mode: 'HTML', reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills) });
  });

  // Message & State Handler
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const user = await storage.getUser(userId);
    const state = await storage.getState(userId);

    // Dynamic bookmark button click
    if (user.savedBills && user.savedBills.length > 0) {
      const cleanText = text.replace(/^🔖\s*/, '').trim();
      const normInput = normalizePersianText(cleanText);
      const digitsOnly = toEnglishDigits(text).replace(/\D/g, '');

      const matchedBookmark = user.savedBills.find(b => {
        const normLabel = normalizePersianText(b.label || '');
        return (
          b.label === cleanText ||
          normLabel === normInput ||
          `🔖 ${b.label}` === text ||
          `🔖 ${normLabel}` === normInput ||
          `🔖 ${normLabel}` === `🔖 ${normInput}` ||
          b.billId === cleanText ||
          b.billId === digitsOnly
        );
      });

      if (matchedBookmark) {
        await storage.setActiveBillId(userId, matchedBookmark.billId);
        await executeScheduleLookup(ctx, storage, matchedBookmark.billId, 'all');
        return;
      }
    }

    if (state) {
      if (state.step === 'awaiting_bill_id') {
        const billId = toEnglishDigits(text).replace(/\D/g, '');
        if (billId.length < 8 || billId.length > 15) {
          await ctx.reply('❌ شناسه قبض نامعتبر است. لطفاً شناسه قبض معتبر ارسال کنید:');
          return;
        }
        await storage.setState(userId, { step: 'awaiting_label', billId });
        await ctx.reply(`برای شناسه <code>${toPersianDigits(billId)}</code> یک عنوان برای نشان بنویسید (مثلاً: 🏠 خانه):`, { parse_mode: 'HTML' });
        return;
      }

      if (state.step === 'awaiting_label') {
        const billId = state.billId;
        const label = text;
        await storage.setState(userId, null);
        await storage.addBillId(userId, billId, label);
        const updatedUser = await storage.getUser(userId);
        await ctx.reply(
          `🔖 شناسه <code>${toPersianDigits(billId)}</code> با عنوان <b>${label}</b> با موفقیت نشان (Bookmark) شد و روی کیبورد شما قرار گرفت!`,
          { parse_mode: 'HTML', reply_markup: getPrivateReplyKeyboard(ctx, updatedUser.savedBills) }
        );
        await executeScheduleLookup(ctx, storage, billId, 'all');
        return;
      }

      if (state.step === 'awaiting_custom_save_label') {
        const billId = state.billId;
        const label = text;
        await storage.setState(userId, null);
        await storage.addBillId(userId, billId, label);
        const updatedUser = await storage.getUser(userId);
        await ctx.reply(
          `🔖 شناسه <code>${toPersianDigits(billId)}</code> با عنوان <b>${label}</b> نشان شد!`,
          { parse_mode: 'HTML', reply_markup: getPrivateReplyKeyboard(ctx, updatedUser.savedBills) }
        );
        await executeScheduleLookup(ctx, storage, billId, 'all');
        return;
      }

      if (state.step === 'awaiting_rename') {
        const billId = state.billId;
        const newLabel = text;
        await storage.setState(userId, null);
        await storage.renameBillId(userId, billId, newLabel);
        const updatedUser = await storage.getUser(userId);
        await ctx.reply(
          `✏️ نام نشان با موفقیت به <b>${newLabel}</b> تغییر یافت!`,
          { parse_mode: 'HTML', reply_markup: getPrivateReplyKeyboard(ctx, updatedUser.savedBills) }
        );
        const listText = formatSavedBillsList(updatedUser.savedBills, updatedUser.activeBillId);
        const kb = getSavedBillsInlineKeyboard(updatedUser.savedBills, updatedUser.activeBillId);
        await ctx.reply(listText, { parse_mode: 'HTML', reply_markup: kb });
        return;
      }
    }

    const digitsOnly = toEnglishDigits(text).replace(/\D/g, '');
    if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
      await executeScheduleLookup(ctx, storage, digitsOnly, 'all');
      return;
    }

    await ctx.reply(
      '❓ متوجه دستور نشدم.\nبرای استعلام، لطفاً شناسه قبض ۱۳ رقمی خود را ارسال کنید یا از نشان‌های روی کیبورد انتخاب فرمایید.',
      { reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills) }
    );
  });

  // Callbacks
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    await ctx.answerCallbackQuery().catch(() => {});

    if (data.startsWith('sched:') || data.startsWith('sched_refresh:')) {
      const parts = data.split(':');
      const mode = parts[1] || 'all';
      const billId = parts[2];
      const isForce = data.startsWith('sched_refresh:');
      await executeScheduleLookup(ctx, storage, billId, mode === 'tom' ? 'tomorrow' : mode, true, isForce);
      return;
    }

    if (data.startsWith('select_bill:')) {
      const billId = data.replace('select_bill:', '');
      await storage.setActiveBillId(userId, billId);
      const user = await storage.getUser(userId);
      const active = user.savedBills.find(b => b.billId === billId);
      const label = active ? active.label : billId;
      await ctx.reply(`⭐️ نشان <b>${label}</b> انتخاب شد:`, {
        parse_mode: 'HTML',
        reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills)
      });
      await executeScheduleLookup(ctx, storage, billId, 'all');
      return;
    }

    if (data.startsWith('save_prompt:')) {
      const billId = data.replace('save_prompt:', '');
      await storage.setState(userId, { step: 'awaiting_custom_save_label', billId });
      await ctx.reply(`🏷 برای نشان کردن شناسه <code>${toPersianDigits(billId)}</code> یک نام دلخواه بفرستید (مثلاً: 🏠 خانه یا 🏢 محل کار):`, {
        parse_mode: 'HTML'
      });
      return;
    }

    if (data.startsWith('rename_prompt:')) {
      const billId = data.replace('rename_prompt:', '');
      await storage.setState(userId, { step: 'awaiting_rename', billId });
      await ctx.reply(`✏️ لطفاً نام جدید را برای این نشان وارد نمایید:`);
      return;
    }

    if (data === 'rename_bill_menu') {
      const user = await storage.getUser(userId);
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

    if (data === 'add_bill_prompt') {
      await storage.setState(userId, { step: 'awaiting_bill_id' });
      await ctx.reply('لطفاً شناسه قبض ۱۳ رقمی را ارسال فرمایید:');
      return;
    }

    if (data === 'view_saved_bills') {
      const user = await storage.getUser(userId);
      const text = formatSavedBillsList(user.savedBills, user.activeBillId);
      const kb = getSavedBillsInlineKeyboard(user.savedBills, user.activeBillId);
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(async () => {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
      });
      return;
    }

    if (data === 'delete_bill_menu') {
      const user = await storage.getUser(userId);
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

    if (data.startsWith('delete_bill_do:')) {
      const billId = data.replace('delete_bill_do:', '');
      await storage.removeBillId(userId, billId);
      const user = await storage.getUser(userId);
      await ctx.reply(`🗑 شناسه قبض <code>${toPersianDigits(billId)}</code> از نشان‌شده‌ها حذف شد.`, {
        parse_mode: 'HTML',
        reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills)
      });
      const text = formatSavedBillsList(user.savedBills, user.activeBillId);
      const kb = getSavedBillsInlineKeyboard(user.savedBills, user.activeBillId);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
      return;
    }

    if (data.startsWith('toggle_notifications:')) {
      const enabled = data.split(':')[1] === '1';
      await storage.setNotifications(userId, enabled);
      const user = await storage.getUser(userId);
      const statusText = enabled ? '✅ اطلاع‌رسانی خودکار روزانه فعال شد.' : '🔕 اطلاع‌رسانی خودکار غیرفعال شد.';
      await ctx.reply(statusText, { reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills) });
      return;
    }

    if (data === 'back_to_main') {
      const user = await storage.getUser(userId);
      await ctx.reply('منوی اصلی:', { reply_markup: getPrivateReplyKeyboard(ctx, user.savedBills) });
      return;
    }
  });

  return { bot, storage };
}

async function executeScheduleLookup(ctx, storage, rawBillId, mode = 'all', isEdit = false, forceFresh = false) {
  try {
    const billId = toEnglishDigits(String(rawBillId || '')).replace(/\D/g, '');
    if (!billId || billId.length < 8) {
      await ctx.reply('❌ شناسه قبض نامعتبر است. لطفاً یک شناسه قبض ۱۳ رقمی معتبر ارسال کنید.');
      return;
    }

    const user = await storage.getUser(ctx.from.id);
    const savedBills = Array.isArray(user?.savedBills) ? user.savedBills : [];
    const savedItem = savedBills.find(b => b.billId === billId);
    const customLabel = savedItem ? savedItem.label : '';
    const isBookmarked = Boolean(savedItem);

    const result = await fetchGopedSchedule(billId, forceFresh, storage);
    const text = formatScheduleMessage(result, mode, customLabel);
    const replyMarkup = result.Code === 1 ? getScheduleInlineKeyboard(billId, mode, isBookmarked) : undefined;

    if (isEdit && ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      } catch (editErr) {
        const errMsg = String(editErr?.message || editErr?.description || '');
        if (errMsg.includes('message is not modified')) {
          await ctx.answerCallbackQuery({ text: '✅ اطلاعات هم‌اکنون بروز است.' }).catch(() => {});
        } else {
          await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
        }
      }
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  } catch (err) {
    console.error('[ExecuteScheduleLookup Error]:', err);
    let userNotice = 'پاسخی از سرور شرکت توزیع برق دریافت نشد.';
    const errMsg = String(err?.message || '');
    if (errMsg.includes('522') || errMsg.includes('502') || errMsg.includes('timed out') || errMsg.includes('abort') || errMsg.includes('fetch failed')) {
      userNotice = 'سرور شرکت توزیع نیروی برق استان گلستان (goped.ir) در حال حاضر با کندی یا قطعی موقت مواجه است.\nلطفاً چند لحظه بعد مجدداً تلاش فرمایید.';
    }
    const errText = `⚠️ <b>خطا در دریافت اطلاعات:</b>\n${userNotice}\n\n<i>برای تلاش مجدد روی دکمه زیر بزنید:</i>`;
    const retryKb = new InlineKeyboard().text('🔄 تلاش مجدد', `sched_refresh:${mode}:${billId}`);
    if (isEdit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(errText, { parse_mode: 'HTML', reply_markup: retryKb }).catch(async () => {
        await ctx.reply(errText, { parse_mode: 'HTML', reply_markup: retryKb });
      });
    } else {
      await ctx.reply(errText, { parse_mode: 'HTML', reply_markup: retryKb });
    }
  }
}

// ================= SCHEDULED NOTIFICATIONS CORE =================

async function runScheduledNotifications(env, bot, storage, force = false) {
  const todayGregorian = getIranGregorianDate(0);
  const todayJalali = getTodayJalali(0);
  const todayWeekday = getPersianWeekdayName(0);

  const allUsers = await storage.getAllUsers();
  const subscribed = allUsers.filter(u => u.notifications?.enabled !== false && u.savedBills?.length > 0);
  console.log(`[Scheduled] Checking ${subscribed.length} subscribed users for date ${todayJalali}`);

  let totalChecked = 0;
  let totalNotified = 0;
  let totalFailed = 0;

  for (const user of subscribed) {
    if (!force && user.notifications?.lastNotifiedDate === todayJalali) continue;
    totalChecked++;

    try {
      let hasTodayOutage = false;
      const alertMessages = [];

      for (const savedBill of user.savedBills) {
        const schedule = await fetchGopedSchedule(savedBill.billId, force, storage);
        if (schedule.Code !== 1 || !schedule.Result || !Array.isArray(schedule.Result.Blackouts)) continue;

        const todayBlackouts = schedule.Result.Blackouts.filter(b => {
          const info = parseDateInfo(b.Date || b.date);
          return info.gregorianStr === todayGregorian || info.jalaliStr === todayJalali;
        });

        if (todayBlackouts.length > 0) {
          hasTodayOutage = true;
          let billBlock = `🏷 <b>${savedBill.label}</b> (<code>${toPersianDigits(savedBill.billId)}</code>):\n`;
          todayBlackouts.forEach(b => {
            billBlock += formatBlackoutCard(b, true, false) + '\n';
          });
          alertMessages.push(billBlock);
        }
        await new Promise(r => setTimeout(r, 400));
      }

      if (hasTodayOutage && alertMessages.length > 0) {
        const fullAlert = `🚨 <b>هشدار خاموشی برق امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b>\n\n` +
          alertMessages.join('\n━━━━━━━━━━━━━━━━━━━━\n') +
          `\n<i>⚠️ لطفاً اقدامات لازم جهت مدیریت مصرف و وسایل برقی را انجام دهید.</i>`;

        await bot.api.sendMessage(user.userId, fullAlert, { parse_mode: 'HTML' });
        user.notifications = user.notifications || {};
        user.notifications.lastNotifiedDate = todayJalali;
        await storage.saveUser(user);
        totalNotified++;
        console.log(`[Scheduled] Notification sent to user ${user.userId}`);
      }
    } catch (err) {
      totalFailed++;
      console.error(`[Scheduled] Failed to notify user ${user.userId}:`, err.message);
    }
  }

  return { dateJalali: todayJalali, totalChecked, totalNotified, totalFailed };
}

// ================= EXPORTS (WEBHOOK & SCHEDULED CRON) =================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Ultra-Fast GOPED API Proxy for Railway
    if (url.pathname.startsWith('/proxy/')) {
      try {
        const subPath = url.pathname.replace(/^\/proxy\/?/, '');
        const targetUrl = new URL(subPath + url.search, GOPED_API_URL).toString();
        const apiRes = await fetch(targetUrl, {
          method: request.method,
          headers: {
            'Auth-Token': GOPED_AUTH_TOKEN,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        const body = await apiRes.text();
        return new Response(body, {
          status: apiRes.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ Code: 0, error: err.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Health check and root info
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'GOPED Electricity Outage Telegram Bot',
        platform: 'Cloudflare Workers (100% Serverless)',
        timestamp: new Date().toISOString(),
        iranDate: getTodayJalali(0)
      }, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Direct API proxy test endpoint
    if (url.pathname === '/test-api') {
      try {
        const billId = url.searchParams.get('billId') || '6357330214322';
        const storage = new CloudflareStorage(env.POWERBOT_KV);
        const data = await fetchGopedSchedule(billId, true, storage);
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Set Webhook & Commands Setup Endpoint
    if (url.pathname === '/setup' || url.pathname === '/set-webhook') {
      try {
        const { bot } = createBot(env, ctx);
        const webhookUrl = `${url.origin}/`;
        const setWebhookRes = await bot.api.setWebhook(webhookUrl, { drop_pending_updates: true });
        const setCommandsRes = await bot.api.setMyCommands([
          { command: 'start', description: 'شروع و منوی اصلی' },
          { command: 'check', description: 'استعلام قطعی برق (مثال: /check 1234567890123)' },
          { command: 'bookmarks', description: 'لیست و مدیریت قبض‌های نشان‌شده' },
          { command: 'bookmark', description: 'افزودن شناسه قبض جدید' },
          { command: 'notice', description: 'آخرین اطلاعیه‌های شرکت توزیع' },
          { command: 'shout', description: 'ارسال پیام همگانی به همه کاربران (ادمین)' },
          { command: 'users', description: 'مشاهده آمار و لیست کاربران (ادمین)' },
          { command: 'testnotif', description: 'تست ارسال هشدار روزانه (ادمین)' },
          { command: 'help', description: 'راهنما' }
        ]).catch(() => true);
        const info = await bot.api.getWebhookInfo();
        return new Response(JSON.stringify({
          success: true,
          setWebhook: setWebhookRes,
          setCommands: setCommandsRes,
          webhookInfo: info
        }, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Export all users endpoint
    if (url.pathname === '/export-all') {
      try {
        const { storage } = createBot(env, ctx);
        const users = await storage.getAllUsers();
        const stats = await storage.getStats();
        return new Response(JSON.stringify({ stats, users }, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Telegram Bot & Webhook Info
    if (url.pathname === '/info' || url.pathname === '/status') {
      try {
        const { bot, storage } = createBot(env, ctx);
        const info = await bot.api.getWebhookInfo();
        const me = await bot.api.getMe();
        const stats = await storage.getStats();
        return new Response(JSON.stringify({
          bot: me,
          webhook: info,
          stats
        }, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // Telegram Webhook Handler (POST)
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        const { bot } = createBot(env, ctx);
        await bot.handleUpdate(update);
        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('[Worker Update Error]:', err);
        return new Response('OK', { status: 200 });
      }
    }

    return new Response('OK', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    console.log('[Cron] Running daily scheduled outage check on Cloudflare Workers...');
    const token = env.BOT_TOKEN || '8931573991:AAEFAPuyGHGvKi8okFQFCKuHRUGqw6_fRDY';
    const bot = new Bot(token);
    const storage = new CloudflareStorage(env.POWERBOT_KV);
    await runScheduledNotifications(env, bot, storage, false);
  }
};

