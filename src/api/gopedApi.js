import { config } from '../config.js';
import { toEnglishDigits, getCurrentTehranTimeShort, parseDateInfo } from '../utils/persianDate.js';

export class GopedApiClient {
  constructor(baseUrl = config.apiUrl, authToken = config.authToken, timeoutMs = config.apiTimeoutMs) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.authToken = authToken;
    this.timeoutMs = timeoutMs || 15000;
    // In-memory cache: billId -> { timestamp, data }
    this._scheduleCache = new Map();
    this._noticeCache = null;
    this.cacheTtlMs = 4 * 60 * 1000; // 4 minutes cache TTL
    this.noticeTtlMs = 10 * 60 * 1000; // 10 minutes notice TTL
  }

  /**
   * Checks if valid unexpired cache is available for this bill.
   */
  hasFreshCache(rawBillId) {
    const billId = this.cleanBillId(rawBillId);
    const cached = this._scheduleCache.get(billId);
    if (!cached || !cached.data) return false;
    return (Date.now() - cached.timestamp < this.cacheTtlMs);
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
  clearCache(billId = null) {
    if (billId) {
      this._scheduleCache.delete(this.cleanBillId(billId));
    } else {
      this._scheduleCache.clear();
      this._noticeCache = null;
    }
  }

  /**
   * Performs an HTTP request with timeout, keepalive, and progressive retry logic.
   */
  async _fetch(endpoint, options = {}, retries = 2) {
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
  async getSchedule(rawBillId, forceFresh = false) {
    const billId = this.cleanBillId(rawBillId);
    if (!billId) {
      return {
        success: false,
        code: -1,
        message: 'شناسه قبض وارد نشده یا نامعتبر است.',
        blackouts: []
      };
    }

    // Check cache if not forcing fresh request
    const now = Date.now();
    const cached = this._scheduleCache.get(billId);
    if (!forceFresh && cached && (now - cached.timestamp < this.cacheTtlMs)) {
      return { ...cached.data, fromCache: true };
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

      // Save in cache
      this._scheduleCache.set(billId, {
        timestamp: now,
        data: formattedResult
      });

      return formattedResult;
    } catch (err) {
      // If live request failed but we have stale cache, return it with a notice
      if (cached && cached.data) {
        return {
          ...cached.data,
          fromCache: true,
          isStale: true,
          warningMessage: '⚠️ سرور پاسخ نداد؛ اطلاعات نمایش داده شده مربوط به آخرین استعلام قبلی است.'
        };
      }

      return {
        success: false,
        code: -500,
        message: `خطا در ارتباط با سرور شرکت توزیع برق: ${err.message}`,
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
  async getNotice(forceFresh = false) {
    const now = Date.now();
    if (!forceFresh && this._noticeCache && (now - this._noticeCache.timestamp < this.noticeTtlMs)) {
      return this._noticeCache.data;
    }

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

        this._noticeCache = {
          timestamp: now,
          data: result
        };

        return result;
      }

      return {
        success: false,
        message: 'اطلاعیه‌ای یافت نشد.'
      };
    } catch (err) {
      if (this._noticeCache && this._noticeCache.data) {
        return this._noticeCache.data;
      }
      return {
        success: false,
        message: `خطا در دریافت اطلاعیه: ${err.message}`
      };
    }
  }
}

export const gopedApi = new GopedApiClient();


