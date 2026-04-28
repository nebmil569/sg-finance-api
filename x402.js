/**
 * x402 Payment Handler for Singapore Finance API
 * Implements x402 v2 payment verification locally (no facilitator needed for basic checks)
 */

const RECEIVING_WALLET = process.env.RECEIVING_WALLET || '0x50F9D979b825670A9936D992F5db8AEd9497208A';
const USDC_ON_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAX_TIMEOUT = 300;

// x402 content-type for payment required
const X402_MEDIA_TYPE = 'application/x402+json';

/**
 * Parse a base64-encoded x402 payment token from Bearer header.
 */
function parseBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    // x402 tokens are base64-encoded JSON
    const padded = token.length % 4 === 0 ? token : token + '='.repeat(4 - (token.length % 4));
    const decoded = Buffer.from(padded, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Verify x402 payment token is valid and sufficient for the requested price.
 * Returns { valid: boolean, error: string|null }
 */
function verifyPayment(authHeader, priceUSDC) {
  const payload = parseBearerToken(authHeader);
  if (!payload) return { valid: false, error: 'Missing or invalid x402 payment token — use Authorization: Bearer <token>' };

  const required = BigInt(Math.round(priceUSDC * 1e6)); // microUSDC
  const amount = BigInt(payload.amount || '0');
  const network = payload.network || '';
  const payTo = payload.pay_to || '';
  const signature = payload.signature || '';

  if (amount < required) {
    const got = Number(amount / BigInt(1e6)).toFixed(4);
    const need = priceUSDC.toFixed(2);
    return { valid: false, error: 'Insufficient payment: got $' + got + ', need $' + need };
  }
  if (network && network !== 'eip155:8453' && network !== 'eip155:84532') {
    return { valid: false, error: 'Wrong network: ' + network + ' — use Base (eip155:8453)' };
  }
  if (!signature) return { valid: false, error: 'Payment token missing signature' };
  if (payTo && payTo.toLowerCase() !== RECEIVING_WALLET.toLowerCase()) {
    return { valid: false, error: 'Payment sent to wrong address: ' + payTo + ' — expected ' + RECEIVING_WALLET };
  }
  return { valid: true, error: null };
}

/**
 * Create a 402 Payment Required response.
 */
function paymentRequired(priceUSDC, resource) {
  const amount = String(Math.round(priceUSDC * 1e6));
  return {
    status: 402,
    headers: {
      'Content-Type': X402_MEDIA_TYPE,
      'WWW-Authenticate': `x402 price="${amount}",n="USDC",p="base",g="${resource}"`
    },
    body: {
      error: 'Payment Required',
      resource: { url: resource },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        asset: USDC_ON_BASE,
        amount,
        payTo: RECEIVING_WALLET,
        maxTimeoutSeconds: MAX_TIMEOUT,
        extra: {}
      }]
    }
  };
}

/**
 * Express middleware: enforce x402 payment for a given price and path.
 */
function requirePayment(priceUSDC, path) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    const { valid, error } = verifyPayment(auth, priceUSDC);
    if (!valid) {
      const { status, headers, body } = paymentRequired(priceUSDC, path);
      res.set(headers);
      return res.status(status).json(body);
    }
    next();
  };
}

module.exports = { parseBearerToken, verifyPayment, paymentRequired, requirePayment, RECEIVING_WALLET, USDC_ON_BASE };