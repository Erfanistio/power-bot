/**
 * Persian (Jalali / Solar Hijri) date and digit utilities.
 * Includes deterministic bidirectional Jalali <-> Gregorian calendar algorithms.
 */

// Persian weekday names (0 = Sunday, 1 = Monday, ..., 6 = Saturday in JavaScript getUTCDay())
const WEEKDAY_NAMES_MAP = {
  0: 'یکشنبه',
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنج‌شنبه',
  5: 'جمعه',
  6: 'شنبه'
};

// Convert Persian and Arabic digits to English digits
export function toEnglishDigits(str) {
  if (!str) return '';
  const strVal = String(str);
  const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  
  let result = strVal;
  for (let i = 0; i < 10; i++) {
    result = result.replaceAll(persianNumbers[i], i.toString());
    result = result.replaceAll(arabicNumbers[i], i.toString());
  }
  return result;
}

// Convert English digits to Persian digits
export function toPersianDigits(str) {
  if (str === null || str === undefined) return '';
  const strVal = String(str);
  const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return strVal.replace(/\d/g, d => persianNumbers[parseInt(d, 10)]);
}

/**
 * Normalizes Persian text by unifying Arabic/Persian letters and whitespace.
 */
export function normalizePersianText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width spaces
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/إ|أ|آ/g, 'ا')
    .trim();
}

/**
 * Deterministic Gregorian to Jalali conversion.
 */
export function gregorianToJalali(gy, gm, gd) {
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

/**
 * Deterministic Jalali to Gregorian conversion.
 */
export function jalaliToGregorian(jy, jm, jd) {
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

/**
 * Format time string (e.g., "11:00:00" -> "11:00")
 */
export function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return String(timeStr).trim();
}

/**
 * Gets current date/time in Asia/Tehran timezone.
 */
export function getTehranNow(offsetDays = 0) {
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

/**
 * Parses and converts any date string (Gregorian "2026-08-16" or Jalali "1405/05/25")
 * into normalized Jalali and Gregorian representations and Persian weekday.
 */
export function parseDateInfo(dateStr) {
  if (!dateStr) {
    return {
      jalaliStr: '',
      weekday: '',
      gregorianStr: '',
      isToday: false,
      isTomorrow: false,
      isYesterday: false,
      relativeLabel: ''
    };
  }

  const cleaned = toEnglishDigits(String(dateStr)).trim().split('T')[0].split(' ')[0];
  const parts = cleaned.replace(/[-.]/g, '/').split('/');
  
  let gy, gm, gd, jy, jm, jd;

  if (parts.length === 3) {
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    const p3 = parseInt(parts[2], 10);

    if (p1 > 1800) {
      // Gregorian: YYYY-MM-DD
      gy = p1;
      gm = p2;
      gd = p3;
      const j = gregorianToJalali(gy, gm, gd);
      jy = j.jy;
      jm = j.jm;
      jd = j.jd;
    } else {
      // Jalali: YYYY/MM/DD
      jy = p1;
      jm = p2;
      jd = p3;
      const g = jalaliToGregorian(jy, jm, jd);
      gy = g.gy;
      gm = g.gm;
      gd = g.gd;
    }
  } else {
    // Fallback: return cleaned string
    return {
      jalaliStr: cleaned,
      weekday: '',
      gregorianStr: cleaned,
      isToday: false,
      isTomorrow: false,
      isYesterday: false,
      relativeLabel: ''
    };
  }

  const gregorianStr = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  const jalaliStr = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;

  // Weekday calculation (using UTC Date to avoid local timezone skew)
  const dObj = new Date(Date.UTC(gy, gm - 1, gd, 12, 0, 0));
  const dayOfWeek = dObj.getUTCDay();
  const weekday = WEEKDAY_NAMES_MAP[dayOfWeek] || '';

  // Calculate relative day compared to current Tehran date
  const todayG = getIranGregorianDate(0);
  const tomorrowG = getIranGregorianDate(1);
  const yesterdayG = getIranGregorianDate(-1);

  const isToday = (gregorianStr === todayG);
  const isTomorrow = (gregorianStr === tomorrowG);
  const isYesterday = (gregorianStr === yesterdayG);

  let relativeLabel = '';
  if (isToday) relativeLabel = 'امروز';
  else if (isTomorrow) relativeLabel = 'فردا';
  else if (isYesterday) relativeLabel = 'دیروز';

  return {
    jalaliStr,
    weekday,
    gregorianStr,
    isToday,
    isTomorrow,
    isYesterday,
    relativeLabel
  };
}

/**
 * Gets current Gregorian date formatted as YYYY-MM-DD in Asia/Tehran timezone.
 */
export function getIranGregorianDate(offsetDays = 0) {
  const t = getTehranNow(offsetDays);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/**
 * Gets current Jalali date formatted as YYYY/MM/DD in Asia/Tehran timezone.
 */
export function getTodayJalali(offsetDays = 0) {
  const gStr = getIranGregorianDate(offsetDays);
  return parseDateInfo(gStr).jalaliStr;
}

/**
 * Gets current Persian weekday name (e.g. شنبه، یکشنبه، ...) in Asia/Tehran timezone.
 */
export function getPersianWeekdayName(offsetDays = 0) {
  const gStr = getIranGregorianDate(offsetDays);
  return parseDateInfo(gStr).weekday;
}

/**
 * Formats current Tehran time (e.g. "14:30")
 */
export function getCurrentTehranTimeShort() {
  const t = getTehranNow(0);
  return `${t.hour}:${t.minute}`;
}
