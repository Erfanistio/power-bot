import { toEnglishDigits, toPersianDigits, getTodayJalali, parseDateInfo, formatTimeShort } from '../src/utils/persianDate.js';
import { db } from '../src/db/database.js';
import { gopedApi } from '../src/api/gopedApi.js';
import { formatScheduleMessage, formatNoticeMessage } from '../src/bot/formatters.js';

async function runTests() {
  console.log('🧪 Running Power Bot Test Suite...\n');

  // Test 1: Persian Number Conversion
  console.log('Test 1: Persian Digits Utility');
  const persianSample = '۱۲۳۴۵۶۷۸۹۰';
  const eng = toEnglishDigits(persianSample);
  if (eng !== '1234567890') throw new Error(`toEnglishDigits failed: ${eng}`);
  const backToPersian = toPersianDigits('1234567890');
  if (backToPersian !== persianSample) throw new Error(`toPersianDigits failed: ${backToPersian}`);
  console.log('  ✅ Persian <-> English conversion passed.\n');

  // Test 2: Jalali Date Conversion
  console.log('Test 2: Jalali Date Calculation');
  const today = getTodayJalali(0);
  console.log(`  📅 Current Jalali Date in Iran: ${today}`);
  if (!today || !/^\d{4}\/\d{2}\/\d{2}$/.test(today)) throw new Error(`Invalid Jalali date format: ${today}`);
  console.log('  ✅ Jalali date calculation passed.\n');

  // Test 3: Database operations
  console.log('Test 3: Database Operations');
  const testUserId = 999888777;
  const user = db.getUser(testUserId);
  if (!user || user.userId !== String(testUserId)) throw new Error('getUser failed');

  db.addBillId(testUserId, '۱۲۳۴۵۶۷۸۹۰۱۲۳', '🏠 خانه تستی');
  db.addBillId(testUserId, '9876543210123', '🏢 دفتر تستی');
  
  const updatedUser = db.getUser(testUserId);
  if (updatedUser.savedBills.length < 2) throw new Error('addBillId failed');
  console.log(`  Saved bills: ${updatedUser.savedBills.map(b => b.label).join(', ')}`);

  db.removeBillId(testUserId, '9876543210123');
  const afterRemove = db.getUser(testUserId);
  if (afterRemove.savedBills.some(b => b.billId === '9876543210123')) throw new Error('removeBillId failed');
  console.log('  ✅ Database operations passed.\n');

  // Test 4: Live GOPED API Notice
  console.log('Test 4: GOPED API Live Notice Check');
  try {
    const notice = await gopedApi.getNotice();
    console.log('  Notice response:', notice.success ? 'SUCCESS' : 'NO NOTICE');
    if (notice.success) {
      console.log('  Notice snippet:', notice.text.slice(0, 100).replace(/\n/g, ' '));
    }
  } catch (err) {
    console.warn('  ⚠️ Notice API warning:', err.message);
  }
  console.log('  ✅ GOPED API live connection test finished.\n');

  // Test 5: GOPED API Schedule Mock & Formatter Check
  console.log('Test 5: Schedule Formatter Validation');
  const mockSchedule = {
    success: true,
    code: 1,
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
      }
    ]
  };

  const formattedAll = formatScheduleMessage(mockSchedule, 'all', '🏠 خونه');
  console.log('  Sample formatted message:');
  console.log('----------------------------------------');
  console.log(formattedAll.replace(/<[^>]+>/g, ''));
  console.log('----------------------------------------');
  console.log('  ✅ Formatter passed.\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
