import cron from 'node-cron';
import { gopedApi } from '../api/gopedApi.js';
import { db } from '../db/database.js';
import { config } from '../config.js';
import {
  getTodayJalali,
  getIranGregorianDate,
  parseDateInfo,
  toPersianDigits,
  getPersianWeekdayName,
  formatTimeShort
} from '../utils/persianDate.js';
import { formatBlackoutCard } from '../bot/formatters.js';

export class OutageNotificationService {
  constructor(bot) {
    this.bot = bot;
    this.cronTask = null;
    this.heartbeatTimer = null;
    this.isRunning = false;
  }

  start() {
    // Standardize cron: if legacy 30 4 * * * (UTC), convert to 0 8 * * * (Tehran)
    let cronPattern = config.notificationCron || '0 8 * * *';
    if (cronPattern === '30 4 * * *') {
      cronPattern = '0 8 * * *';
    }

    console.log(`[Notifier] Starting daily notification service with schedule: "${cronPattern}" (Timezone: Asia/Tehran)`);

    try {
      this.cronTask = cron.schedule(
        cronPattern,
        async () => {
          console.log('[Notifier] ⏰ Running scheduled daily outage notification check...');
          await this.checkAndNotifyAll();
        },
        {
          timezone: 'Asia/Tehran'
        }
      );
    } catch (err) {
      console.error('[Notifier] Failed to schedule cron with timezone, falling back:', err.message);
      this.cronTask = cron.schedule(cronPattern, async () => {
        await this.checkAndNotifyAll();
      });
    }

    // Start keep-alive heartbeat to prevent sleep and maintain warm connections
    this.startHeartbeat();
  }

  startHeartbeat() {
    // Ping every 7 minutes to keep DNS, TLS sockets, and API warm
    this.heartbeatTimer = setInterval(async () => {
      try {
        await gopedApi.getNotice(false);
      } catch {
        // Silent warmup ping
      }
    }, 7 * 60 * 1000);
    // Unref so timer does not prevent process exit if needed
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      console.log('[Notifier] Notification service stopped.');
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Check outage schedules and notify users.
   * @param {boolean} forceAll - If true, bypass lastNotifiedDate check
   * @param {string|number|null} targetUserId - If specified, check only this user
   */
  async checkAndNotifyAll(forceAll = false, targetUserId = null) {
    if (this.isRunning) {
      console.log('[Notifier] A check job is already running. Skipping concurrent run.');
      return { totalChecked: 0, totalNotified: 0, totalFailed: 0, alreadyRunning: true };
    }

    this.isRunning = true;
    const todayGregorian = getIranGregorianDate(0);
    const todayJalali = getTodayJalali(0);
    const todayWeekday = getPersianWeekdayName(0);

    let users = [];
    if (targetUserId) {
      const single = db.getUser(targetUserId);
      if (single) users = [single];
    } else {
      users = db.getAllSubscribedUsers();
    }

    console.log(`[Notifier] Checking ${users.length} user(s) for date ${todayJalali} (${todayGregorian})`);

    let totalNotified = 0;
    let totalFailed = 0;

    for (const user of users) {
      // Skip if already notified today (unless forced)
      if (!forceAll && user.notifications?.lastNotifiedDate === todayJalali) {
        continue;
      }

      if (!user.savedBills || user.savedBills.length === 0) {
        continue;
      }

      try {
        let hasTodayOutage = false;
        const alertBlocks = [];

        for (const savedBill of user.savedBills) {
          const schedule = await gopedApi.getSchedule(savedBill.billId);
          if (!schedule || !schedule.success || !schedule.blackouts || schedule.blackouts.length === 0) {
            continue;
          }

          const todayBlackouts = schedule.blackouts.filter(b => {
            const info = parseDateInfo(b.date);
            const isMatch = info.isToday || info.gregorianStr === todayGregorian || info.jalaliStr === todayJalali;
            if (!isMatch) return false;

            // Exclude empty blackout placeholders ("00:00" to "00:00")
            const fromShort = formatTimeShort(b.from);
            const toShort = formatTimeShort(b.to);
            if (fromShort === '00:00' && toShort === '00:00') return false;

            return true;
          });

          if (todayBlackouts.length > 0) {
            hasTodayOutage = true;
            let billBlock = `🏷 <b>${savedBill.label}</b> (<code>${toPersianDigits(savedBill.billId)}</code>):\n`;
            todayBlackouts.forEach(b => {
              billBlock += formatBlackoutCard(b, true, false) + '\n';
            });
            alertBlocks.push(billBlock);
          }

          // Delay between API calls to avoid rate limiting
          await new Promise(r => setTimeout(r, 400));
        }

        if (hasTodayOutage && alertBlocks.length > 0) {
          const fullAlert = `🚨 <b>هشدار خاموشی برق امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b>\n\n` +
            alertBlocks.join('\n━━━━━━━━━━━━━━━━━━━━\n') +
            `\n<i>⚠️ لطفاً تمهیدات لازم جهت مدیریت مصرف و حفاظت از لوازم برقی را در نظر داشته باشید.</i>`;

          try {
            await this.bot.api.sendMessage(user.userId, fullAlert, { parse_mode: 'HTML' });
            db.setLastNotifiedDate(user.userId, todayJalali);
            totalNotified++;
            console.log(`[Notifier] Alert successfully sent to user ${user.userId}`);
          } catch (sendErr) {
            const desc = sendErr.description || sendErr.message || '';
            if (desc.includes('bot was blocked') || desc.includes('user is deactivated') || desc.includes('chat not found')) {
              console.warn(`[Notifier] User ${user.userId} blocked bot or account deactivated. Disabling notifications.`);
              db.setNotifications(user.userId, false);
            } else {
              console.error(`[Notifier] Error sending message to user ${user.userId}:`, desc);
            }
            totalFailed++;
          }
        }
      } catch (err) {
        console.error(`[Notifier] Failed to process user ${user.userId}:`, err.message);
        totalFailed++;
      }

      // Small delay between users
      await new Promise(r => setTimeout(r, 100));
    }

    this.isRunning = false;
    console.log(`[Notifier] Notification check finished. Sent: ${totalNotified}, Failed/Skipped: ${totalFailed}`);
    return {
      totalChecked: users.length,
      totalNotified,
      totalFailed,
      dateJalali: todayJalali
    };
  }
}

