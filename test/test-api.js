import {
  toEnglishDigits,
  toPersianDigits,
  getTodayJalali,
  getIranGregorianDate,
  getPersianWeekdayName,
  parseDateInfo,
  formatTimeShort,
  normalizePersianText,
  gregorianToJalali,
  jalaliToGregorian
} from '../src/utils/persianDate.js';
import { db } from '../src/db/database.js';
import { gopedApi } from '../src/api/gopedApi.js';
import { formatScheduleMessage, formatNoticeMessage, formatBlackoutCard } from '../src/bot/formatters.js';
import { getChatTargetId, isGroupChat, parseNotificationSetting, registerBotHandlers } from '../src/bot/handlers.js';
import { getScheduleInlineKeyboard } from '../src/bot/keyboards.js';
import { OutageNotificationService } from '../src/services/notifier.js';

async function runTests() {
  console.log('🧪 Running Comprehensive Power Bot Test Suite...\n');

  // Test 1: Persian Number Conversion & Text Normalization
  console.log('Test 1: Digits & Text Normalization');
  const persianSample = '۱۲۳۴۵۶۷۸۹۰';
  const eng = toEnglishDigits(persianSample);
  if (eng !== '1234567890') throw new Error(`toEnglishDigits failed: ${eng}`);
  const backToPersian = toPersianDigits('1234567890');
  if (backToPersian !== persianSample) throw new Error(`toPersianDigits failed: ${backToPersian}`);

  const rawText = 'مغازه‌ي علي كاشاني';
  const normText = normalizePersianText(rawText);
  if (normText !== 'مغازهی علی کاشانی') throw new Error(`normalizePersianText failed: ${normText}`);
  console.log('  ✅ Digits and text normalization passed.\n');

  // Test 2: Deterministic Bidirectional Calendar Calculations
  console.log('Test 2: Calendar Conversions (Jalali <-> Gregorian)');
  const sampleG = { gy: 2026, gm: 8, gd: 16 };
  const jRes = gregorianToJalali(sampleG.gy, sampleG.gm, sampleG.gd);
  if (jRes.jy !== 1405 || jRes.jm !== 5 || jRes.jd !== 25) {
    throw new Error(`gregorianToJalali failed: ${JSON.stringify(jRes)}`);
  }
  const gBack = jalaliToGregorian(jRes.jy, jRes.jm, jRes.jd);
  if (gBack.gy !== 2026 || gBack.gm !== 8 || gBack.gd !== 16) {
    throw new Error(`jalaliToGregorian failed: ${JSON.stringify(gBack)}`);
  }
  console.log('  ✅ 2026-08-16 <-> 1405/05/25 bidirectional conversion passed.');

  // Test 3: parseDateInfo across various string formats
  console.log('Test 3: parseDateInfo Variations');
  const parsedG = parseDateInfo('2026-08-16');
  if (parsedG.jalaliStr !== '1405/05/25' || parsedG.weekday !== 'یکشنبه' || parsedG.gregorianStr !== '2026-08-16') {
    throw new Error(`parseDateInfo for Gregorian failed: ${JSON.stringify(parsedG)}`);
  }

  const parsedJ = parseDateInfo('1405/05/25');
  if (parsedJ.jalaliStr !== '1405/05/25' || parsedJ.weekday !== 'یکشنبه' || parsedJ.gregorianStr !== '2026-08-16') {
    throw new Error(`parseDateInfo for Jalali failed: ${JSON.stringify(parsedJ)}`);
  }

  const parsedJUnpadded = parseDateInfo('1405/5/25');
  if (parsedJUnpadded.jalaliStr !== '1405/05/25' || parsedJUnpadded.weekday !== 'یکشنبه') {
    throw new Error(`parseDateInfo for unpadded Jalali failed: ${JSON.stringify(parsedJUnpadded)}`);
  }
  console.log('  ✅ parseDateInfo handles Gregorian, Jalali & unpadded formats seamlessly.\n');

  // Test 4: Database operations & Active Bill Healing
  console.log('Test 4: Database Operations & Active Bill Healing');
  const testUserId = 900000000000 + process.pid;
  db.deleteUser(testUserId);
  const user = db.getUser(testUserId);
  if (!user || user.userId !== String(testUserId)) throw new Error('getUser failed');

  db.addBillId(testUserId, '۱۲۳۴۵۶۷۸۹۰۱۲۳', '🏠 خانه تستی');
  db.addBillId(testUserId, '9876543210123', '🏢 دفتر تستی');
  
  const updatedUser = db.getUser(testUserId);
  if (updatedUser.savedBills.length < 2) throw new Error('addBillId failed');
  if (!updatedUser.activeBillId) throw new Error('activeBillId is not set');

  db.removeBillId(testUserId, '9876543210123');
  const afterRemove = db.getUser(testUserId);
  if (afterRemove.savedBills.some(b => b.billId === '9876543210123')) throw new Error('removeBillId failed');
  db.deleteUser(testUserId);
  console.log('  ✅ Database bookmark management & activeBillId auto-healing passed.\n');

  // Test 5: Group-scoped storage and notification controls
  console.log('Test 5: Group Storage & Notification Controls');
  const testGroupId = -100999888777;
  db.deleteUser(testGroupId);
  const group = db.getUser(testGroupId);
  if (!group.isGroup) throw new Error('Negative Telegram chat ID was not recognized as a group');

  db.addBillId(testGroupId, '1234567890123', 'ساختمان تست');
  db.setNotifications(testGroupId, true);
  const savedGroup = db.getUser(testGroupId);
  if (savedGroup.activeBillId !== '1234567890123') throw new Error('Group active bill was not saved');
  if (!db.getAllSubscribedUsers().some(item => item.userId === String(testGroupId))) {
    throw new Error('Subscribed group was not included in cron targets');
  }

  const groupCtx = { chat: { id: testGroupId, type: 'supergroup' }, from: { id: testUserId } };
  if (!isGroupChat(groupCtx) || getChatTargetId(groupCtx) !== testGroupId) {
    throw new Error('Group chat target resolution failed');
  }
  if (parseNotificationSetting('/notif off') !== false || parseNotificationSetting('/notif غیرفعال') !== false) {
    throw new Error('Notification disable parsing failed');
  }
  if (parseNotificationSetting('/notif on') !== true || parseNotificationSetting('/notif فعال') !== true) {
    throw new Error('Notification enable parsing failed');
  }

  const groupScheduleKeyboard = getScheduleInlineKeyboard('1234567890123', 'all', true, false);
  const callbackData = groupScheduleKeyboard.inline_keyboard.flat().map(button => button.callback_data);
  if (callbackData.some(data => data?.startsWith('rename_prompt:') || data?.startsWith('delete_bill_do:'))) {
    throw new Error('Group schedule keyboard exposed bookmark management actions');
  }

  const originalGetSchedule = gopedApi.getSchedule;
  const sentMessages = [];
  try {
    gopedApi.getSchedule = async billId => ({
      success: true,
      customer: { billId },
      blackouts: [{ date: getIranGregorianDate(0), from: '10:00:00', to: '11:00:00' }]
    });
    const notifier = new OutageNotificationService({
      api: {
        sendMessage: async (...args) => sentMessages.push(args)
      }
    });
    const result = await notifier.checkAndNotifyAll(true, testGroupId);
    if (result.totalNotified !== 1 || sentMessages[0]?.[0] !== String(testGroupId)) {
      throw new Error('Cron notification was not sent to the Telegram group chat ID');
    }
  } finally {
    gopedApi.getSchedule = originalGetSchedule;
  }
  db.deleteUser(testGroupId);
  console.log('  ✅ Group storage, Cron delivery, and admin-safe controls passed.\n');

  // Test 6: Group freeform messages stay silent, while direct bill IDs still query
  console.log('Test 6: Group Freeform Message Routing');
  const routes = [];
  const fakeBot = {
    use(handler) {
      routes.push({ matches: () => true, handler });
    },
    command(commands, handler) {
      const allowed = new Set(Array.isArray(commands) ? commands : [commands]);
      routes.push({
        matches: ctx => {
          const match = String(ctx.message?.text || '').match(/^\/([^\s@]+)(?:@[^\s]+)?/);
          return Boolean(match && allowed.has(match[1]));
        },
        handler
      });
    },
    hears(trigger, handler) {
      const triggers = Array.isArray(trigger) ? trigger : [trigger];
      routes.push({ matches: ctx => triggers.includes(ctx.message?.text), handler });
    },
    on(filter, handler) {
      routes.push({
        matches: ctx => filter === 'message:text'
          ? typeof ctx.message?.text === 'string'
          : filter === 'my_chat_member' && Boolean(ctx.myChatMember),
        handler
      });
    },
    async dispatch(ctx) {
      const run = async startIndex => {
        for (let index = startIndex; index < routes.length; index++) {
          const route = routes[index];
          if (route.matches(ctx)) {
            await route.handler(ctx, () => run(index + 1));
            return;
          }
        }
      };
      await run(0);
    }
  };
  registerBotHandlers(fakeBot);

  const groupReplies = [];
  const makeTextCtx = (text, chatType = 'supergroup') => ({
    chat: {
      id: chatType === 'private' ? testUserId : testGroupId,
      type: chatType,
      title: chatType === 'private' ? undefined : 'گروه تست'
    },
    from: { id: testUserId },
    message: { text },
    api: { deleteMessage: async () => {} },
    reply: async (...args) => {
      groupReplies.push(args);
      return { message_id: groupReplies.length };
    }
  });

  const queriedBillIds = [];
  const originalGroupGetSchedule = gopedApi.getSchedule;
  try {
    gopedApi.getSchedule = async billId => {
      queriedBillIds.push(billId);
      return { success: true, customer: { billId }, blackouts: [] };
    };

    for (const chatType of ['group', 'supergroup']) {
      await fakeBot.dispatch(makeTextCtx('سلام دوستان، وقت بخیر', chatType));
      await fakeBot.dispatch(makeTextCtx('شماره تماس 09111234567 است', chatType));
      await fakeBot.dispatch(makeTextCtx('قبض: 1234567890123', chatType));
      await fakeBot.dispatch(makeTextCtx('خانه', chatType));
      await fakeBot.dispatch(makeTextCtx('راهنما', chatType));
      if (groupReplies.length !== 0 || queriedBillIds.length !== 0) {
        throw new Error(`Ordinary, menu, help, or embedded-number ${chatType} text was not ignored`);
      }
    }

    // A private menu/state must neither be opened nor consumed from a group.
    await fakeBot.dispatch(makeTextCtx('افزودن نشان جدید', 'group'));
    if (groupReplies.length !== 0) {
      throw new Error('Add-bookmark menu was allowed to start inside a group');
    }

    await fakeBot.dispatch(makeTextCtx('1234567890123', 'group'));
    await fakeBot.dispatch(makeTextCtx('۹۸۷۶۵۴۳۲۱۰۱۲۳', 'supergroup'));
    if (queriedBillIds.join(',') !== '1234567890123,9876543210123') {
      throw new Error(`Pure 13-digit group IDs were not queried correctly: ${queriedBillIds.join(',')}`);
    }

    groupReplies.length = 0;
    await fakeBot.dispatch(makeTextCtx('یک متن نامعتبر', 'private'));
    if (!groupReplies[0]?.[0]?.startsWith('❓ متوجه دستور نشدم.')) {
      throw new Error('Private chat no longer receives the unknown-command fallback');
    }

    groupReplies.length = 0;
    await fakeBot.dispatch(makeTextCtx('خانه', 'private'));
    await fakeBot.dispatch(makeTextCtx('راهنما', 'private'));
    if (groupReplies.length < 2) {
      throw new Error('Private home/help hears handlers were blocked by the group text gate');
    }

    // State HTML interpolation must remain safe for user-provided labels.
    groupReplies.length = 0;
    await fakeBot.dispatch(makeTextCtx('افزودن نشان جدید', 'private'));
    await fakeBot.dispatch(makeTextCtx('1111111111111', 'private'));
    await fakeBot.dispatch(makeTextCtx('<b>خانه</b> & مغازه', 'private'));
    const unsafeHtmlReply = groupReplies.find(([message]) => String(message).includes('<b><b>خانه</b>'));
    const escapedHtmlReply = groupReplies.find(([message]) => String(message).includes('&lt;b&gt;خانه&lt;/b&gt; &amp; مغازه'));
    if (unsafeHtmlReply || !escapedHtmlReply) {
      throw new Error('User-provided bookmark label was not HTML-escaped in state replies');
    }
  } finally {
    gopedApi.getSchedule = originalGroupGetSchedule;
    db.deleteUser(testGroupId);
    db.deleteUser(testUserId);
  }
  console.log('  ✅ Groups only query pure 13-digit IDs; menu/state bypass and HTML escaping passed.\n');

  // Test 7: Live GOPED API Schedule & Notice
  console.log('Test 7: GOPED API Live Schedule & Notice Check');
  try {
    const notice = await gopedApi.getNotice(true);
    console.log('  Live Notice:', notice.success ? 'OK' : 'NO NOTICE');
  } catch (err) {
    console.warn('  ⚠️ Live Notice warning:', err.message);
  }

  try {
    const liveSchedule = await gopedApi.getSchedule('6357330214322', true);
    if (liveSchedule.success) {
      console.log(`  Live Schedule fetched for bill 6357330214322 (${liveSchedule.customer?.name})`);
      console.log(`  Total blackout slots returned: ${liveSchedule.blackouts.length}`);
    }
  } catch (err) {
    console.warn('  ⚠️ Live Schedule warning:', err.message);
  }
  console.log('  ✅ GOPED API live tests completed.\n');

  // Test 8: Formatter Validation
  console.log('Test 8: Formatter & Filter Validation');
  const mockSchedule = {
    success: true,
    code: 1,
    queryTime: '14:30',
    customer: {
      billId: '6357330214322',
      name: 'محمد خانلری',
      distributionTitle: 'مدیریت توزیع برق گرگان غرب'
    },
    blackouts: [
      {
        date: '2026-08-15',
        from: '11:00:00',
        to: '13:00:00',
        reserve1From: '',
        reserve1To: ''
      },
      {
        date: '2026-08-16',
        from: '09:00:00',
        to: '11:00:00',
        reserve1From: '15:00:00',
        reserve1To: '17:00:00'
      },
      {
        date: '2026-08-17',
        from: '19:00:00',
        to: '21:00:00',
        reserve1From: '',
        reserve1To: ''
      }
    ]
  };

  const formattedToday = formatScheduleMessage(mockSchedule, 'today', '🏠 خونه');
  const formattedTom = formatScheduleMessage(mockSchedule, 'tomorrow', '🏠 خونه');
  const formattedAll = formatScheduleMessage(mockSchedule, 'all', '🏠 خونه');

  if (!formattedToday.includes('برنامه خاموشی امروز')) throw new Error('Formatted today missing title');
  if (!formattedTom.includes('برنامه خاموشی فردا')) throw new Error('Formatted tomorrow missing title');
  if (!formattedAll.includes('جدول کامل زمان‌بندی خاموشی')) throw new Error('Formatted all missing title');

  console.log('  --- Today View ---');
  console.log(formattedToday.replace(/<[^>]+>/g, ''));
  console.log('  --- All View ---');
  console.log(formattedAll.replace(/<[^>]+>/g, ''));
  console.log('  ✅ All formatters validated successfully.\n');

  console.log('🎉 ALL TESTS PASSED FLAWLESSLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
