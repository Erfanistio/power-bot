import { config } from '../config.js';
import { toEnglishDigits, getCurrentTehranTimeShort, parseDateInfo } from '../utils/persianDate.js';

export class GopedApiClient {
  constructor(baseUrl = config.apiUrl, authToken = config.authToken, timeoutMs = config.apiTimeoutMs) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.authToken = authToken;
    this.timeoutMs = timeoutMs || 12000;
  }

  /**
   * No cache - always returns false.
   */
  hasFreshCache() {
    return false;
  }

  /**
   * No-op warmup since caching is disabled.
   */
  warmupBills() {
    // No-op
  }

  /**
   * Sanitizes and extracts English numeric Bill ID.
   */
  cleanBillId(rawBillId) {
    if (!rawBillId) return '';
    const englishStr = toEnglishDigits(String(rawBillId));
    return englishStr.replace(/\D/g, '').trim();
  }

  /**
   * Clears the in-memory cache.
   */
  clearCache() {
    // No-op
  }

  /**
   * Performs an HTTP request with strict 5s timeout and keepalive.
   */
  async _fetch(endpoint, options = {}, retries = 0) {
    const url = new URL(endpoint, this.baseUrl).toString();
    const headers = {
      'Auth-Token': this.authToken,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; TelegramBot/2.0)',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'fa,en;q=0.9',
      'Connection': 'keep-alive',
      ...(options.headers || {})
    };

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          // Progressive backoff delay
          await new Promise(r => setTimeout(r, (attempt + 1) * 700));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Fetch outage / blackout schedules for a given Bill ID.
   *
   * @param {string} rawBillId - Electricity Bill ID (شناسه قبض)
   * @param {boolean} forceFresh - If true, bypass cache and fetch directly from GOPED API
   */
  async getSchedule(rawBillId) {
    const billId = this.cleanBillId(rawBillId);
    if (!billId) {
      return {
        success: false,
        code: -1,
        message: 'شناسه قبض وارد نشده یا نامعتبر است.',
        blackouts: []
      };
    }

    try {
      const data = await this._fetch(`Api/GetSchedule_Web?BillId=${encodeURIComponent(billId)}`);
      
      if (!data || data.Code !== 1 || !data.Result) {
        return {
          success: false,
          code: data?.Code || -1,
          message: data?.Description || 'شناسه قبض یافت نشد یا برنامه‌ای برای آن ثبت نشده است.',
          blackouts: []
        };
      }

      const result = data.Result;
      const customer = result.Customer ? {
        billId: result.Customer.BillId || billId,
        name: (result.Customer.Name || '').trim(),
        mobile: result.Customer.Mobile || '',
        feederId: result.Customer.FeederId || '',
        desc: result.Customer.Desc || '',
        distributionTitle: (result.Customer.DistributionTitle || '').trim()
      } : null;

      const rawBlackouts = Array.isArray(result.Blackouts) ? result.Blackouts : [];
      const blackouts = rawBlackouts.map(b => {
        const dateRaw = b.Date || b.date || '';
        return {
          date: dateRaw,
          from: (b.From || b.from || '').trim(),
          to: (b.To || b.to || '').trim(),
          reserve1From: (b.Reserve1From || b.reserve1From || '').trim(),
          reserve1To: (b.Reserve1To || b.reserve1To || '').trim(),
          reserve2From: (b.Reserve2From || b.reserve2From || '').trim(),
          reserve2To: (b.Reserve2To || b.reserve2To || '').trim(),
          persianDateLastBlackout: b.PersianDateLastBlackout || result.PersianDateLastBlackout || ''
        };
      });

      // Sort blackouts chronologically
      blackouts.sort((a, b) => {
        const infoA = parseDateInfo(a.date);
        const infoB = parseDateInfo(b.date);
        const dateCmp = infoA.gregorianStr.localeCompare(infoB.gregorianStr);
        if (dateCmp !== 0) return dateCmp;
        return (a.from || '').localeCompare(b.from || '');
      });

      const formattedResult = {
        success: true,
        code: 1,
        customer,
        blackouts,
        queryTime: getCurrentTehranTimeShort(),
        persianDateLastBlackout: result.PersianDateLastBlackout || ''
      };

      return formattedResult;
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || String(err.message).toLowerCase().includes('abort') || String(err.message).toLowerCase().includes('timeout');
      const message = isTimeout
        ? '⏱ متأسفانه سرور شرکت توزیع برق در این لحظه پاسخ نداد. لطفاً لحظاتی بعد مجدداً تلاش کنید.'
        : `خطا در ارتباط با سرور شرکت توزیع برق: ${err.message}`;

      return {
        success: false,
        code: -500,
        message,
        blackouts: []
      };
    }
  }

  /**
   * Fetch customer information for a given Bill ID.
   */
  async getCustomer(rawBillId) {
    const billId = this.cleanBillId(rawBillId);
    if (!billId) {
      return {
        success: false,
        code: -1,
        message: 'شناسه قبض وارد نشده است.'
      };
    }

    try {
      const data = await this._fetch(`Api/GetCustomer_Web?BillId=${encodeURIComponent(billId)}`);
      if (!data || data.Code !== 1 || !data.Result) {
        return {
          success: false,
          code: data?.Code || -1,
          message: data?.Description || 'اطلاعات مشترک یافت نشد.'
        };
      }

      return {
        success: true,
        code: 1,
        customer: data.Result
      };
    } catch (err) {
      return {
        success: false,
        code: -500,
        message: `خطا در دریافت مشخصات مشترک: ${err.message}`
      };
    }
  }

  /**
   * Fetch the latest public announcement / notice from GOPED.
   */
  async getNotice() {
    try {
      const data = await this._fetch('Api/GetNotice');
      if (data && data.Code === 1 && data.Result) {
        const rawHtml = data.Result;
        const cleanText = rawHtml
          .replace(/<br\s*[\/]?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\n\s*\n/g, '\n\n')
          .trim();

        const result = {
          success: true,
          html: rawHtml,
          text: cleanText,
          queryTime: getCurrentTehranTimeShort()
        };

        return result;
      }

      return {
        success: false,
        message: 'اطلاعیه‌ای یافت نشد.'
      };
    } catch (err) {
      return {
        success: false,
        message: `خطا در دریافت اطلاعیه: ${err.message}`
      };
    }
  }
}

export const gopedApi = new GopedApiClient();


