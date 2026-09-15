/*
 * Debt Escape Plan — calculation engine.
 *
 * Pure, deterministic math. No DOM access, no globals besides the single
 * DebtEngine export below, so this file can be loaded in a browser
 * (<script src="debt-engine.js">, exposes window.DebtEngine) or required
 * directly in Node for testing (module.exports = DebtEngine) with zero
 * mocking either way.
 */
(function () {
  'use strict';

  var MAX_MONTHS = 1200; // 100-year hard cap so a bad/impossible plan can't loop forever
  var EPS = 1e-6;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function sumBalances(working) {
    var total = 0;
    for (var i = 0; i < working.length; i++) {
      total += working[i].balance;
    }
    return total;
  }

  // Among debts still owing money, pick the one the strategy should attack next.
  //  - avalanche: highest APR (tie-break: smaller balance first)
  //  - snowball:  smallest balance (tie-break: higher APR first)
  function pickTarget(working, strategy) {
    var active = [];
    for (var i = 0; i < working.length; i++) {
      if (working[i].balance > EPS) active.push(working[i]);
    }
    if (active.length === 0) return null;

    var best = active[0];
    for (var j = 1; j < active.length; j++) {
      var d = active[j];
      if (strategy === 'avalanche') {
        if (d.apr > best.apr || (d.apr === best.apr && d.balance < best.balance)) {
          best = d;
        }
      } else {
        if (d.balance < best.balance || (d.balance === best.balance && d.apr > best.apr)) {
          best = d;
        }
      }
    }
    return best;
  }

  /**
   * Simulate a full payoff plan, month by month.
   *
   * @param {Array<{name:string, balance:number, apr:number, minPayment:number}>} debts
   * @param {number} extraPayment - extra dollars applied every month, on top of minimums, >= 0
   * @param {'snowball'|'avalanche'} strategy
   * @returns {{months:number|null, totalInterestPaid:number, payoffOrder:string[], schedule:number[], impossible:boolean}}
   */
  function simulatePayoff(debts, extraPayment, strategy) {
    if (strategy !== 'snowball' && strategy !== 'avalanche') {
      throw new Error('simulatePayoff: strategy must be "snowball" or "avalanche"');
    }
    if (!Array.isArray(debts) || debts.length === 0) {
      return { months: 0, totalInterestPaid: 0, payoffOrder: [], schedule: [], impossible: false };
    }

    var extra = Number(extraPayment);
    if (!isFinite(extra) || extra < 0) extra = 0;

    var working = debts.map(function (d) {
      return {
        name: d.name,
        balance: Number(d.balance) || 0,
        apr: Number(d.apr) || 0,
        minPayment: Number(d.minPayment) || 0
      };
    });

    var totalInterestPaid = 0;
    var payoffOrder = [];
    var schedule = [];
    var paidOff = {}; // name -> true once a debt's balance has reached 0

    // Debts that start already at (or below) zero don't count as "paid off during
    // the plan" for payoffOrder purposes, but their minimum payment should roll
    // into the extra budget from month one.
    for (var s = 0; s < working.length; s++) {
      if (working[s].balance <= EPS) {
        working[s].balance = 0;
        paidOff[working[s].name] = true;
      }
    }

    var totalBalance = sumBalances(working);
    if (totalBalance <= EPS) {
      return { months: 0, totalInterestPaid: 0, payoffOrder: [], schedule: [0], impossible: false };
    }

    var months = 0;

    while (totalBalance > EPS && months < MAX_MONTHS) {
      months++;

      // 1. accrue one month's interest on every debt still owing money
      for (var i = 0; i < working.length; i++) {
        var d = working[i];
        if (d.balance > EPS) {
          var monthlyRate = (d.apr / 100) / 12;
          var interest = d.balance * monthlyRate;
          d.balance += interest;
          totalInterestPaid += interest;
        }
      }

      // 2. apply minimum payments; tally rolled-over budget from debts already paid off
      var rolledExtra = 0;
      for (var j = 0; j < working.length; j++) {
        var dj = working[j];
        if (dj.balance > EPS) {
          var pay = Math.min(dj.minPayment, dj.balance);
          dj.balance -= pay;
        } else if (paidOff[dj.name]) {
          rolledExtra += dj.minPayment;
        }
      }

      // 3. apply all freed-up extra budget (explicit extra + rolled minimums) to
      //    the strategy's target debt, rolling any leftover to the next target
      //    in the same month, capped so nothing goes negative.
      var budget = extra + rolledExtra;
      while (budget > EPS) {
        var target = pickTarget(working, strategy);
        if (!target) break;
        var applyAmt = Math.min(budget, target.balance);
        target.balance -= applyAmt;
        budget -= applyAmt;
      }

      // 4. snap near-zero balances to zero and record newly-completed payoffs
      for (var k = 0; k < working.length; k++) {
        var dk = working[k];
        if (dk.balance <= EPS) {
          dk.balance = 0;
          if (!paidOff[dk.name]) {
            paidOff[dk.name] = true;
            payoffOrder.push(dk.name);
          }
        }
      }

      totalBalance = sumBalances(working);
      schedule.push(round2(totalBalance));
    }

    var impossible = totalBalance > EPS;

    return {
      months: impossible ? null : months,
      totalInterestPaid: round2(totalInterestPaid),
      payoffOrder: payoffOrder,
      schedule: schedule,
      impossible: impossible
    };
  }

  /**
   * Convenience wrapper: run the same debts/extra payment through both strategies.
   */
  function compareStrategies(debts, extraPayment) {
    return {
      snowball: simulatePayoff(debts, extraPayment, 'snowball'),
      avalanche: simulatePayoff(debts, extraPayment, 'avalanche')
    };
  }

  /**
   * Turn a month count into a calendar date, counting forward from fromDate
   * (defaults to today). Returns null if months isn't a finite number
   * (e.g. an "impossible" plan where months is null).
   */
  function estimatePayoffDate(months, fromDate) {
    if (months === null || months === undefined || !isFinite(months)) {
      return null;
    }
    var base = (fromDate instanceof Date) ? fromDate : new Date();
    var result = new Date(base.getTime());
    result.setMonth(result.getMonth() + months);
    return result;
  }

  var DebtEngine = {
    simulatePayoff: simulatePayoff,
    compareStrategies: compareStrategies,
    estimatePayoffDate: estimatePayoffDate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebtEngine;
  }
  if (typeof window !== 'undefined') {
    window.DebtEngine = DebtEngine;
  }
})();
