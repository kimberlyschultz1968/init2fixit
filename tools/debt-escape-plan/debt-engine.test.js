/*
 * Plain-Node test runner for debt-engine.js — no test framework, just
 * Node's built-in `assert`. Run with:  node debt-engine.test.js
 */
'use strict';

var assert = require('assert');
var DebtEngine = require('./debt-engine.js');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS - ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL - ' + name);
    console.log('       ' + (err && err.message ? err.message : err));
  }
}

function closeTo(actual, expected, tolerance, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    (msg || '') + ' expected ~' + expected + ' (±' + tolerance + ') but got ' + actual
  );
}

// ---------------------------------------------------------------------
// 1. Single 0% APR debt — no interest should ever accrue.
// ---------------------------------------------------------------------
test('single 0% APR debt pays off in balance/minPayment months with zero interest', function () {
  var debts = [{ name: 'Debt A', balance: 1200, apr: 0, minPayment: 100 }];
  var result = DebtEngine.simulatePayoff(debts, 0, 'snowball');

  assert.strictEqual(result.impossible, false);
  assert.strictEqual(result.months, 12);
  assert.strictEqual(result.totalInterestPaid, 0);
  assert.deepStrictEqual(result.payoffOrder, ['Debt A']);
  assert.strictEqual(result.schedule[result.schedule.length - 1], 0);
});

// ---------------------------------------------------------------------
// 2. Single debt with a real APR — hand-computed month-by-month.
//    Balance 100, 12% APR (1%/mo), $51 minimum payment, no extra.
//    Month 1: interest 1.00 -> balance 101.00, pay 51 -> 50.00 (interest so far 1.00)
//    Month 2: interest 0.50 -> balance 50.50, pay 50.50 -> 0.00 (interest so far 1.50)
// ---------------------------------------------------------------------
test('single debt with real APR matches hand-computed interest', function () {
  var debts = [{ name: 'Card', balance: 100, apr: 12, minPayment: 51 }];
  var result = DebtEngine.simulatePayoff(debts, 0, 'avalanche');

  assert.strictEqual(result.months, 2);
  closeTo(result.totalInterestPaid, 1.50, 0.01, 'total interest');
  assert.deepStrictEqual(result.payoffOrder, ['Card']);
  assert.strictEqual(result.schedule[result.schedule.length - 1], 0);
});

// ---------------------------------------------------------------------
// 3. Multiple debts, same inputs — avalanche should never cost more total
//    interest than snowball (it always attacks the highest-APR balance).
// ---------------------------------------------------------------------
test('avalanche total interest is never more than snowball for the same inputs', function () {
  var debts = [
    { name: 'Store Card', balance: 500, apr: 24, minPayment: 25 },
    { name: 'Credit Card', balance: 3000, apr: 12, minPayment: 60 },
    { name: 'Car Loan', balance: 1500, apr: 6, minPayment: 40 }
  ];
  var cmp = DebtEngine.compareStrategies(debts, 100);

  assert.strictEqual(cmp.snowball.impossible, false);
  assert.strictEqual(cmp.avalanche.impossible, false);
  assert.ok(
    cmp.avalanche.totalInterestPaid <= cmp.snowball.totalInterestPaid,
    'avalanche interest ' + cmp.avalanche.totalInterestPaid +
      ' should be <= snowball interest ' + cmp.snowball.totalInterestPaid
  );
});

// ---------------------------------------------------------------------
// 4. Extra payment should reduce months-to-payoff.
// ---------------------------------------------------------------------
test('extra monthly payment reduces months to debt-free', function () {
  var debts = [{ name: 'Loan', balance: 2400, apr: 18, minPayment: 60 }];
  var noExtra = DebtEngine.simulatePayoff(debts, 0, 'avalanche');
  var withExtra = DebtEngine.simulatePayoff(debts, 200, 'avalanche');

  assert.strictEqual(noExtra.impossible, false);
  assert.strictEqual(withExtra.impossible, false);
  assert.ok(
    withExtra.months < noExtra.months,
    'expected extra payment to shorten payoff (' + withExtra.months + ' vs ' + noExtra.months + ')'
  );
});

// ---------------------------------------------------------------------
// 5. A debt whose minimum payment would overshoot its remaining balance in
//    the final month should pay only what's left — never go negative.
// ---------------------------------------------------------------------
test('final month pays only the remaining balance, never overpays', function () {
  var debts = [{ name: 'Small Balance', balance: 505, apr: 0, minPayment: 250 }];
  var result = DebtEngine.simulatePayoff(debts, 0, 'snowball');

  // Month 1: 505 -> 255. Month 2: 255 -> 5. Month 3: pay only the last $5 -> 0.
  assert.strictEqual(result.months, 3);
  assert.strictEqual(result.schedule.length, 3);
  assert.strictEqual(result.schedule[1], 5);
  assert.strictEqual(result.schedule[2], 0);
  assert.strictEqual(result.totalInterestPaid, 0);
});

// ---------------------------------------------------------------------
// 6. "Impossible" case — minimum payments don't even cover monthly
//    interest and there's no extra payment. Must terminate, not hang.
// ---------------------------------------------------------------------
test('budget that never covers interest terminates as impossible, not an infinite loop', function () {
  var debts = [{ name: 'Underwater Card', balance: 1000, apr: 24, minPayment: 15 }];
  var result = DebtEngine.simulatePayoff(debts, 0, 'avalanche');

  assert.strictEqual(result.impossible, true);
  assert.strictEqual(result.months, null);
});

// ---------------------------------------------------------------------
// compareStrategies / estimatePayoffDate sanity checks
// ---------------------------------------------------------------------
test('estimatePayoffDate adds months from a given date', function () {
  var from = new Date(2026, 0, 15); // Jan 15, 2026
  var result = DebtEngine.estimatePayoffDate(14, from);

  assert.strictEqual(result.getFullYear(), 2027);
  assert.strictEqual(result.getMonth(), 2); // March (0-indexed)
});

test('estimatePayoffDate returns null for an impossible (null) months value', function () {
  assert.strictEqual(DebtEngine.estimatePayoffDate(null, new Date()), null);
});

// ---------------------------------------------------------------------
console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
