/**
 * Persian (Jalali / Solar Hijri) date and digit utilities.
 */

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
 * Format time string (e.g., "11:00:00" -> "11:00")
 */
export function formatTimeShort(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return timeStr;
}

/**
 * Parses and converts any date string (Gregorian "2026-08-15" or Jalali "1405/05/24")
 * into normalized Jalali and Gregorian representations and Persian weekday.
 */
export function parseDateInfo(dateStr) {
  if (!dateStr) return { jalaliStr: '', weekday: '', gregorianStr: '' };
  const cleaned = toEnglishDigits(String(dateStr)).trim().split('T')[0].split(' ')[0];
  const parts = cleaned.replace(/[-.]/g, '/').split('/');
  
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);

    if (y > 1800) {
      // Gregorian date from API -> convert to Jalali using Intl
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
      // Already Jalali
      return {
        jalaliStr: `${String(y).padStart(4, '0')}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
        weekday: '',
        gregorianStr: ''
      };
    }
  }

  return { jalaliStr: cleaned, weekday: '', gregorianStr: cleaned };
}

/**
 * Gets current Gregorian date formatted as YYYY-MM-DD in Asia/Tehran timezone.
 */
export function getIranGregorianDate(offsetDays = 0) {
  const now = new Date();
  const d = new Date(now.getTime() + (offsetDays * 24 * 60 * 60 * 1000));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d).split('-');
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
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
