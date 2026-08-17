import { config } from '../config.js';
import { toEnglishDigits, getCurrentTehranTimeShort, parseDateInfo } from '../utils/persianDate.js';

export class GopedApiClient {
  constructor(baseUrl = config.apiUrl, authToken = config.authToken, timeoutMs = config.apiTimeoutMs) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.authToken = authToken;
    this.timeoutMs = timeoutMs || 12000;
    // In-memory store: billId -> { data, timestamp }
    this._store = new Map();
    // Deduplication of in-flight promises
    this._inFlight = new Map();
  }

  /**
   * Check if we have instant data ready in memory.
   */
  hasData(rawBillId) {
    const billId = this.cleanBillId(rawBillId);
    return this._store.has(billId);
  }

  /**
   * Pre-fetches schedule data for multiple bills in the background.
   */
  async warmupBills(billIds = []) {
    if (!Array.isArray(billIds)) return;
    const cleanIds = billIds.map(id => this.cleanBillId(id)).filter(Boolean);
    const toWarm = cleanIds.filter(id => !this.hasData(id));
    if (toWarm.length === 0) return;
    Promise.allSettled(toWarm.map(id => this.getSchedule(id))).catch(() => {});
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
   * Performs an HTTP request with strict timeout and keepalive.
   */
  async _fetch(endpoint, options = {}) {
    const url = new URL(endpoint, this.baseUrl).toString();
    const headers = {
      'Auth-Token': this.authToken,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; TelegramBot/2.0)',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'fa,en;q=0.9',
      'Connection': 'keep-alive',
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Fetch outage schedules with SWR (Instant memory return + Background revalidate).
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

    // Instant return if data exists and not explicitly forcing live reload
    if (!forceFresh && this._store.has(billId)) {
      const entry = this._store.get(billId);
      // Trigger silent background update if older than 90 seconds
      if (Date.now() - entry.timestamp > 90 * 1000) {
        this.fetchFresh(billId).catch(() => {});
      }
      return { ...entry.data, isInstant: true };
    }

    return this.fetchFresh(billId);
  }

  /**
   * Performs live network fetch from GOPED with deduplication.
   */
  async fetchFresh(billId) {
    // If request already in-flight for this bill, share the promise
    if (this._inFlight.has(billId)) {
      return this._inFlight.get(billId);
    }

    const fetchPromise = (async () => {
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

        // Store in memory
        this._store.set(billId, {
          timestamp: Date.now(),
          data: formattedResult
        });

        return formattedResult;
      } catch (err) {
        // If error but old data exists in store, return old data
        if (this._store.has(billId)) {
          return { ...this._store.get(billId).data, isInstant: true };
        }

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
      } finally {
        this._inFlight.delete(billId);
      }
    })();

    this._inFlight.set(billId, fetchPromise);
    return fetchPromise;
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
