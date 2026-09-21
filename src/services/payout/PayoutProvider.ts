import logger from '../../config/logger';

export interface IPayoutTransferRequest {
  payoutId: string;
  sellerId: string;
  amountPaise: number;
  bankAccount: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    bankName?: string;
  };
  referenceNumber?: string;
}

export interface IPayoutTransferResult {
  success: boolean;
  status: 'PROCESSING' | 'SETTLED' | 'FAILED';
  providerReferenceId?: string;
  failureReason?: string;
}

export interface IPayoutProvider {
  name: string;
  initiateTransfer(req: IPayoutTransferRequest): Promise<IPayoutTransferResult>;
}

/**
 * Mock provider for testing and local environments when live Cashfree Payout
 * credentials are not configured.
 */
export class MockPayoutProvider implements IPayoutProvider {
  name = 'MOCK';

  async initiateTransfer(req: IPayoutTransferRequest): Promise<IPayoutTransferResult> {
    logger.info('[PayoutProvider:MOCK] Initiating transfer simulation', {
      payoutId: req.payoutId,
      sellerId: req.sellerId,
      amountPaise: req.amountPaise,
      accountNumberMasked: `•••• ${req.bankAccount.accountNumber.slice(-4)}`,
      ifscCode: req.bankAccount.ifscCode,
    });

    return {
      success: true,
      status: 'PROCESSING',
      providerReferenceId: `MOCK_TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
    };
  }
}

/**
 * Cashfree Payouts API provider for direct bank disbursements.
 */
export class CashfreePayoutProvider implements IPayoutProvider {
  name = 'CASHFREE';

  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;

  constructor() {
    this.clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID || process.env.CASHFREE_CLIENT_ID || '';
    this.clientSecret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET || process.env.CASHFREE_CLIENT_SECRET || '';
    const env = process.env.CASHFREE_ENV || 'sandbox';
    this.baseUrl =
      process.env.CASHFREE_PAYOUT_URL ||
      (env === 'production'
        ? 'https://payout-api.cashfree.com/payout/v1'
        : 'https://sandbox.cashfree.com/payout/v1');
  }

  async initiateTransfer(req: IPayoutTransferRequest): Promise<IPayoutTransferResult> {
    if (!this.clientId || !this.clientSecret) {
      logger.warn('[PayoutProvider:CASHFREE] Cashfree Payout credentials unset; falling back to simulation', {
        payoutId: req.payoutId,
      });
      return new MockPayoutProvider().initiateTransfer(req);
    }

    try {
      logger.info('[PayoutProvider:CASHFREE] Dispatching transfer request', {
        payoutId: req.payoutId,
        amountPaise: req.amountPaise,
        accountMasked: `•••• ${req.bankAccount.accountNumber.slice(-4)}`,
      });

      // Amount in rupees for Cashfree Transfers API
      const amountRupees = Number((req.amountPaise / 100).toFixed(2));

      const payload = {
        transferId: req.payoutId,
        amount: amountRupees,
        transferMode: 'banktransfer',
        remarks: `ExtraHand Seller Payout ${req.payoutId}`,
        beneDetails: {
          name: req.bankAccount.accountHolderName,
          bankAccount: req.bankAccount.accountNumber,
          ifsc: req.bankAccount.ifscCode,
        },
      };

      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/requestTransfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': this.clientId,
          'X-Client-Secret': this.clientSecret,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;

      if (!response.ok || data.status === 'ERROR' || data.subCode === '400') {
        const errorMsg = data.message || data.subCode || `HTTP ${response.status}`;
        logger.error('[PayoutProvider:CASHFREE] Transfer request rejected by Cashfree', {
          payoutId: req.payoutId,
          error: errorMsg,
          data,
        });
        return {
          success: false,
          status: 'FAILED',
          failureReason: errorMsg,
        };
      }

      const referenceId = data.data?.referenceId || data.referenceId;
      const transferStatus = data.data?.status || data.status;

      logger.info('[PayoutProvider:CASHFREE] Transfer successfully accepted', {
        payoutId: req.payoutId,
        referenceId,
        transferStatus,
      });

      return {
        success: true,
        status: transferStatus === 'SUCCESS' ? 'SETTLED' : 'PROCESSING',
        providerReferenceId: referenceId ? String(referenceId) : undefined,
      };
    } catch (err: any) {
      logger.error('[PayoutProvider:CASHFREE] Network/transport error during transfer', {
        payoutId: req.payoutId,
        error: err?.message,
      });
      return {
        success: false,
        status: 'FAILED',
        failureReason: err?.message || 'Network error communicating with Cashfree Payout API',
      };
    }
  }
}

let activeProvider: IPayoutProvider | null = null;

export function getPayoutProvider(): IPayoutProvider {
  if (activeProvider) return activeProvider;

  const providerType = (process.env.PAYOUT_PROVIDER || 'mock').toLowerCase();
  if (providerType === 'cashfree') {
    activeProvider = new CashfreePayoutProvider();
  } else {
    activeProvider = new MockPayoutProvider();
  }

  return activeProvider;
}

export function setPayoutProviderForTest(provider: IPayoutProvider | null) {
  activeProvider = provider;
}
