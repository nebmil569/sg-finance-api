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

app.listen(PORT, () => {
  console.log(`Singapore Finance API running on port ${PORT}`);
});

module.exports = app;