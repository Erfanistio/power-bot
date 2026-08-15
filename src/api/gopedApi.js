import { config } from '../config.js';
import { toEnglishDigits } from '../utils/persianDate.js';

export class GopedApiClient {
  constructor(baseUrl = config.apiUrl, authToken = config.authToken, timeoutMs = config.apiTimeoutMs) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.authToken = authToken;
    this.timeoutMs = timeoutMs;
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
   * Performs an HTTP request with timeout and retry logic.
   */
  async _fetch(endpoint, options = {}, retries = 2) {
    const url = new URL(endpoint, this.baseUrl).toString();
    const headers = {
      'Auth-Token': this.authToken,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; TelegramBot)',
      'Accept': 'application/json',
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
          // Exponential backoff
          await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Fetch outage / blackout schedules for a given Bill ID.
   *
   * @param {string} billId - Electricity Bill ID (شناسه قبض)
   * @returns {Promise<{
   *   success: boolean,
   *   code: number,
   *   message?: string,
   *   customer?: {
   *     billId: string,
   *     name: string,
   *     mobile: string,
   *     feederId: string,
   *     desc: string,
   *     distributionTitle: string
   *   },
   *   blackouts: Array<{
   *     date: string,
   *     from: string,
   *     to: string,
   *     reserve1From?: string,
   *     reserve1To?: string,
   *     reserve2From?: string,
   *     reserve2To?: string,
   *     persianDateLastBlackout?: string
   *   }>
   * }>}
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
      
      if (data.Code !== 1 || !data.Result) {
        return {
          success: false,
          code: data.Code,
          message: data.Description || 'شناسه قبض یافت نشد یا برنامه‌ای ثبت نشده است.',
          blackouts: []
        };
      }

      const result = data.Result;
      const customer = result.Customer ? {
        billId: result.Customer.BillId || billId,
        name: result.Customer.Name || '',
        mobile: result.Customer.Mobile || '',
        feederId: result.Customer.FeederId || '',
        desc: result.Customer.Desc || '',
        distributionTitle: result.Customer.DistributionTitle || ''
      } : null;

      const rawBlackouts = Array.isArray(result.Blackouts) ? result.Blackouts : [];
      const blackouts = rawBlackouts.map(b => ({
        date: b.Date || '',
        from: b.From || '',
        to: b.To || '',
        reserve1From: b.Reserve1From || '',
        reserve1To: b.Reserve1To || '',
        reserve2From: b.Reserve2From || '',
        reserve2To: b.Reserve2To || '',
        persianDateLastBlackout: b.PersianDateLastBlackout || ''
      }));

      return {
        success: true,
        code: 1,
        customer,
        blackouts
      };
    } catch (err) {
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
      if (data.Code !== 1 || !data.Result) {
        return {
          success: false,
          code: data.Code,
          message: data.Description || 'اطلاعات مشترک یافت نشد.'
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
      if (data.Code === 1 && data.Result) {
        // Strip HTML tags for clean text display if needed, or keep for formatting
        const rawHtml = data.Result;
        const cleanText = rawHtml
          .replace(/<br\s*[\/]?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();

        return {
          success: true,
          html: rawHtml,
          text: cleanText
        };
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
