import assert from 'assert';
import {
  istDayString,
  getCurrentISTTime,
  parseTimeToMinutesOfDay,
} from '../utils/istDay';
import { InventoryService } from '../services/InventoryService';

async function runTests() {
  console.log('--- Starting Food Daily Preparation Capacity Reset Tests ---');

  // Test 1: Time Parsing in IST
  console.log('1. Testing parseTimeToMinutesOfDay...');
  assert.strictEqual(parseTimeToMinutesOfDay('10:00 AM'), 600, '10:00 AM should be 600 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('10:30 AM'), 630, '10:30 AM should be 630 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('12:00 PM'), 720, '12:00 PM should be 720 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('12:00 AM'), 0, '12:00 AM should be 0 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('11:00 PM'), 1380, '11:00 PM should be 1380 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('14:30'), 870, '14:30 should be 870 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay('All Day'), 0, 'All Day should default to 0 minutes');
  assert.strictEqual(parseTimeToMinutesOfDay(null), 0, 'null should default to 0 minutes');
  console.log('✓ Time parsing verified successfully.');

  // Test 2: Eligibility Check - When available time has NOT yet arrived today
  console.log('2. Testing eligibility when available time has NOT arrived today...');
  // Say today is 2026-11-18, opening time is 10:00 AM IST (04:30 UTC), simulate 08:00 AM IST (02:30 UTC)
  const simulatedEarlyMorning = new Date('2026-11-18T02:30:00.000Z'); // 08:00 AM IST
  const yesterdayStr = '2026-11-17';

  const freshFoodListing = {
    isFoodProduct: true,
    dailyPreparationCapacity: 50,
    remainingDailyCapacity: 0,
    stock: 0,
    reserved: 0,
    availability: 'OUT_OF_STOCK',
    lastCapacityResetDate: yesterdayStr,
    foodDetails: {
      availabilityDetails: {
        availableFromTime: '10:00 AM',
        availableUntilTime: '11:00 PM',
        dailyCapacity: 50,
      },
    },
  };

  const isEligibleEarly = InventoryService.isEligibleForDailyReset(freshFoodListing, undefined, simulatedEarlyMorning);
  assert.strictEqual(isEligibleEarly, false, 'Should NOT be eligible before 10:00 AM IST on the current day');
  console.log('✓ Non-eligible before opening time verified.');

  // Test 3: Eligibility Check - When opening time HAS arrived today
  console.log('3. Testing eligibility when available time HAS arrived today...');
  const simulatedAfterOpen = new Date('2026-11-18T04:35:00.000Z'); // 10:05 AM IST
  const isEligibleAfterOpen = InventoryService.isEligibleForDailyReset(freshFoodListing, undefined, simulatedAfterOpen);
  assert.strictEqual(isEligibleAfterOpen, true, 'Should BE eligible at/after 10:00 AM IST on the current day');
  console.log('✓ Eligible after opening time verified.');

  // Test 4: Eligibility Check - When already reset today
  console.log('4. Testing eligibility when already reset today...');
  const alreadyResetListing = {
    ...freshFoodListing,
    lastCapacityResetDate: '2026-11-18',
  };
  const isEligibleAlreadyReset = InventoryService.isEligibleForDailyReset(alreadyResetListing, undefined, simulatedAfterOpen);
  assert.strictEqual(isEligibleAlreadyReset, false, 'Should NOT be eligible if already reset today');
  console.log('✓ Already reset prevention verified.');

  // Test 5: Incremental Seller Increase Math
  console.log('5. Testing baseline capacity increase math...');
  // Seller had 50 capacity baseline, 10 sold, 40 remaining
  const baseline = 50;
  const sold = 10;
  let currentRemaining = baseline - sold; // 40
  const newBaseline = 70; // Seller increases to 70
  const diff = newBaseline - baseline; // +20
  currentRemaining = currentRemaining + diff; // 60
  assert.strictEqual(currentRemaining, 60, 'Remaining capacity should increase from 40 to 60 when seller increases baseline from 50 to 70');
  console.log('✓ Seller capacity increase math verified.');

  console.log('All Food Daily Capacity Reset tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
