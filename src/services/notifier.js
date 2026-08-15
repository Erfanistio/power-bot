import cron from 'node-cron';
import { gopedApi } from '../api/gopedApi.js';
import { db } from '../db/database.js';
import { config } from '../config.js';
import { getTodayJalali, getIranGregorianDate, parseDateInfo, toPersianDigits, getPersianWeekdayName } from '../utils/persianDate.js';
import { formatBlackoutCard } from '../bot/formatters.js';

export class OutageNotificationService {
  constructor(bot) {
    this.bot = bot;
    this.cronTask = null;
  }

  start() {
    console.log(`[Notifier] Starting daily notification service with schedule: ${config.notificationCron}`);
    this.cronTask = cron.schedule(config.notificationCron, async () => {
      console.log('[Notifier] Running daily outage check job...');
      await this.checkAndNotifyAll();
    });
  }

  stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      console.log('[Notifier] Notification service stopped.');
    }
  }

  async checkAndNotifyAll() {
    const todayGregorian = getIranGregorianDate(0);
    const todayJalali = getTodayJalali(0);
    const todayWeekday = getPersianWeekdayName(0);
    const users = db.getAllSubscribedUsers();
    console.log(`[Notifier] Checking ${users.length} subscribed users for date ${todayJalali}`);

    for (const user of users) {
      // Check if user was already notified today
      if (user.notifications.lastNotifiedDate === todayJalali) {
        continue;
      }

      try {
        let hasTodayOutage = false;
        let alertMessages = [];

        for (const savedBill of user.savedBills) {
          const schedule = await gopedApi.getSchedule(savedBill.billId);
          if (!schedule.success || !schedule.blackouts || schedule.blackouts.length === 0) {
            continue;
          }

          const todayBlackouts = schedule.blackouts.filter(b => {
            const info = parseDateInfo(b.date);
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

          // Polite delay between API calls
          await new Promise(r => setTimeout(r, 600));
        }

        if (hasTodayOutage && alertMessages.length > 0) {
          const fullAlert = `🚨 <b>هشدار خاموشی برق امروز (${todayWeekday} - ${toPersianDigits(todayJalali)}):</b>\n\n` +
            alertMessages.join('\n━━━━━━━━━━━━━━━━━━━━\n') +
            `\n<i>⚠️ لطفاً اقدامات لازم جهت مدیریت مصرف و وسایل برقی را انجام دهید.</i>`;

          await this.bot.api.sendMessage(user.userId, fullAlert, { parse_mode: 'HTML' });
          db.setLastNotifiedDate(user.userId, todayJalali);
          console.log(`[Notifier] Alert sent to user ${user.userId}`);
        }
      } catch (err) {
        console.error(`[Notifier] Failed to process notifications for user ${user.userId}:`, err.message);
      }
    }
  }
}
