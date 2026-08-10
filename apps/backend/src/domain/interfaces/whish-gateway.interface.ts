/**
 * Whish Money — the online payment route.
 *
 * The provider's HTTP contract is not available yet, so this interface is
 * written from what the *flow* needs rather than from their documentation:
 * start a payment, send the citizen somewhere to authorise it, and later be
 * told whether it happened. Those three facts are what every hosted-checkout
 * provider offers under different names, so the surrounding state machine —
 * which is fully implemented — should survive meeting the real API.
 */

export const WHISH_GATEWAY = Symbol('WHISH_GATEWAY');

export interface WhishCheckout {
  /**
   * Where to send the citizen to authorise the payment.
   *
   * In sandbox this is a page inside this portal, because there is nowhere else
   * to send them yet; in live mode it is the provider's hosted page.
   */
  redirectUrl: string;
  /**
   * The provider's own identifier for this attempt.
   *
   * Stored on the invoice so an asynchronous callback can be matched back to
   * the row that started it — the citizen's session is long gone by then, and
   * the amount alone cannot identify which of two identical bills was paid.
   */
  externalRef: string;
}

export interface WhishCallback {
  externalRef: string;
  /** Minor-unit-free, in the invoice's own currency. */
  amount: number;
  succeeded: boolean;
  /** The provider's transaction number, printed on the citizen's receipt. */
  transactionRef: string;
}

export interface WhishGateway {
  /** True once real credentials are configured. Sandbox behaviour differs. */
  readonly isLive: boolean;

  createCheckout(input: {
    paymentId: string;
    amount: number;
    currency: string;
    citizenName: string;
    /** Where the provider should POST the result. */
    callbackUrl: string;
    /** Where the provider should send the citizen's browser afterwards. */
    returnUrl: string;
  }): Promise<WhishCheckout>;

  /**
   * Confirms a callback genuinely came from Whish and returns what it says.
   *
   * Returns `null` for anything that fails verification, so a caller cannot
   * accidentally treat an unsigned body as authentic by forgetting to check a
   * boolean — the only way to get a payload out is to pass verification.
   */
  parseCallback(input: { rawBody: string; signature?: string }): WhishCallback | null;
}
