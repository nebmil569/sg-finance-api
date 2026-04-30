# Singapore Finance x402 API

Node.js + Express API with x402 v2 payment enforcement on all paid endpoints.

## Endpoints

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/health` | free | Health check |
| GET | `/forex/convert` | free | SGD↔USD conversion via Yahoo Finance |
| POST | `/mortgage/compare` | $0.01 USDC | HDB vs bank mortgage comparison (TDSR, MSR, interest) |
| POST | `/property/absd` | $0.01 USDC | Additional Buyer's Stamp Duty calculator |

## Payment

All paid endpoints require x402 v2 payment header:
```
Authorization: Bearer <x402_payment_token>
```

Payment settled on Base (eip155:8453) to: `0x50F9D979b825670A9936D992F5db8AEd9497208A`

## Quick Start

```bash
npm install
node index.js
```

## Deploy

```bash
# Local
node index.js

# Railway (TODO)
railway login
railway init
railway up
```

## x402 Protocol

Implements x402 v2 Payment Required responses. Tokens are base64-encoded JSON payloads validated locally (no facilitator needed).