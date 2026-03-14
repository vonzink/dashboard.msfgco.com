// escrow.js

document.addEventListener("DOMContentLoaded", () => {
  const els = {
    loanType: document.getElementById("loanType"),
    state: document.getElementById("state"),
    closingDate: document.getElementById("closingDate"),
    firstPaymentDate: document.getElementById("firstPaymentDate"),
    cushionMonths: document.getElementById("cushionMonths"),

    annualTax: document.getElementById("annualTax"),
    taxFrequency: document.getElementById("taxFrequency"),
    nextTaxDueMonth: document.getElementById("nextTaxDueMonth"),

    annualIns: document.getElementById("annualIns"),
    nextInsDueDate: document.getElementById("nextInsDueDate"),

    calcBtn: document.getElementById("escrowCalculateBtn"),

    resultTaxDeposit: document.getElementById("resultTaxDeposit"),
    resultTaxMonths: document.getElementById("resultTaxMonths"),
    resultInsDeposit: document.getElementById("resultInsDeposit"),
    resultInsMonths: document.getElementById("resultInsMonths"),
    resultTotalDeposit: document.getElementById("resultTotalDeposit"),
    resultAggregateAdj: document.getElementById("resultAggregateAdj"),
    resultAggregateDetails: document.getElementById("resultAggregateDetails"),
    resultSectionF: document.getElementById("resultSectionF"),
    resultSectionG: document.getElementById("resultSectionG"),
    resultNotes: document.getElementById("escrowResultNotes")
  };

  // Simple default behaviors by state (tweak to your matrix as needed)
  const stateConfigs = {
    CO: { defaultTaxFrequency: "semiannual", defaultNextTaxDueMonth: 4 },
    AZ: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 11 },
    CA: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 12 },
    TX: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 1 },
    FL: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 11 },
    UT: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 11 },
    NM: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 12 },
    MN: { defaultTaxFrequency: "semiannual", defaultNextTaxDueMonth: 5 },
    ND: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 12 },
    SD: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 12 },
    DEFAULT: { defaultTaxFrequency: "annual", defaultNextTaxDueMonth: 12 }
  };

  els.state.addEventListener("change", () => {
    const cfg = stateConfigs[els.state.value] || stateConfigs.DEFAULT;
    if (cfg.defaultTaxFrequency) {
      els.taxFrequency.value = cfg.defaultTaxFrequency;
    }
    if (cfg.defaultNextTaxDueMonth) {
      els.nextTaxDueMonth.value = String(cfg.defaultNextTaxDueMonth);
    }
  });

  els.calcBtn.addEventListener("click", () => {
    const inputs = readInputs();
    const result = calculateEscrow(inputs);
    renderResults(result);
  });

  function readInputs() {
    const toNumber = (el) => {
      const v = parseFloat(el?.value);
      return Number.isFinite(v) ? v : 0;
    };

    return {
      loanType: els.loanType.value,
      state: els.state.value,
      closingDate: parseDate(els.closingDate.value),
      firstPaymentDate: parseDate(els.firstPaymentDate.value),
      cushionMonths: parseInt(els.cushionMonths.value || "0", 10),

      annualTax: toNumber(els.annualTax),
      taxFrequency: els.taxFrequency.value,
      nextTaxDueMonth: parseInt(els.nextTaxDueMonth.value || "1", 10),

      annualIns: toNumber(els.annualIns),
      nextInsDueDate: parseDate(els.nextInsDueDate.value)
    };
  }

  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function calculateEscrow(inputs) {
    const notes = [];
    const {
      loanType,
      closingDate,
      firstPaymentDate,
      cushionMonths,
      annualTax,
      taxFrequency,
      nextTaxDueMonth,
      annualIns,
      nextInsDueDate
    } = inputs;

    if (!firstPaymentDate) {
      notes.push("First payment date is missing – escrow timing may be inaccurate.");
    }
    const fp = firstPaymentDate || new Date();

    // Monthly escrow amounts
    const monthlyTax = annualTax > 0 ? annualTax / 12 : 0;
    const monthlyIns = annualIns > 0 ? annualIns / 12 : 0;

    // --- TAX ESCROW DEPOSIT ---
    let taxMonthsCollected = 0;
    let taxDeposit = 0;

    if (annualTax > 0) {
      const monthsToNextTaxBill = computeMonthsToNextBill(fp, nextTaxDueMonth);
      let requiredBeforeBill = annualTax - monthsToNextTaxBill * monthlyTax;
      if (requiredBeforeBill < 0) requiredBeforeBill = 0;

      const cushionTax = cushionMonths * monthlyTax;
      taxDeposit = requiredBeforeBill + cushionTax;

      const totalTaxMonths = monthlyTax > 0 ? taxDeposit / monthlyTax : 0;
      taxMonthsCollected = totalTaxMonths;

      notes.push(
        `Taxes: ${monthsToNextTaxBill} months until next bill; cushion ${cushionMonths} month(s).`
      );
      notes.push(
        `Taxes: deposit ≈ ${formatCurrency(taxDeposit)} (${totalTaxMonths.toFixed(
          2
        )} months of tax).`
      );
    } else {
      notes.push("No annual tax amount entered – tax escrow not calculated.");
    }

    // --- INSURANCE ESCROW DEPOSIT ---
    let insMonthsCollected = 0;
    let insDeposit = 0;

    if (annualIns > 0) {
      const insDue = nextInsDueDate || fp;
      const monthsToInsBill = monthsBetween(fp, insDue);
      let requiredBeforeIns = annualIns - monthsToInsBill * monthlyIns;
      if (requiredBeforeIns < 0) requiredBeforeIns = 0;

      const cushionIns = cushionMonths * monthlyIns;
      insDeposit = requiredBeforeIns + cushionIns;

      const totalInsMonths = monthlyIns > 0 ? insDeposit / monthlyIns : 0;
      insMonthsCollected = totalInsMonths;

      notes.push(
        `Insurance: ${monthsToInsBill} months until next renewal; cushion ${cushionMonths} month(s).`
      );
      notes.push(
        `Insurance: deposit ≈ ${formatCurrency(insDeposit)} (${totalInsMonths.toFixed(
          2
        )} months of insurance).`
      );
    } else {
      notes.push("No annual insurance amount entered – HOI escrow not calculated.");
    }

    const totalDeposit = taxDeposit + insDeposit;

    // --- AGGREGATE ADJUSTMENT SIMULATION ---
    const agg = simulateAggregateAdjustment({
      firstPaymentDate: fp,
      annualTax,
      taxFrequency,
      nextTaxDueMonth,
      annualIns,
      nextInsDueDate: nextInsDueDate || fp,
      monthlyTax,
      monthlyIns,
      cushionMonths,
      startingDeposit: totalDeposit
    });

    if (agg) {
      notes.push(
        `Aggregate: lowest projected balance ${formatCurrency(
          agg.lowestBalance
        )}, allowed cushion ${formatCurrency(agg.allowedCushionBalance)}.`
      );
    }

    // Section F vs G breakdown
    const sectionBreakdown = determineSections(inputs, {
      monthlyTax,
      monthlyIns,
      taxDeposit,
      insDeposit,
      totalDeposit
    });

    return {
      taxDeposit,
      taxMonthsCollected,
      insDeposit,
      insMonthsCollected,
      totalDeposit,
      aggregateAdjustment: agg ? agg.aggregateAdjustment : 0,
      aggregateDirection: agg ? agg.direction : null,
      aggDetails: agg ? agg.details : "",
      sectionBreakdown,
      notes
    };
  }

  // months from first payment to next bill month (tax)
  function computeMonthsToNextBill(firstPaymentDate, dueMonth) {
    const startMonth = firstPaymentDate.getMonth() + 1; // 1–12
    const startYear = firstPaymentDate.getFullYear();

    let year = startYear;
    let month = dueMonth;

    if (dueMonth < startMonth) {
      year += 1; // next year
    }

    const billDate = new Date(year, month - 1, 1);
    const months = monthsBetween(firstPaymentDate, billDate);
    return Math.max(0, months);
  }

  function monthsBetween(start, end) {
    let months =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    if (months < 0) return 0;
    return months;
  }

  function simulateAggregateAdjustment(config) {
    const {
      firstPaymentDate,
      annualTax,
      taxFrequency,
      nextTaxDueMonth,
      annualIns,
      nextInsDueDate,
      monthlyTax,
      monthlyIns,
      cushionMonths,
      startingDeposit
    } = config;

    if (!firstPaymentDate || startingDeposit <= 0 || (annualTax <= 0 && annualIns <= 0)) {
      return null;
    }

    const eventsPerYear = buildPaymentEvents({
      firstPaymentDate,
      annualTax,
      taxFrequency,
      nextTaxDueMonth,
      annualIns,
      nextInsDueDate
    });

    let balance = startingDeposit;
    let lowestBalance = startingDeposit;

    for (let i = 0; i < 12; i++) {
      const monthEvents = eventsPerYear[i] || { tax: 0, ins: 0 };

      // deposit monthly escrow
      balance += monthlyTax + monthlyIns;

      // pay bills
      balance -= monthEvents.tax;
      balance -= monthEvents.ins;

      if (balance < lowestBalance) {
        lowestBalance = balance;
      }
    }

    const monthlyCombined = monthlyTax + monthlyIns;
    const allowedCushionBalance = cushionMonths * monthlyCombined;

    const aggregateAdjustment = allowedCushionBalance - lowestBalance;
    let direction = "none";
    if (aggregateAdjustment > 0.01) {
      direction = "increase"; // need more deposit
    } else if (aggregateAdjustment < -0.01) {
      direction = "decrease"; // over-collected, credit back
    }

    const details =
      "Aggregate adjustment = allowed cushion (" +
      formatCurrency(allowedCushionBalance) +
      ") minus projected lowest balance (" +
      formatCurrency(lowestBalance) +
      ").";

    return {
      lowestBalance,
      allowedCushionBalance,
      aggregateAdjustment,
      direction,
      details
    };
  }

  function buildPaymentEvents({
    firstPaymentDate,
    annualTax,
    taxFrequency,
    nextTaxDueMonth,
    annualIns,
    nextInsDueDate
  }) {
    const events = [];
    for (let i = 0; i < 12; i++) {
      events.push({ tax: 0, ins: 0 });
    }

    const fpMonthIndex = firstPaymentDate.getMonth(); // 0–11

    // TAX EVENTS
    if (annualTax > 0) {
      const perTaxPayment = (() => {
        switch (taxFrequency) {
          case "semiannual":
            return annualTax / 2;
          case "quarterly":
            return annualTax / 4;
          default:
            return annualTax;
        }
      })();

      const numPayments = (() => {
        switch (taxFrequency) {
          case "semiannual":
            return 2;
          case "quarterly":
            return 4;
          default:
            return 1;
        }
      })();

      const baseMonth = nextTaxDueMonth - 1; // 0–11
      const step = taxFrequency === "quarterly" ? 3 : taxFrequency === "semiannual" ? 6 : 12;

      for (let p = 0; p < numPayments; p++) {
        const monthIndex = (baseMonth + p * step) % 12;
        let offset = monthIndex - fpMonthIndex;
        if (offset < 0) offset += 12;
        if (offset >= 0 && offset < 12) {
          events[offset].tax += perTaxPayment;
        }
      }
    }

    // INSURANCE EVENTS
    if (annualIns > 0) {
      const insMonthIndex = nextInsDueDate.getMonth(); // 0–11
      let offset = insMonthIndex - fpMonthIndex;
      if (offset < 0) offset += 12;
      if (offset >= 0 && offset < 12) {
        events[offset].ins += annualIns;
      }
    }

    return events;
  }

  function determineSections(inputs, calc) {
    const { loanType, closingDate, annualTax } = inputs;
    const { taxDeposit, insDeposit } = calc;

    const F = [];
    const G = [];

    // Always in Section F: prepaid interest
    F.push("Prepaid interest (closing → end of month)");

    if (loanType === "purchase") {
      // Purchases: 12 months HOI always in F
      F.push("12 months homeowners insurance premium (HOI)");

      if (annualTax > 0 && shouldCollectPrepaidTaxesPurchase(inputs)) {
        F.push("Prepaid property taxes (state/county dependent)");
      }

      G.push(`Tax escrow deposit: ${formatCurrency(taxDeposit)}`);
      G.push(`Insurance escrow deposit: ${formatCurrency(insDeposit)}`);
      G.push("Cushion (typically 2 months)");
      G.push("Aggregate adjustment");

    } else if (loanType === "refi") {
      // Refis: no 12-month HOI in F
      if (annualTax > 0 && shouldCollectPrepaidTaxesRefi(inputs)) {
        F.push("Prepaid property taxes (due within ~60 days)");
      }

      G.push(`Tax escrow deposit: ${formatCurrency(taxDeposit)}`);
      G.push(`Insurance escrow deposit: ${formatCurrency(insDeposit)}`);
      G.push("Cushion (2 months max under RESPA)");
      G.push("Aggregate adjustment");
    }

    return { F, G };
  }

  function shouldCollectPrepaidTaxesPurchase(inputs) {
    // Placeholder: you can wire in a real state matrix later.
    // For now, default to false unless you want to force it.
    return false;
  }

  function shouldCollectPrepaidTaxesRefi(inputs) {
    // Collect prepaid taxes if due within ~60 days of closing.
    if (!inputs.closingDate) return false;
    const billMonthIndex = (inputs.nextTaxDueMonth || 1) - 1;
    const billDate = new Date(inputs.closingDate.getFullYear(), billMonthIndex, 1);

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysDiff = (billDate - inputs.closingDate) / msPerDay;

    return daysDiff >= 0 && daysDiff <= 60;
  }

  // Helpers
  function formatCurrency(amount) {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    });
  }

  function renderResults(result) {
    const {
      taxDeposit,
      taxMonthsCollected,
      insDeposit,
      insMonthsCollected,
      totalDeposit,
      aggregateAdjustment,
      aggregateDirection,
      aggDetails,
      sectionBreakdown,
      notes
    } = result;

    els.resultTaxDeposit.textContent =
      taxDeposit > 0 ? formatCurrency(taxDeposit) : "—";
    els.resultTaxMonths.textContent =
      taxDeposit > 0
        ? `Months collected: ${taxMonthsCollected.toFixed(2)}`
        : "Months collected: —";

    els.resultInsDeposit.textContent =
      insDeposit > 0 ? formatCurrency(insDeposit) : "—";
    els.resultInsMonths.textContent =
      insDeposit > 0
        ? `Months collected: ${insMonthsCollected.toFixed(2)}`
        : "Months collected: —";

    els.resultTotalDeposit.textContent =
      totalDeposit > 0 ? formatCurrency(totalDeposit) : "—";

    if (Math.abs(aggregateAdjustment) > 0.01) {
      const label =
        aggregateDirection === "increase"
          ? "Increase deposit by "
          : aggregateDirection === "decrease"
          ? "Decrease deposit (credit) by "
          : "";
      els.resultAggregateAdj.textContent = label + formatCurrency(Math.abs(aggregateAdjustment));
      els.resultAggregateDetails.textContent = aggDetails;
    } else {
      els.resultAggregateAdj.textContent = "≈ $0.00";
      els.resultAggregateDetails.textContent =
        "Aggregate adjustment is negligible with current assumptions.";
    }

    // Section F vs G
    els.resultSectionF.innerHTML = "";
    sectionBreakdown.F.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      els.resultSectionF.appendChild(li);
    });

    els.resultSectionG.innerHTML = "";
    sectionBreakdown.G.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      els.resultSectionG.appendChild(li);
    });

    // Notes
    els.resultNotes.innerHTML = "";
    notes.forEach((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      els.resultNotes.appendChild(li);
    });
  }
});