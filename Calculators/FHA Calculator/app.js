// app.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("fha-calculator-form");
  const calculateBtn = document.getElementById("calculateBtn");

  const els = {
    loanPurpose: document.getElementById("loanPurpose"),
    propertyType: document.getElementById("propertyType"),
    origDate: document.getElementById("origDate"),
    monthsOwnedDisplay: document.getElementById("monthsOwnedDisplay"),
    isExistingFha: document.getElementById("isExistingFha"),
    financeUfmip: document.getElementById("financeUfmip"),
    purchasePrice: document.getElementById("purchasePrice"),
    appraisedValue: document.getElementById("appraisedValue"),
    currentUpb: document.getElementById("currentUpb"),
    closingCosts: document.getElementById("closingCosts"), // financed costs
    currentPayment: document.getElementById("currentPayment"),
    newPayment: document.getElementById("newPayment"),

    // New cash-to-close inputs
    closingCostsCash: document.getElementById("closingCostsCash"),
    prepaidsCash: document.getElementById("prepaidsCash"),
    totalCredits: document.getElementById("totalCredits"),
    escrowRefund: document.getElementById("escrowRefund"),

    // Results
    resultBaseLoan: document.getElementById("resultBaseLoan"),
    resultTotalLoan: document.getElementById("resultTotalLoan"),
    resultLtv: document.getElementById("resultLtv"),
    resultNtb: document.getElementById("resultNtb"),
    resultCashToClose: document.getElementById("resultCashToClose"),
    resultNotes: document.getElementById("resultNotes")
  };

  calculateBtn.addEventListener("click", () => {
    const inputs = readInputs();
    const result = calculateFhaScenario(inputs);
    renderResults(result, inputs);
  });

  // Recalculate months owned when the acquired date changes
  els.origDate.addEventListener("change", () => {
    const months = computeMonthsOwned(els.origDate.value);
    updateMonthsOwnedDisplay(months);
  });

  function readInputs() {
    const toNumber = (el) => {
      const v = parseFloat(el?.value);
      return Number.isFinite(v) ? v : 0;
    };

    const monthsOwned = computeMonthsOwned(els.origDate.value);
    updateMonthsOwnedDisplay(monthsOwned);

    return {
      loanPurpose: els.loanPurpose.value,
      propertyType: els.propertyType.value,
      monthsOwned,
      isExistingFha: els.isExistingFha.checked,
      financeUfmip: els.financeUfmip.checked,
      purchasePrice: toNumber(els.purchasePrice),
      appraisedValue: toNumber(els.appraisedValue),
      currentUpb: toNumber(els.currentUpb),
      closingCostsFinanced: toNumber(els.closingCosts),
      currentPayment: toNumber(els.currentPayment),
      newPayment: toNumber(els.newPayment),

      // cash-to-close inputs
      closingCostsCash: toNumber(els.closingCostsCash),
      prepaidsCash: toNumber(els.prepaidsCash),
      totalCredits: toNumber(els.totalCredits),
      escrowRefund: toNumber(els.escrowRefund)
    };
  }

  function computeMonthsOwned(dateStr) {
    if (!dateStr) return 0;
    const acquired = new Date(dateStr);
    if (isNaN(acquired.getTime())) return 0;

    const today = new Date();
    let months =
      (today.getFullYear() - acquired.getFullYear()) * 12 +
      (today.getMonth() - acquired.getMonth());

    // If current day is before the acquired day, don't count the current month
    if (today.getDate() < acquired.getDate()) {
      months -= 1;
    }

    return Math.max(0, months);
  }

  function updateMonthsOwnedDisplay(months) {
    if (!els.monthsOwnedDisplay) return;
    if (months <= 0) {
      els.monthsOwnedDisplay.textContent = "Months owned (calculated): —";
    } else {
      els.monthsOwnedDisplay.textContent =
        "Months owned (calculated): " + months + " month" + (months === 1 ? "" : "s");
    }
  }

  /**
   * Core FHA logic (simplified, tweakable for overlays).
   */
  function calculateFhaScenario(inputs) {
    const notes = [];
    const ufmipRate = 0.0175;

    const {
      loanPurpose,
      monthsOwned,
      purchasePrice,
      appraisedValue,
      currentUpb,
      closingCostsFinanced,
      financeUfmip
    } = inputs;

    let baseLoan = 0;
    let ltv = 0;
    let valueUsed = appraisedValue || 0;

    if (!appraisedValue && loanPurpose !== "streamline") {
      notes.push("No appraised value entered – LTV-based limits may be inaccurate.");
    }

    switch (loanPurpose) {
      case "purchase": {
        const priceOrValue = minPositive(purchasePrice, appraisedValue);
        if (!priceOrValue) {
          notes.push("Enter purchase price and appraised value for a purchase scenario.");
        }
        const maxLtv = 0.965; // 96.5%
        baseLoan = priceOrValue * maxLtv;
        valueUsed = priceOrValue;
        ltv = valueUsed ? baseLoan / valueUsed : 0;

        notes.push("Purchase: max base loan set at 96.5% of lesser of price or value (subject to FHA exceptions).");
        break;
      }

      case "rateTerm": {
        const maxLtv = 0.9775; // 97.75%
        const valueCap = appraisedValue * maxLtv;

        // If you want to enforce cost/UPB cap, uncomment and adjust:
        // const costCap = currentUpb + closingCostsFinanced;
        // baseLoan = minPositive(valueCap, costCap);

        baseLoan = valueCap;
        valueUsed = appraisedValue;
        ltv = valueUsed ? baseLoan / valueUsed : 0;

        notes.push("Rate/Term Refi: max base loan set at 97.75% of appraised value (owner-occupied).");
        if (monthsOwned < 12) {
          notes.push("Owned < 12 months – acquisition cost limitations may apply.");
        }
        break;
      }

      case "streamline": {
        if (!inputs.isExistingFha) {
          notes.push("Streamline selected but current loan is not marked as FHA.");
        }

        // Simplified: UPB + financed costs (you can refine with exact FHA caps)
        const upbPlusCosts = currentUpb + closingCostsFinanced;
        baseLoan = upbPlusCosts;
        valueUsed = appraisedValue || 0;
        ltv = valueUsed ? baseLoan / valueUsed : 0;

        notes.push("FHA Streamline: using current UPB + allowable closing costs. No standard LTV cap, but investor overlays may apply.");
        break;
      }

      case "cashOut": {
        const maxLtv = 0.8; // 80%
        baseLoan = appraisedValue * maxLtv;
        valueUsed = appraisedValue;
        ltv = valueUsed ? baseLoan / valueUsed : 0;

        notes.push("Cash-Out Refi: max base loan set at 80% of appraised value.");
        if (monthsOwned < 12) {
          notes.push("Owned < 12 months – not eligible for FHA cash-out under current seasoning rules.");
        }
        break;
      }

      default:
        notes.push("Unknown loan purpose selected.");
    }

    // UFMIP handling
    const ufmipAmount = financeUfmip ? baseLoan * ufmipRate : 0;
    const totalLoan = baseLoan + ufmipAmount;

    // Net Tangible Benefit (simple percentage test)
    const ntb = evaluateNtb(inputs.currentPayment, inputs.newPayment, inputs.loanPurpose, notes);

    // Cash to close estimate
    const cashToClose = estimateCashToClose(inputs, { baseLoan, totalLoan, ufmipAmount }, notes);

    return {
      baseLoan,
      totalLoan,
      ufmipAmount,
      ltv,
      ntb,
      cashToClose,
      notes,
      valueUsed
    };
  }

  function estimateCashToClose(inputs, calc, notes) {
    const { loanPurpose, purchasePrice, currentUpb, closingCostsFinanced, closingCostsCash, prepaidsCash, totalCredits, escrowRefund } = inputs;
    const { baseLoan, totalLoan, ufmipAmount } = calc;

    let cash = 0;

    if (loanPurpose === "purchase") {
      if (!purchasePrice || !baseLoan) {
        notes.push("Cash to close (purchase): missing purchase price or base loan amount.");
        return 0;
      }
      const downPayment = Math.max(0, purchasePrice - baseLoan);
      const ufmipOutOfPocket = inputs.financeUfmip ? 0 : ufmipAmount;

      cash =
        downPayment +
        closingCostsCash +
        prepaidsCash +
        ufmipOutOfPocket -
        totalCredits;

      notes.push("Cash to close (purchase): down payment + cash costs + prepaids ± credits (UFMIP added only if not financed).");
      return cash;
    }

    // Refinance scenarios (rate/term, streamline, cash-out)
    if (!currentUpb) {
      notes.push("Cash to close (refi): missing current UPB; payoff assumed to be 0.");
    }

    const payoff = currentUpb || 0;

    const totalFundsNeeded =
      payoff +
      closingCostsFinanced +
      closingCostsCash +
      prepaidsCash -
      totalCredits -
      escrowRefund;

    cash = totalFundsNeeded - totalLoan;

    notes.push("Cash to close (refi): (payoff + costs + prepaids – credits – escrow refund) – new loan amount.");
    return cash;
  }

  function evaluateNtb(currentPayment, newPayment, purpose, notes) {
    if (!currentPayment || !newPayment) {
      notes.push("NTB: Enter both current and new payments to evaluate net tangible benefit.");
      return {
        met: null,
        reductionPercent: 0
      };
    }

    const reduction = currentPayment - newPayment;
    const reductionPercent = reduction / currentPayment;

    let threshold = 0;
    if (purpose === "streamline") {
      threshold = 0.05; // 5% for FHA Streamline (typical P&I + MIP test)
      if (reductionPercent >= threshold) {
        notes.push(`NTB: Streamline requirement met – payment reduced by ${(reductionPercent * 100).toFixed(2)}%.`);
      } else {
        notes.push(`NTB: Streamline requirement NOT met – only ${(reductionPercent * 100).toFixed(2)}% reduction.`);
      }
    } else {
      notes.push(`NTB: Payment change is ${(reductionPercent * 100).toFixed(2)}%. Confirm against current FHA/Investor NTB rules.`);
    }

    return {
      met: threshold ? reductionPercent >= threshold : null,
      reductionPercent
    };
  }

  function renderResults(result, inputs) {
    const { baseLoan, totalLoan, ltv, ntb, cashToClose, notes, valueUsed } = result;

    els.resultBaseLoan.textContent = baseLoan > 0 ? formatCurrency(baseLoan) : "—";
    els.resultTotalLoan.textContent = totalLoan > 0 ? formatCurrency(totalLoan) : "—";

    if (ltv && valueUsed) {
      els.resultLtv.textContent = (ltv * 100).toFixed(2) + "%";
    } else {
      els.resultLtv.textContent = "—";
    }

    // NTB pill
    els.resultNtb.classList.remove("success", "warning", "error");
    if (ntb.met === true) {
      els.resultNtb.textContent = `Met (↓ ${(ntb.reductionPercent * 100).toFixed(2)}%)`;
      els.resultNtb.classList.add("success");
    } else if (ntb.met === false) {
      els.resultNtb.textContent = `Not Met (↓ ${(ntb.reductionPercent * 100).toFixed(2)}%)`;
      els.resultNtb.classList.add("error");
    } else {
      els.resultNtb.textContent = "Insufficient data";
      els.resultNtb.classList.add("warning");
    }

    // Cash to close
    if (Number.isFinite(cashToClose)) {
      if (cashToClose > 0.01) {
        els.resultCashToClose.textContent = `${formatCurrency(cashToClose)} due from borrower`;
      } else if (cashToClose < -0.01) {
        els.resultCashToClose.textContent = `${formatCurrency(Math.abs(cashToClose))} to borrower`;
      } else {
        els.resultCashToClose.textContent = "$0.00 (roughly neutral)";
      }
    } else {
      els.resultCashToClose.textContent = "—";
    }

    // Notes
    els.resultNotes.innerHTML = "";
    notes.forEach((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      els.resultNotes.appendChild(li);
    });
  }

  // Helpers

  function formatCurrency(amount) {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    });
  }

  function minPositive(a, b) {
    const vals = [a, b].filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return 0;
    return Math.min(...vals);
  }
});