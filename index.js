/**
 * Singapore Finance x402 API
 * Node.js + Express — x402 payment enforced on all paid endpoints
 * 
 * Endpoints:
 * - POST /mortgage/compare  ($0.01) — HDB vs bank loan comparison
 * - POST /property/absd     ($0.01) — Additional Buyer's Stamp Duty calculator
 * - GET  /forex/convert     (free)  — SGD↔USD forex
 * - GET  /health            (free)  — health check
 */
const express = require('express');
const { requirePayment, paymentRequired } = require('./x402');

const app = express();
app.use(express.json());

const RECEIVING_WALLET = process.env.RECEIVING_WALLET || '0x50F9D979b825670A9936D992F5db8AEd9497208A';
const PORT = process.env.PORT || 8000;
const PRICE_COE = 0.01;
const PRICE_MORTGAGE = 0.01;
const PRICE_ABSD = 0.01;

// ── COE CATEGORIES & FALLBACK DATA ─────────────────────────────────────────
const COE_CATEGORIES = {
  "A": "Cat A (cars up to 1600cc & 97kW)",
  "B": "Cat B (cars above 1600cc or 97kW)",
  "C": "Cat C (goods vehicles & buses)",
  "D": "Cat D (motorcycles)",
  "E": "Cat E (open category)",
};

const KNOWN_COE_PRICES = {
  "Cat A (cars up to 1600cc & 97kW)": { premium: "$106,000", date: "2026-04", trend: "stable", note: "April 2026 1st bidding" },
  "Cat B (cars above 1600cc or 97kW)": { premium: "$128,000", date: "2026-04", trend: "rising", note: "April 2026 1st bidding" },
  "Cat C (goods vehicles & buses)": { premium: "$76,000", date: "2026-04", trend: "stable", note: "April 2026 1st bidding" },
  "Cat D (motorcycles)": { premium: "$9,801", date: "2026-04", trend: "rising", note: "April 2026 1st bidding" },
  "Cat E (open category)": { premium: "$130,000", date: "2026-04", trend: "rising", note: "April 2026 1st bidding" },
};

async function fetchLtaCoe() {
  const https = require('https');
  const resourceIds = [
    'ecda00d4-4dc6-4e90-bd47-070df4575f94',
    '8da8f2b7-ccb6-4eb5-9477-c0f4d8d3f951',
  ];
  for (const rid of resourceIds) {
    try {
      const data = await new Promise((resolve, reject) => {
        const url = `https://data.gov.sg/api/action/datastore_search_json?resource_id=${rid}&limit=10`;
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
      });
      const records = data?.result?.records || [];
      if (records.length > 0) return records;
    } catch { continue; }
  }
  return null;
}

// ── FREE ENDPOINTS ──────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Singapore Finance x402 API',
    version: '1.0.0',
    network: 'Base (eip155:8453)',
    endpoints: [
      { path: '/mortgage/compare', method: 'POST', price: '$0.01 USDC', description: 'HDB vs bank mortgage comparison' },
      { path: '/property/absd',   method: 'POST', price: '$0.01 USDC', description: 'ABSD calculator' },
      { path: '/forex/convert',   method: 'GET',  price: 'free',       description: 'SGD↔USD forex rate' },
    ]
  });
});

app.get('/forex/convert', async (req, res) => {
  // Free endpoint: SGD → USD conversion
  const https = require('https');
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d';
  
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    
    const meta = data?.chart?.result?.[0];
    const meta2 = data?.chart?.result?.[0]?.meta;
    const rate = meta2?.regularMarketPrice || meta2?.previousClose;
    
    res.json({
      from: 'USD', to: 'SGD',
      rate: rate ? parseFloat(rate.toFixed(4)) : 1.34,
      inverse: rate ? parseFloat((1/rate).toFixed(4)) : 0.746,
      source: 'Yahoo Finance',
      cached: false,
      message: 'Add Authorization header for paid endpoints'
    });
  } catch {
    res.json({ from: 'USD', to: 'SGD', rate: 1.34, inverse: 0.746, source: 'fallback' });
  }
});

// ── PAID ENDPOINTS ───────────────────────────────────────────────────────────

// POST /mortgage/compare — $0.01 USDC
app.post('/mortgage/compare', (req, res, next) => {
  const check = require('./x402').verifyPayment(req.headers.authorization || '', 0.01);
  if (!check.valid) {
    const { status, headers, body } = paymentRequired(0.01, '/mortgage/compare');
    res.set(headers); return res.status(status).json(body);
  }
  next();
}, async (req, res) => {
  const { property_price = 500000, loan_percentage = 80, loan_type = 'both' } = req.body;
  
  const hdb_rate = 2.6 / 100;
  const bank_rate = 3.5 / 100;
  const ltv = loan_percentage / 100;
  
  const hdb_loan = property_price * ltv;
  const bank_loan = property_price * ltv;
  
  // 25-year loan (HDB max) vs 30-year loan (bank max)
  const hdb_monthly = (hdb_loan * hdb_rate * Math.pow(1 + hdb_rate, 300)) / (Math.pow(1 + hdb_rate, 300) - 1);
  const bank_monthly_25 = (bank_loan * bank_rate * Math.pow(1 + bank_rate, 300)) / (Math.pow(1 + bank_rate, 300) - 1);
  const bank_monthly_30 = (bank_loan * bank_rate * Math.pow(1 + bank_rate, 360)) / (Math.pow(1 + bank_rate, 360) - 1);
  
  const hdb_total = hdb_monthly * 300;
  const bank_total_25 = bank_monthly_25 * 300;
  const bank_total_30 = bank_monthly_30 * 360;
  
  const tdsr_limit = property_price * 0.55 / 12; // MAS 55% TDSR
  const msr_limit = property_price * 0.3 / 12;   // MAS 30% MSR for HDB
  
  res.json({
    property_price, loan_percentage,
    hdb_loan: Math.round(hdb_loan),
    bank_loan: Math.round(bank_loan),
    hdb: {
      rate: '2.6%', tenure_years: 25,
      monthly_payment: Math.round(hdb_monthly),
      total_interest: Math.round(hdb_total - hdb_loan),
      total_cost: Math.round(hdb_total),
      msr_monthly: Math.round(Math.min(hdb_monthly, msr_limit)),
    },
    bank_25: {
      rate: '3.5%', tenure_years: 25,
      monthly_payment: Math.round(bank_monthly_25),
      total_interest: Math.round(bank_total_25 - bank_loan),
      total_cost: Math.round(bank_total_25),
    },
    bank_30: {
      rate: '3.5%', tenure_years: 30,
      monthly_payment: Math.round(bank_monthly_30),
      total_interest: Math.round(bank_total_30 - bank_loan),
      total_cost: Math.round(bank_total_30),
    },
    affordability: {
      tdsr_limit_monthly: Math.round(tdsr_limit),
      msr_limit_monthly: Math.round(msr_limit),
      bank_qualifies_25: bank_monthly_25 <= tdsr_limit,
      bank_qualifies_30: bank_monthly_30 <= tdsr_limit,
    },
    recommendation: hdb_total <= bank_total_25 ? 'HDB loan cheaper — use HDB' : 'Bank loan may be competitive — compare features',
    price_charged: '0.01',
    network: 'Base (eip155:8453)'
  });
});

// POST /property/absd — $0.01 USDC
app.post('/property/absd', (req, res, next) => {
  const check = require('./x402').verifyPayment(req.headers.authorization || '', 0.01);
  if (!check.valid) {
    const { status, headers, body } = paymentRequired(0.01, '/property/absd');
    res.set(headers); return res.status(status).json(body);
  }
  next();
}, (req, res) => {
  const {
    property_value = 1000000,
    buyer_type = 'singapore_citizen',  // sg_citizen, spr, foreigner, entity
    previous_properties = 0,
    is_loan_before = true
  } = req.body;
  
  // ABSD rates (2023 onwards)
  const rates = {
    sg_citizen: [0, 0.05, 0.10, 0.15, 0.15],           // 0, 1st, 2nd, 3rd, 4th+
    spr:         [0.05, 0.10, 0.15, 0.15, 0.15],       // 1st at 5%, then 10%+
    foreigner:   [0.30, 0.30, 0.30, 0.30, 0.30],       // 30% flat for foreigners
    entity:      [0.40, 0.40, 0.40, 0.40, 0.40],       // 40% for entities
  };
  
  const buyerRates = rates[buyer_type] || rates.sg_citizen;
  const idx = Math.min(previous_properties, 4);
  const absd_rate = buyerRates[idx];
  const absd_amount = property_value * absd_rate;
  
  const purchase_tax = property_value * 0.01; // BSD at 1% for residential
  
  res.json({
    property_value, buyer_type, previous_properties,
    absd_rate: `${(absd_rate * 100).toFixed(0)}%`,
    absd_amount: Math.round(absd_amount),
    buyer_stamp_duty: Math.round(purchase_tax),
    total_tax: Math.round(absd_amount + purchase_tax),
    absd_note: buyer_type === 'foreigner' ? '30% ABSD — may be remissible for certain developments' :
               buyer_type === 'entity'    ? '40% ABSD — no remissions for entities' :
               'ABSD may be remitted if selling within 5 years (Sellers Stamp Duty)',
    price_charged: '0.01',
    network: 'Base (eip155:8453)'
  });
});

// ── COE ENDPOINTS ─────────────────────────────────────────────────────────────

// GET /coe → 402 Payment Required (must use POST)
app.get('/coe', (req, res) => {
  const { status, headers, body } = paymentRequired(PRICE_COE, '/coe');
  res.set(headers); return res.status(status).json(body);
});

// POST /coe — all categories ($0.01 USDC)
app.post('/coe', (req, res, next) => {
  const check = require('./x402').verifyPayment(req.headers.authorization || '', PRICE_COE);
  if (!check.valid) {
    const { status, headers, body } = paymentRequired(PRICE_COE, '/coe');
    res.set(headers); return res.status(status).json(body);
  }
  next();
}, async (req, res) => {
  const liveRecords = await fetchLtaCoe();
  if (liveRecords && liveRecords.length > 0) {
    const parsed = {};
    for (const r of liveRecords) {
      const cat = r.category || '';
      parsed[cat] = {
        premium: r.premium || '',
        date: (r.application_open_date || '').substring(0, 7),
        trend: 'unknown',
        note: `as of ${r.application_open_date || 'unknown'}`,
      };
    }
    return res.json({
      data: {
        all_categories: parsed,
        data_source: 'LTA / data.gov.sg (live)',
        fetched_at: new Date().toISOString(),
      }
    });
  }
  res.json({
    data: {
      all_categories: KNOWN_COE_PRICES,
      data_source: 'LTA fallback (April 2026 1st bidding exercise)',
      note: 'Live API unavailable — using latest known COE prices. Next update: May 2026.',
      fetched_at: new Date().toISOString(),
    }
  });
});

// POST /coe/{category} — single category ($0.01 USDC)
app.post('/coe/:category', (req, res, next) => {
  const check = require('./x402').verifyPayment(req.headers.authorization || '', PRICE_COE);
  if (!check.valid) {
    const { status, headers, body } = paymentRequired(PRICE_COE, `/coe/${req.params.category}`);
    res.set(headers); return res.status(status).json(body);
  }
  next();
}, async (req, res) => {
  const catUpper = req.params.category.toUpperCase();
  if (!COE_CATEGORIES[catUpper]) {
    return res.status(400).json({ error: `Invalid category: ${req.params.category}. Valid: A, B, C, D, E` });
  }
  const catName = COE_CATEGORIES[catUpper];
  const liveRecords = await fetchLtaCoe();
  if (liveRecords && liveRecords.length > 0) {
    for (const r of liveRecords) {
      if (r.category === catName || r.category === catUpper) {
        return res.json({
          data: {
            category_code: catUpper,
            category_name: catName,
            premium: r.premium || '',
            date: (r.application_open_date || '').substring(0, 7),
            data_source: 'LTA / data.gov.sg (live)',
            fetched_at: new Date().toISOString(),
          }
        });
      }
    }
  }
  const coeData = KNOWN_COE_PRICES[catName] || {};
  res.json({
    data: {
      category_code: catUpper,
      category_name: catName,
      premium: coeData.premium || '',
      date: coeData.date || '',
      trend: coeData.trend || 'unknown',
      note: coeData.note || '',
      data_source: 'LTA fallback (April 2026 1st bidding exercise)',
      fetched_at: new Date().toISOString(),
    }
  });
});

// ── CAR LOAN ENDPOINT ──────────────────────────────────────────────────────

// POST /car/loan — car loan + PARF calculator ($0.01 USDC)
app.post('/car/loan', (req, res, next) => {
  const check = require('./x402').verifyPayment(req.headers.authorization || '', PRICE_COE);
  if (!check.valid) {
    const { status, headers, body } = paymentRequired(PRICE_COE, '/car/loan');
    res.set(headers); return res.status(status).json(body);
  }
  next();
}, (req, res) => {
  const {
    vehicle_price = 95000,
    coe_premium = 95000,
    down_payment = 10000,
    loan_tenure_years = 7,
    interest_rate = 2.98 / 100,
    vehicle_type = 'sedan',
    deregistration_age = 10,
  } = req.body;

  const loan_amount = vehicle_price - down_payment;
  const monthly_rate = interest_rate / 12;
  const total_payments = loan_tenure_years * 12;
  const monthly_installment = (loan_amount * monthly_rate * Math.pow(1 + monthly_rate, total_payments)) /
    (Math.pow(1 + monthly_rate, total_payments) - 1);

  const total_interest = (monthly_installment * total_payments) - loan_amount;
  const total_cost = vehicle_price + total_interest;

  // PARF calculation
  const registration_date = new Date();
  registration_date.setFullYear(registration_date.getFullYear() - deregistration_age);
  const age_years = deregistration_age;
  let parfRebate = 0;
  if (age_years <= 5) parfRebate = coe_premium * 0.75;
  else if (age_years <= 7) parfRebate = coe_premium * 0.60;
  else if (age_years <= 10) parfRebate = coe_premium * 0.50;
  else parfRebate = 0;

  const dep_value = vehicle_price - (vehicle_price * 0.20 * age_years);
  const tdsr_limit = (vehicle_price * 0.60) / 12;

  res.json({
    vehicle_price, coe_premium, down_payment, loan_tenure_years, interest_rate,
    loan_amount: Math.round(loan_amount),
    monthly_installment: Math.round(monthly_installment),
    total_interest: Math.round(total_interest),
    total_cost: Math.round(total_cost),
    parf_rebate: Math.round(parfRebate),
    dep_value_at_dereg: Math.max(0, Math.round(dep_value)),
    tdsr_limit_monthly: Math.round(tdsr_limit),
    qualifies_tdsr: monthly_installment <= tdsr_limit,
    price_charged: '0.01',
    network: 'Base (eip155:8453)',
  });
});

app.listen(PORT, () => {
  console.log(`Singapore Finance API running on port ${PORT}`);
});

module.exports = app;