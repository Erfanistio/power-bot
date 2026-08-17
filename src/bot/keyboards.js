import { InlineKeyboard, Keyboard } from 'grammy';
import { toPersianDigits } from '../utils/persianDate.js';

/**
 * Main persistent Reply Keyboard menu with dynamic Bookmarks on top.
 * @param {Array<{ billId: string, label: string }>} savedBills
 */
export function getMainReplyKeyboard(savedBills = []) {
  const kb = new Keyboard();

  // If user has bookmarked bills, place them directly on the top row(s) for 1-tap query
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

  kb.text('🏠 صفحه اصلی')
    .row()
    .text('⚡️ خاموشی امروز').text('🗓 خاموشی فردا')
    .row()
    .text('📋 کل برنامه هفتگی').text('🔖 نشان‌شده‌های من')
    .row()
    .text('🔔 هشدار خودکار').text('📢 اطلاعیه‌ها')
    .row()
    .text('➕ افزودن نشان جدید').text('ℹ️ راهنما')
    .resized();

  return kb;
}

/**
 * Inline keyboard shown under /start message when the user has NO bookmarks yet.
 * Once a bookmark is saved, this inline keyboard will not be shown.
 * @param {Array<{ billId: string, label: string }>} savedBills
 */
export function getStartInlineKeyboard(savedBills = []) {
  if (!savedBills || savedBills.length === 0) {
    return {
      inline_keyboard: [
        [
          {
            text: '🎟️ 📌 افزودن اولین بوکمارک ➕',
            callback_data: 'add_bill_prompt',
            style: 'primary'
          }
        ]
      ]
    };
  }
  return undefined;
}

/**
 * Inline keyboard attached below a schedule query message.
 */
export function getScheduleInlineKeyboard(billId, currentMode = 'all', isBookmarked = false) {
  const kb = new InlineKeyboard();

  if (currentMode !== 'today') {
    kb.text('⚡️ امروز', `sched:today:${billId}`);
  }
  if (currentMode !== 'tomorrow') {
    kb.text('🗓 فردا', `sched:tomorrow:${billId}`);
  }
  if (currentMode !== 'all') {
    kb.text('📋 کل جدول', `sched:all:${billId}`);
  }

  kb.row();
  kb.text('🔄 بروزرسانی', `sched_refresh:${currentMode}:${billId}`);

  if (!isBookmarked) {
    kb.text('🔖 نشان کردن این قبض', `save_prompt:${billId}`);
  } else {
    kb.text('✏️ تغییر نام', `rename_prompt:${billId}`);
    kb.text('🗑 حذف نشان', `delete_bill_do:${billId}`);
  }

  return kb;
}

/**
 * Inline keyboard for managing bookmarked bills.
 */
export function getSavedBillsInlineKeyboard(savedBills = [], activeBillId = null) {
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

/**
 * Inline keyboard for renaming a bookmark.
 */
export function getRenameBillsInlineKeyboard(savedBills = []) {
  const kb = new InlineKeyboard();

  savedBills.forEach(b => {
    kb.text(`✏️ ${b.label}`, `rename_prompt:${b.billId}`).row();
  });

  kb.text('🔙 بازگشت', 'view_saved_bills');
  return kb;
}

/**
 * Inline keyboard for deleting a bookmarked bill.
 */
export function getDeleteBillsInlineKeyboard(savedBills = []) {
  const kb = new InlineKeyboard();

  savedBills.forEach(b => {
    kb.text(`🗑 حذف ${b.label}`, `delete_bill_do:${b.billId}`).row();
  });

  kb.text('🔙 بازگشت', 'view_saved_bills');
  return kb;
}

/**
 * Inline keyboard for notification settings.
 */
export function getNotificationSettingsKeyboard(isEnabled = true) {
  const kb = new InlineKeyboard();
  const toggleText = isEnabled ? '🔕 غیرفعال‌سازی اطلاع‌رسانی روزانه' : '🔔 فعال‌سازی اطلاع‌رسانی روزانه';
  kb.text(toggleText, `toggle_notifications:${isEnabled ? '0' : '1'}`).row();
  kb.text('🔙 بازگشت به منوی اصلی', 'back_to_main');
  return kb;
}
