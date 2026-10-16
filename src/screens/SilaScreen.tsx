/**
 * SilaScreen.tsx — شاشة «صِلة والقسائم» لسطح المكتب (UI-3).
 * ─────────────────────────────────────────────────────────────────
 * منقولة بالمنطق من شاشة صِلة الأندرويد (SilaScreen + VouchersTab +
 * VoucherRedeemSheet) إلى React DOM باتفاقيات سطح المكتب
 * (card / btn / chip / grid-4 / table.data / overlay / modal).
 *
 * البنية:
 *  • غير مقترن: بطاقة الربط (رمز الربط من تطبيق صِلة → POST
 *    /api/pos/pair ثم silaStore.setPairing + SilaSync.start).
 *  • مقترن: بطاقة حالة الربط والمزامنة (اسم التاجر، معاينة رمز
 *    نقطة البيع، آخر مزامنة، عدادات الطابور) + تبويبان:
 *      - «الديون والمزامنة»: مؤشرات، طابور الديون (بحث/تصفية/ترقيم)
 *        مع شرائح الحالة وزر إعادة المحاولة للفاشلة، وزبائن صِلة
 *        بأرصدتهم من دفاتر المتجر المحلية.
 *      - «قسائم الحملات»: المستحق لك، جدول الحملات (متاحة/مفعّلة/
 *        مكتملة + التفعيل باتجاه واحد)، سجل الصرف (إكمال المعلّقة
 *        عبر completePendingRedemption + إعادة الطباعة)، تسويات
 *        المؤسسات، ونافذة «استبدال قسيمة» الداخلية (صرف مستقل
 *        بدون سلة — نفس بنية خيارات VoucherRedeemSheet الأندرويد).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useToastStore} from '../state/appStores';
import {useSilaStore} from '../stores/silaStore';
import {useSettingsStore} from '../stores/settingsStore';
import {usePrinterStore} from '../stores/printerStore';
import {SilaRepo} from '../services/sila/SilaRepo';
import {SilaSync} from '../services/sila/SilaSync';
import {VouchersRepo} from '../services/sila/VouchersRepo';
import {VoucherService, VoucherRedeemError} from '../services/VoucherService';
import type {VoucherRedeemSuccess} from '../services/VoucherService';
import {InvoiceService} from '../services/InvoiceService';
import {SILA_DEFAULT_BASE_URL, silaPair} from '../services/sila/SilaApi';
import {normalizePairingCode, parseSilaVoucherCode} from '../services/sila/qr';
import {classifyCampaignKind} from '../services/sila/campaignKind';
import {getString, KEYS} from '../storage/storage';
import {APP_VERSION} from '../core/config';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  relativeTime,
} from '../core/format';
import type {ReceiptSettings} from '../services/printer/receipt';
import type {
  CampaignDebtRow,
  CampaignSettlementRow,
  SilaCustomer,
  SilaDebtRow,
  VoucherRedemptionRow,
} from '../core/types';
import {Icon} from '../components/Icon';
import './sila.css';

// ── ثوابت العرض ──────────────────────────────────────────────────

const PAGE_SIZE = 20;

type SilaTab = 'debts' | 'vouchers';

type DebtFilter = 'all' | 'failed' | 'pending' | 'synced';

const DEBT_FILTERS: {value: DebtFilter; label: string}[] = [
  {value: 'all', label: 'الكل'},
  {value: 'failed', label: 'فشل'},
  {value: 'pending', label: 'بالانتظار'},
  {value: 'synced', label: 'مُزامن'},
];

/** شرائح حالة صف الدين (طابور الديون). */
const DEBT_STATE_CHIP: Record<
  SilaDebtRow['state'],
  {label: string; cls: string}
> = {
  pending: {label: 'بالانتظار', cls: 'muted'},
  syncing: {label: 'قيد المزامنة', cls: 'warn'},
  synced: {label: 'مُزامن', cls: 'ok'},
  failed: {label: 'فشل', cls: 'danger'},
};

/** شرائح حالة عملية صرف القسيمة (سجل الصرف). */
const REDEMPTION_STATE_CHIP: Record<
  VoucherRedemptionRow['state'],
  {label: string; cls: string}
> = {
  ok: {label: 'مصروفة', cls: 'ok'},
  pending: {label: 'بالانتظار', cls: 'warn'},
  failed: {label: 'فشل', cls: 'danger'},
};

/** شرائح دورة حياة الحملة داخل المتجر (باتجاه واحد). */
const CAMPAIGN_STATE_CHIP: Record<
  CampaignDebtRow['store_state'],
  {label: string; cls: string}
> = {
  available: {label: 'متاحة', cls: 'brand'},
  active: {label: 'مفعّلة', cls: 'ok'},
  completed: {label: 'مكتملة', cls: 'muted'},
};

const SETTLEMENT_STATE_LABEL: Record<
  CampaignDebtRow['settlement_state'],
  {label: string; title: string}
> = {
  none: {label: 'لا شيء', title: 'لم تصل أي تسوية بعد'},
  partial: {label: 'جزئية', title: 'استلمت جزءاً من مستحقاتك'},
  full: {label: 'كاملة', title: 'مسدَّدة كاملة'},
};

const SETTLEMENT_STATUS_CHIP: Record<
  CampaignSettlementRow['status'],
  {label: string; cls: string}
> = {
  pending: {label: 'بانتظار التأكيد', cls: 'warn'},
  confirmed: {label: 'مؤكدة', cls: 'ok'},
  disputed: {label: 'متنازع عليها', cls: 'danger'},
  cancelled: {label: 'ملغاة', cls: 'muted'},
};

const SETTLEMENT_KIND_LABEL: Record<string, string> = {
  compensation: 'تعويض',
  advance: 'دفعة مقدمة',
};

/** 'YYYY-MM-DDTHH:MM:SS' → صيغة relativeTime ('YYYY-MM-DD HH:MM:SS'). */
function friendlyTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
}

function tokenPreview(token: string): string {
  const clean = token.trim();
  if (clean.length <= 12) {
    return `${clean}••••`;
  }
  return `${clean.slice(0, 10)}••••`;
}

function kindLabelOf(campaign: CampaignDebtRow): string {
  return classifyCampaignKind(campaign.kind, campaign.campaign_name) ===
    'parcel'
    ? 'طرد'
    : 'قسيمة شرائية';
}

// ── نافذة «استبدال قسيمة» (مكوّن داخلي) ──────────────────────────
// نفس مسار VoucherRedeemSheet الأندرويد من شاشة صِلة: صرف مستقل
// بدون سلة (mode: 'parcel') — نداء حي واحد عبر VoucherService.
// redeemVoucher بمفتاح idempotency واحد لا يتغير، ثم إكمال تلقائي
// من محرك المزامنة عند انقطاع الاتصال (§5 قاعدة 1/§7.3).

type RedeemStep =
  | {phase: 'input'}
  | {phase: 'calling'}
  | {phase: 'success'; data: VoucherRedeemSuccess; counterMinor: number}
  | {
      phase: 'error';
      message: string;
      pendingRetry: boolean;
      permanent: boolean;
    };

interface RedeemModalProps {
  open: boolean;
  onClose: () => void;
  /** يُستدعى بعد إغلاق نافذة النجاح (تحديث سجل الصرف والحملات). */
  onRedeemed: () => void;
  receiptSettings: ReceiptSettings;
  printerConnected: boolean;
}

function VoucherRedeemModal({
  open,
  onClose,
  onRedeemed,
  receiptSettings,
  printerConnected,
}: RedeemModalProps) {
  const toast = useToastStore(s => s.show);
  const pairing = useSilaStore(s => s.pairing);

  const [step, setStep] = useState<RedeemStep>({phase: 'input'});
  const [codeText, setCodeText] = useState('');
  const [counterText, setCounterText] = useState('');
  const [reprinting, setReprinting] = useState(false);

  // تصفير الحالة عند كل فتح.
  useEffect(() => {
    if (open) {
      setStep({phase: 'input'});
      setCodeText('');
      setCounterText('');
      setReprinting(false);
    }
  }, [open]);

  /** الفرق النقدي عند الكاشير: أرقام فقط ≤ فاصلتين عشريتين (0 فراغاً). */
  const parseCounterMinor = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return 0;
    }
    const normalized = trimmed.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
      return null;
    }
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0 || value > 1000000) {
      return null;
    }
    return Math.round(value * 100);
  };

  const submit = useCallback(async () => {
    if (step.phase === 'calling') {
      return;
    }
    const parsed = parseSilaVoucherCode(codeText);
    if (!parsed.valid) {
      toast(parsed.reason ?? 'الكود غير سليم', 'error');
      return;
    }
    const counterMinor = parseCounterMinor(counterText);
    if (counterMinor == null) {
      toast(
        'أدخل مبلغاً صحيحاً للفرق النقدي: أرقام فقط بفاصلة عشرية واحدة أو اثنتين (مثال 12.50)',
        'error',
      );
      return;
    }
    if (pairing == null) {
      setStep({
        phase: 'error',
        message:
          'الجهاز غير مرتبط بصِلة — اربط حساب التاجر أولاً من تبويب الديون والمزامنة',
        pendingRetry: false,
        permanent: true,
      });
      return;
    }
    setStep({phase: 'calling'});
    try {
      const success = await VoucherService.redeemVoucher({
        payload: parsed.payload,
        mode: 'parcel',
        cart: null,
        print: printerConnected,
        receiptSettings,
        onPrintError: message =>
          toast(`تم الصرف لكن الطباعة فشلت: ${message}`, 'error'),
      });
      // مسارات محجوبة دفاعياً (لا تحدث في الصرف المستقل بدون سلة،
      // لكن قواعد v22/v43 تفرض عدم التسليم إن حدثت).
      if (success.saleBookingFailed) {
        onClose();
        onRedeemed();
        toast(
          success.bookingError ??
            'فشل إنشاء فاتورة البضاعة — راجع سجل الصرف بعد معالجة السبب',
          'error',
          6000,
        );
        return;
      }
      if (success.needsTopUp) {
        onClose();
        onRedeemed();
        toast(
          'القسيمة أكبر من قيمة البضاعة — لا يمكن التسليم قبل إكمالها',
          'error',
          6000,
        );
        return;
      }
      // الفرق النقدي المستلم عند الكاشير يُقيَّد على صف الصرف
      // (counter_extra_minor) ليدخل دفاتر الخزينة من اليوم الأول.
      if (counterMinor > 0) {
        try {
          await VouchersRepo.updateCounterExtra(success.localId, counterMinor);
        } catch {
          // الصرف نجح — تسجيل الفرق فشل فقط، لا يفسد العملية.
        }
      }
      setStep({phase: 'success', data: success, counterMinor});
    } catch (error) {
      if (error instanceof VoucherRedeemError) {
        setStep({
          phase: 'error',
          message: error.message,
          pendingRetry: error.pendingRetry,
          permanent: error.permanent,
        });
      } else {
        setStep({
          phase: 'error',
          message:
            error instanceof Error ? error.message : 'تعذر صرف القسيمة',
          pendingRetry: false,
          permanent: true,
        });
      }
    }
  }, [
    codeText,
    counterText,
    onClose,
    onRedeemed,
    pairing,
    printerConnected,
    receiptSettings,
    step.phase,
    toast,
  ]);

  const reprint = useCallback(async () => {
    if (step.phase !== 'success') {
      return;
    }
    setReprinting(true);
    try {
      await VoucherService.reprintByReceiptRef(
        step.data.receiptRef,
        receiptSettings,
      );
      toast('أُرسل إيصال الصرف للطابعة', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذرت إعادة الطباعة',
        'error',
      );
    } finally {
      setReprinting(false);
    }
  }, [receiptSettings, step, toast]);

  const handleClose = useCallback(() => {
    if (step.phase === 'calling') {
      return;
    }
    onClose();
    if (step.phase === 'success') {
      onRedeemed();
    }
  }, [onClose, onRedeemed, step.phase]);

  if (!open) {
    return null;
  }

  const valueMinor = step.phase === 'success' ? step.data.result.value_minor : 0;
  const counterMinor = step.phase === 'success' ? step.counterMinor : 0;

  return (
    <div
      className="overlay"
      onClick={event => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}>
      <div className="modal sila-redeem">
        <div className="modal-head">
          <b>استبدال قسيمة صِلة (بدون سلة)</b>
          <button className="btn sm ghost" onClick={handleClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body">
          {/* القاعدة الذهبية (§2 قاعدة 5) — ظاهرة دائماً. */}
          <div className="sila-rulebox">
            <span className="sila-rule-icon">ℹ️</span>
            <span>
              القسيمة حقٌّ مؤمَّن من المؤسسة — ليست ديناً على الزبون، ولا تظهر
              في كشف حسابه. هذه النافذة صرفٌ مستقل بدون سلة (حملات الطرود
              والبضاعة غير المتتبعة)؛ القسائم الشرائية تُصرف من سلة البيع فقط
              (زر القسيمة في شاشة نقطة البيع).
            </span>
          </div>

          {/* ── الإدخال ── */}
          {step.phase === 'input' && (
            <>
              <div className="field">
                <label>كود القسيمة / رمز الـ QR</label>
                <input
                  className="sila-code-input"
                  value={codeText}
                  onChange={event =>
                    setCodeText(
                      event.target.value.toUpperCase().replace(/\s+/g, ''),
                    )
                  }
                  placeholder="ABCD2345EFGH6789JKLM"
                  dir="ltr"
                  maxLength={120}
                />
                <span className="sila-cell-sub">
                  يظهر للمستحق في تطبيق صِلة أو على القسيمة الورقية — يمكن مسح
                  رمز الـ QR بقارئ الباركود مباشرة في هذا الحقل، أو لصق حمولة
                  الرمز كاملة (SILAV1|…).
                </span>
              </div>
              <div className="field">
                <label>الفرق المدفوع نقداً عند الكاشير (₪، اختياري)</label>
                <input
                  value={counterText}
                  onChange={event =>
                    setCounterText(event.target.value.replace(/[^\d.,]/g, ''))
                  }
                  placeholder="0.00"
                  dir="ltr"
                />
                <span className="sila-cell-sub">
                  إن سلّمت بضاعة بقيمة أكبر من القسيمة واستلمت الفرق نقداً من
                  المستحق — سجّل الفرق هنا ليُقيَّد في دفاتر الخزينة
                  (counter extra). اتركه فارغاً إن لم يوجد فرق.
                </span>
              </div>
              <div className="sila-alert info">
                الصرف يتطلب اتصالاً حياً بالإنترنت — لا تُسلَّم البضاعة قبل
                ظهور نتيجة العملية.
              </div>
            </>
          )}

          {/* ── جارٍ الصرف ── */}
          {step.phase === 'calling' && (
            <div className="sila-state">
              <span className="sila-spinner" />
              <span className="sila-state-title">جارٍ الصرف عبر صِلة…</span>
              <span className="sila-state-text">
                نداء حي واحد بمفتاح عملية محفوظ — لا تُسلَّم البضاعة قبل ظهور
                النتيجة
              </span>
            </div>
          )}

          {/* ── النجاح ── */}
          {step.phase === 'success' && (
            <div className="sila-state ok">
              <div className="sila-state-icon"><Icon name="check" size={22} /></div>
              <span className="sila-state-title">
                صُرفت القسيمة — {formatMoney(valueMinor / 100)}
              </span>
              <span className="sila-state-text">
                حملة «{step.data.result.campaign_name}» · المرجع الرسمي{' '}
                <span dir="ltr">{step.data.result.reference_code}</span>
              </span>
              {step.data.result.beneficiary_last4 ? (
                <span className="sila-state-meta">
                  هوية المستحق: ****
                  <span dir="ltr">{step.data.result.beneficiary_last4}</span>
                </span>
              ) : null}
              {counterMinor > 0 ? (
                <div className="sila-decomp">
                  <div className="sila-decomp-row">
                    <span>قيمة القسيمة (تُطالب بها المؤسسة)</span>
                    <b>{formatMoney(valueMinor / 100)}</b>
                  </div>
                  <div className="sila-decomp-row warn">
                    <span>الفرق نقداً عند الكاشير</span>
                    <b>{formatMoney(counterMinor / 100)}</b>
                  </div>
                  <div className="sila-decomp-row total">
                    <span>إجمالي البضاعة المسلّمة</span>
                    <b>{formatMoney((valueMinor + counterMinor) / 100)}</b>
                  </div>
                </div>
              ) : null}
              <span className="sila-state-meta">
                الإيصال: <span dir="ltr">{step.data.receiptRef}</span> —
                سُجّلت مطالبتك على المؤسسة في دفتر الحملات
              </span>
              <div className="sila-actions" style={{marginTop: 10}}>
                <button
                  className="btn"
                  disabled={!printerConnected || reprinting}
                  onClick={() => void reprint()}>
                  {reprinting ? 'جارٍ الطباعة…' : 'طباعة الإيصال'}
                </button>
                <button className="btn primary" onClick={handleClose}>
                  {counterMinor > 0
                    ? 'استلمت الفرق نقداً — تسليم البضاعة'
                    : 'تم — تسليم البضاعة'}
                </button>
              </div>
            </div>
          )}

          {/* ── الخطأ / التعليق ── */}
          {step.phase === 'error' && (
            <div
              className={`sila-state ${step.pendingRetry ? 'warn' : 'danger'}`}>
              <div className="sila-state-icon">
                {step.pendingRetry ? '⏳' : '⚠'}
              </div>
              <span className="sila-state-title">
                {step.pendingRetry
                  ? 'الصرف معلّق — بانتظار الاتصال'
                  : 'تعذر صرف القسيمة'}
              </span>
              <span className="sila-state-text">{step.message}</span>
              {step.pendingRetry ? (
                <span className="sila-state-meta">
                  العملية محفوظة بمفتاحها نفسه وستكتمل تلقائياً — سيُشعرك
                  المحرك عند الحسم. لا تُسلَّم البضاعة قبل نجاح الصرف.
                </span>
              ) : null}
              <div className="sila-actions" style={{marginTop: 10}}>
                {!step.pendingRetry && (
                  <button
                    className="btn"
                    onClick={() => setStep({phase: 'input'})}>
                    محاولة بكود آخر
                  </button>
                )}
                <button className="btn primary" onClick={onClose}>
                  إغلاق
                </button>
              </div>
            </div>
          )}
        </div>
        {step.phase === 'input' && (
          <div className="modal-foot">
            <button
              className="btn primary"
              disabled={codeText.trim().length === 0}
              onClick={() => void submit()}>
              صرف القسيمة
            </button>
            <button className="btn" onClick={onClose}>
              إلغاء
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── الشاشة الرئيسة ────────────────────────────────────────────────

export function SilaScreen() {
  const toast = useToastStore(s => s.show);

  // ── مخزن صِلة ──
  const pairing = useSilaStore(s => s.pairing);
  const pairingBusy = useSilaStore(s => s.pairingBusy);
  const pending = useSilaStore(s => s.pending);
  const failed = useSilaStore(s => s.failed);
  const synced = useSilaStore(s => s.synced);
  const syncState = useSilaStore(s => s.syncState);
  const lastSyncAt = useSilaStore(s => s.lastSyncAt);
  const lastSyncMessage = useSilaStore(s => s.lastSyncMessage);
  const setPairing = useSilaStore(s => s.setPairing);
  const clearPairing = useSilaStore(s => s.clearPairing);
  const refreshCounts = useSilaStore(s => s.refreshCounts);
  const refreshActiveCampaigns = useSilaStore(s => s.refreshActiveCampaigns);
  const setPairingBusy = useSilaStore(s => s.setPairingBusy);

  const settings = useSettingsStore(s => s.settings);
  const printerStatus = usePrinterStore(s => s.status);
  const printerConnected = printerStatus === 'connected';

  // ── حالة عامة ──
  const [tab, setTab] = useState<SilaTab>('debts');
  const [pairCode, setPairCode] = useState('');
  const [syncingNow, setSyncingNow] = useState(false);
  const [refreshingBalances, setRefreshingBalances] = useState(false);

  // ── تبويب الديون ──
  const [debtSearch, setDebtSearch] = useState('');
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all');
  const [debts, setDebts] = useState<SilaDebtRow[]>([]);
  const [debtsTotal, setDebtsTotal] = useState(0);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [customers, setCustomers] = useState<SilaCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customersShown, setCustomersShown] = useState(12);
  const [ownByCustomer, setOwnByCustomer] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [ownTotals, setOwnTotals] = useState<{
    ownMinor: number;
    debtorsCount: number;
  }>({ownMinor: 0, debtorsCount: 0});
  const [queueTotals, setQueueTotals] = useState<{
    pendingMinor: number;
    todayMinor: number;
  } | null>(null);

  // ── تبويب القسائم ──
  const [campaigns, setCampaigns] = useState<CampaignDebtRow[]>([]);
  const [campaignTotals, setCampaignTotals] = useState<
    Awaited<ReturnType<typeof VouchersRepo.campaignsTotals>> | null
  >(null);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [syncingVouchers, setSyncingVouchers] = useState(false);
  const [redemptions, setRedemptions] = useState<VoucherRedemptionRow[]>([]);
  const [redemptionsTotal, setRedemptionsTotal] = useState(0);
  const [busyRedemption, setBusyRedemption] = useState<number | null>(null);
  const [settlements, setSettlements] = useState<CampaignSettlementRow[]>([]);
  const [settlementsSyncedAt, setSettlementsSyncedAt] = useState('');
  const [redeemOpen, setRedeemOpen] = useState(false);

  // ── إعدادات الإيصال (نفس لقطة VouchersTab الأندرويد) ──
  const receiptSettings: ReceiptSettings = useMemo(
    () => ({
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      footerMessage: settings.footerMessage,
      storeLogoPath: settings.storeLogoPath,
      paperWidth: settings.paperWidth,
      codepage: settings.codepage,
      showProfit: settings.showProfitOnReceipt,
    }),
    [settings],
  );

  // ── تحميل البيانات ─────────────────────────────────────────────

  /** صفحة طابور الديون (تصفية + بحث) — مثل loadDebtsPage الأندرويد. */
  const loadDebtsPage = useCallback(
    async (filter: DebtFilter, search: string) => {
      setDebtsLoading(true);
      try {
        const stateFilter =
          filter === 'all' ? undefined : (filter as SilaDebtRow['state']);
        const [rows, count] = await Promise.all([
          SilaRepo.recent(PAGE_SIZE, 0, stateFilter, search),
          SilaRepo.debtQueueCount(stateFilter, search),
        ]);
        setDebts(rows);
        setDebtsTotal(count);
      } catch {
        // تثبيت جديد قبل أول هجرة — صمت.
      } finally {
        setDebtsLoading(false);
      }
    },
    [],
  );

  const loadMoreDebts = useCallback(async () => {
    if (debtsLoading || debts.length >= debtsTotal) {
      return;
    }
    setDebtsLoading(true);
    try {
      const stateFilter =
        debtFilter === 'all'
          ? undefined
          : (debtFilter as SilaDebtRow['state']);
      const rows = await SilaRepo.recent(
        PAGE_SIZE,
        debts.length,
        stateFilter,
        debtSearch,
      );
      setDebts(previous => {
        const seen = new Set(previous.map(row => row.local_id));
        return [...previous, ...rows.filter(row => !seen.has(row.local_id))];
      });
    } catch {
      // صمت.
    } finally {
      setDebtsLoading(false);
    }
  }, [debtFilter, debtSearch, debts.length, debtsTotal, debtsLoading]);

  /** بيانات تبويب القسائم كاملة (الحملات + السجل + التسويات). */
  const loadVouchers = useCallback(async () => {
    try {
      const [campaignRows, totals, rows, count, pendingRows, settle] =
        await Promise.all([
          VouchersRepo.campaigns(),
          VouchersRepo.campaignsTotals(),
          VouchersRepo.recent(30, 0),
          VouchersRepo.redemptionsCount(),
          VouchersRepo.pendingRedemptions(),
          VouchersRepo.recentSettlements(12),
        ]);
      setCampaigns(campaignRows);
      setCampaignTotals(totals);
      setSettlements(settle);
      setSettlementsSyncedAt(getString(KEYS.silaSettlementsSyncedAt, ''));
      setRedemptionsTotal(count);
      // سجل الصرف: الأحدث 30 + كل معلّقة لم تدخلهم (تظل قابلة للإكمال).
      const seen = new Set(rows.map(row => row.local_id));
      setRedemptions([
        ...rows,
        ...pendingRows.filter(row => !seen.has(row.local_id)),
      ]);
    } catch {
      // تثبيت جديد قبل أول مزامنة — صمت.
    }
  }, []);

  /** إجماليات الديون والزبائن (دفاتر المتجر المحلية §2.4). */
  const reload = useCallback(async () => {
    try {
      const [customerList, ownMap, ownTotal, queue] = await Promise.all([
        SilaRepo.listCustomers(),
        SilaRepo.storeOwnOutstandingByCustomer(),
        SilaRepo.storeOwnOutstandingTotal(),
        SilaRepo.totals(),
      ]);
      const sorted = [...customerList].sort((a, b) => {
        const ownA = ownMap.get(a.customer_id) ?? 0;
        const ownB = ownMap.get(b.customer_id) ?? 0;
        if (ownA !== ownB) {
          return ownB - ownA;
        }
        return a.name.localeCompare(b.name, 'ar');
      });
      setCustomers(sorted);
      setOwnByCustomer(ownMap);
      setOwnTotals(ownTotal);
      setQueueTotals({
        pendingMinor: queue.pendingMinor,
        todayMinor: queue.todayMinor,
      });
    } catch {
      // صمت.
    }
    await refreshCounts();
    await loadDebtsPage(debtFilter, debtSearch);
    await loadVouchers();
  }, [debtFilter, debtSearch, loadDebtsPage, loadVouchers, refreshCounts]);

  // تحميل عند الإقلاع وعند كل تبديل تبويب (يعادل عودة التركيز في
  // الأندرويد) — دورات المزامنة الخلفية تُحدّث العدادات عبر المخزن،
  // وهنا تُسحب الصفوف ذاتها من قاعدة البيانات المحلية.
  useEffect(() => {
    if (pairing != null) {
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // بحث الديون بتريح 350مللي (نفس إيقاع الأندرويد).
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimerRef.current != null) {
        clearTimeout(searchTimerRef.current);
      }
    },
    [],
  );

  const onDebtSearchChange = (text: string) => {
    setDebtSearch(text);
    if (searchTimerRef.current != null) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      void loadDebtsPage(debtFilter, text);
    }, 350);
  };

  const onDebtFilterChange = (filter: DebtFilter) => {
    setDebtFilter(filter);
    void loadDebtsPage(filter, debtSearch);
  };

  // ── الربط (§6.1) ────────────────────────────────────────────────

  /** نفس نداء SilaScreen الأندرويد: silaPair ثم setPairing + start. */
  const doPair = useCallback(
    async (rawCode: string) => {
      const code = normalizePairingCode(rawCode);
      if (code.length < 6) {
        toast(
          'أدخل رمز الربط كما يظهر في تطبيق صِلة (مثال: A7K2-Q93M)',
          'error',
        );
        return;
      }
      setPairingBusy(true);
      try {
        const result = await silaPair(code, `sela POS ${APP_VERSION}`);
        setPairing({
          posToken: result.pos_token,
          deviceId: result.device_id,
          merchantOrgId: result.merchant_org_id,
          merchantName: result.merchant_name,
          tokenExpiresAt: result.expires_at,
          pairedAt: new Date().toISOString(),
          apiBaseUrl: SILA_DEFAULT_BASE_URL,
        });
        setPairCode('');
        SilaSync.start();
        void SilaSync.syncNow();
        // قفزة عدادات اليوم فوق كل مرجع يذكره خادم صِلة (§6.1 v16).
        void SilaSync.advanceCountersFromServer();
        toast(
          `تم ربط المتجر بحساب «${result.merchant_name}» في صِلة`,
          'success',
        );
        setTab('debts');
        void reload();
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل ربط المتجر',
          'error',
        );
      } finally {
        setPairingBusy(false);
      }
    },
    [reload, setPairing, setPairingBusy, toast],
  );

  /**
   * فك الربط محكوم بتسديد الديون أولاً (نص طلب التاجر): دين متجرك
   * من الدفاتر المحلية + دين هذه النقطة كما يذكره الخادم — أي رقم
   * فوق الصفر يمنع الفك برسالة تحمل المبلغ وعدد المدينين.
   */
  const confirmUnpair = useCallback(async () => {
    let ownMinor = 0;
    let ownDebtors = 0;
    let deviceMinor = 0;
    try {
      const [own, server] = await Promise.all([
        SilaRepo.storeOwnOutstandingTotal(),
        SilaRepo.customersOutstandingTotal(),
      ]);
      ownMinor = own.ownMinor;
      ownDebtors = own.debtorsCount;
      deviceMinor = server.deviceTotalMinor;
    } catch {
      toast(
        'لا يمكن فك الربط قبل التأكد من عدم وجود ديون على زبائن صِلة المرتبطين بمتجرك — تحقق من الاتصال واضغط فك الربط مرة أخرى',
        'error',
        6000,
      );
      return;
    }
    if (ownMinor > 0 || deviceMinor > 0) {
      const lines: string[] = [];
      if (ownMinor > 0) {
        lines.push(
          `• دين زبائن صِلة من فواتير متجرك: ${formatMoney(
            ownMinor / 100,
          )} على ${ownDebtors} زبون.`,
        );
      }
      if (deviceMinor > 0 && deviceMinor !== ownMinor) {
        lines.push(
          `• ديون هذه النقطة كما يذكرها خادم صِلة: ${formatMoney(
            deviceMinor / 100,
          )}.`,
        );
      }
      toast(
        `لا يمكن فك الربط — عليك تسديد الديون أولاً: ${lines.join(
          ' ',
        )} سدّدها ثم اضغط «زامن الآن» ليستقر الرصيد، وبعدها يمكن فك الربط.`,
        'error',
        8000,
      );
      return;
    }
    if (
      !window.confirm(
        'فك ربط صِلة:\nسيُلغى ربط هذا الجهاز بحساب التاجر. الديون المسجلة محلياً تبقى محفوظة ويمكن مزامنتها بعد إعادة الربط.\nهل أنت متأكد؟',
      )
    ) {
      return;
    }
    SilaSync.stop();
    clearPairing();
    setTab('debts');
    setDebts([]);
    setDebtsTotal(0);
    setCustomers([]);
    setOwnByCustomer(new Map());
    setCampaigns([]);
    setCampaignTotals(null);
    setRedemptions([]);
    setSettlements([]);
    toast('تم فك ربط صِلة من هذا الجهاز', 'info');
  }, [clearPairing, toast]);

  // ── إجراءات المزامنة ───────────────────────────────────────────

  /** «زامن الآن» — دورة فورية بنتيجة منطوقة (round-18 #1). */
  const syncNow = useCallback(async () => {
    if (syncingNow) {
      return;
    }
    setSyncingNow(true);
    try {
      const outcome = await SilaSync.syncNow();
      await reload();
      toast(
        outcome.message,
        outcome.pending + outcome.paymentsPending === 0 &&
          outcome.state !== 'no_internet'
          ? 'success'
          : 'info',
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشلت المزامنة',
        'error',
      );
    } finally {
      setSyncingNow(false);
    }
  }, [reload, syncingNow, toast]);

  /** «تحديث الأرصدة» — سحب خفيف لأرصدة زبائن صِلة فقط. */
  const refreshBalancesNow = useCallback(async () => {
    if (refreshingBalances) {
      return;
    }
    setRefreshingBalances(true);
    try {
      const ok = await SilaSync.refreshBalances();
      await reload();
      toast(
        ok
          ? 'حُدّثت أرصدة زبائن صِلة'
          : 'تعذر تحديث الأرصدة — تحقق من الاتصال وحاول مجدداً',
        ok ? 'success' : 'error',
      );
    } finally {
      setRefreshingBalances(false);
    }
  }, [refreshingBalances, reload, toast]);

  /** «تحديث الحملات» — إكمال المعلّقة + مرآة التسويات فوراً. */
  const refreshVouchersNow = useCallback(async () => {
    if (syncingVouchers) {
      return;
    }
    setSyncingVouchers(true);
    try {
      await SilaSync.refreshVouchers();
      await loadVouchers();
      toast('تم تحديث الحملات والقسائم من صِلة', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر تحديث الحملات',
        'error',
      );
    } finally {
      setSyncingVouchers(false);
    }
  }, [loadVouchers, syncingVouchers, toast]);

  // ── إجراءات طابور الديون ───────────────────────────────────────

  const requeueRow = useCallback(
    async (row: SilaDebtRow) => {
      try {
        await SilaRepo.requeue(row.local_id);
        await reload();
        toast(
          `أُعيدت فاتورة ${row.pos_invoice_ref} إلى طابور المزامنة`,
          'info',
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذرت إعادة المحاولة',
          'error',
        );
      }
    },
    [reload, toast],
  );

  const reprintDebt = useCallback(
    async (row: SilaDebtRow) => {
      try {
        await InvoiceService.reprintDebtReceiptByRef(
          row.pos_invoice_ref,
          receiptSettings,
        );
        toast('أُرسل إيصال الدين إلى الطابعة', 'success');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذرت إعادة الطباعة',
          'error',
        );
      }
    },
    [receiptSettings, toast],
  );

  // ── إجراءات الحملات (دورة واحدة باتجاه واحد) ────────────────────

  /** تفعيل حملة متاحة — نفس مسار VouchersTab الأندرويد حرفياً. */
  const activateCampaign = useCallback(
    async (campaign: CampaignDebtRow) => {
      setToggling(campaign.campaign_id);
      try {
        const changed = await VouchersRepo.activateCampaign(
          campaign.campaign_id,
        );
        if (!changed) {
          toast('هذه الحملة مفعّلة أصلاً — لا يمكن تفعيلها مرتين', 'info');
          await loadVouchers();
          return;
        }
        // تفعيل = التزام: تسوياتها كاملة تصل الدفاتر فوراً.
        await SilaSync.refreshVouchersFull();
        await refreshActiveCampaigns();
        await loadVouchers();
        toast(
          `فُعّلت حملة «${campaign.campaign_name}» في متجرك — تُحتسب مستحقاتها وتسوياتها من الآن`,
          'success',
          5000,
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تفعيل الحملة',
          'error',
        );
      } finally {
        setToggling(null);
      }
    },
    [loadVouchers, refreshActiveCampaigns, toast],
  );

  /** إنهاء حملة مفعّلة (مكتملة) — باتجاه واحد ولا تراجع. */
  const completeCampaignFlow = useCallback(
    async (campaign: CampaignDebtRow) => {
      const ok = window.confirm(
        `إنهاء الحملة (مكتملة):\nستصبح حملة «${campaign.campaign_name}» مكتملة في متجرك:\n• تبقى بياناتها ومستحقاتها القائمة محفوظة كما هي في دفاترك\n• لا يمكن التراجع أو إعادة التفعيل\nهل أنت متأكد؟`,
      );
      if (!ok) {
        return;
      }
      setToggling(campaign.campaign_id);
      try {
        const changed = await VouchersRepo.completeCampaign(
          campaign.campaign_id,
        );
        if (changed) {
          await refreshActiveCampaigns();
          await loadVouchers();
          toast(
            `أُنهيت حملة «${campaign.campaign_name}» — بياناتها ومستحقاتها القائمة تبقى محفوظة كما هي`,
            'info',
            5000,
          );
        }
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر إنهاء الحملة',
          'error',
        );
      } finally {
        setToggling(null);
      }
    },
    [loadVouchers, refreshActiveCampaigns, toast],
  );

  // ── إجراءات سجل الصرف ──────────────────────────────────────────

  /**
   * إكمال/إعادة محاولة عملية معلّقة أو فاشلة — نفس نداء محرك
   * المزامنة: نداء حي بالمفتاح نفسه (§7.3) عبر completePendingRedemption.
   */
  const completePending = useCallback(
    async (row: VoucherRedemptionRow) => {
      if (busyRedemption != null) {
        return;
      }
      setBusyRedemption(row.local_id);
      try {
        const outcome = await VoucherService.completePendingRedemption(row);
        if (outcome === 'ok') {
          await loadVouchers();
          toast(
            `اكتمل صرف القسيمة ${row.reference_code ?? row.pos_receipt_ref ?? ''} — ${row.campaign_name ?? 'حملة صِلة'}`,
            'success',
            5000,
          );
        } else if (outcome === 'failed') {
          await loadVouchers();
          toast(
            'فشل الصرف نهائياً — يظهر السبب في سجل الصرف، ولا تُسلَّم البضاعة',
            'error',
            6000,
          );
        } else {
          await loadVouchers();
          toast(
            'ما زال بلا اتصال — العملية محفوظة بمفتاحها نفسه وستكتمل تلقائياً',
            'info',
            5000,
          );
        }
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر إكمال الصرف',
          'error',
        );
      } finally {
        setBusyRedemption(null);
      }
    },
    [busyRedemption, loadVouchers, toast],
  );

  const reprintRedemption = useCallback(
    async (row: VoucherRedemptionRow) => {
      if (!row.pos_receipt_ref) {
        return;
      }
      try {
        await VoucherService.reprintByReceiptRef(
          row.pos_receipt_ref,
          receiptSettings,
        );
        toast('أُرسل إيصال الصرف للطابعة', 'success');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذرت إعادة الطباعة',
          'error',
        );
      }
    },
    [receiptSettings, toast],
  );

  // ── مشتقات العرض ───────────────────────────────────────────────

  const syncStatus = useMemo(() => {
    if (syncState === 'device_invalid') {
      return {
        cls: 'danger',
        text: lastSyncMessage ?? 'ربط الجهاز منتهٍ — أعد الربط برمز جديد',
      };
    }
    if (syncState === 'no_internet') {
      return {
        cls: 'warn',
        text: lastSyncMessage ?? 'لا يوجد اتصال — الطابور محفوظ',
      };
    }
    if (syncState === 'syncing') {
      return {cls: 'brand', text: lastSyncMessage ?? 'جارٍ المزامنة…'};
    }
    return {cls: 'ok', text: lastSyncMessage ?? 'كل شيء متزامن'};
  }, [lastSyncMessage, syncState]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim();
    if (q.length === 0) {
      return customers;
    }
    return customers.filter(
      customer =>
        customer.name.includes(q) ||
        (customer.phone_last4 ?? '').includes(q) ||
        customer.customer_id.includes(q),
    );
  }, [customers, customerSearch]);

  const matchingCampaigns = useMemo(() => {
    const needle = campaignSearch.trim();
    if (needle.length === 0) {
      return campaigns;
    }
    return campaigns.filter(row => row.campaign_name.includes(needle));
  }, [campaignSearch, campaigns]);

  // ── العرض ──────────────────────────────────────────────────────

  return (
    <div className="screen">
      <h1>صِلة والقسائم</h1>
      <div className="subtitle">
        دفتر ديون صِلة وقسائم الحملات — المزامنة، الصرف، والمستحقات على
        المؤسسات
      </div>

      <div className="sila-body">
        {pairing == null ? (
          /* ── غير مقترن: مصادقة التاجر (§6.1) ── */
          <div className="card sila-pair-card">
            <div className="sila-pair-head">
              <div className="sila-pair-icon">🔗</div>
              <div style={{flex: 1, minWidth: 220}}>
                <b>اربط حساب التاجر في صِلة</b>
                <div className="sila-pair-meta">
                  صِلة منظومة الدين الفلسطينية — بعد الربط يستطيع الكاشير تسجيل
                  فواتير الدين بمسح رمز الزبون من تطبيق صِلة، وتُزامَن تلقائياً
                  عند توفر الإنترنت، وتظهر هنا حملات القسائم ومستحقاتها.
                </div>
              </div>
            </div>
            <div className="sila-steps">
              <div className="sila-step">
                <span className="sila-step-num">١</span>
                <span>افتح تطبيق صِلة بحساب التاجر ← الإعدادات ← «ربط نقطة البيع»</span>
              </div>
              <div className="sila-step">
                <span className="sila-step-num">٢</span>
                <span>اضغط «إنشاء رمز ربط جديد» — الرمز صالح 15 دقيقة لمرة واحدة</span>
              </div>
              <div className="sila-step">
                <span className="sila-step-num">٣</span>
                <span>أدخل الرمز هنا ثم اضغط «ربط المتجر»</span>
              </div>
            </div>
            <div className="field">
              <label>رمز الربط</label>
              <input
                value={pairCode}
                onChange={event =>
                  setPairCode(
                    event.target.value.toUpperCase().replace(/\s+/g, ''),
                  )
                }
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    void doPair(pairCode);
                  }
                }}
                placeholder="A7K2-Q93M"
                dir="ltr"
              />
            </div>
            <div className="sila-actions" style={{marginTop: 12}}>
              <button
                className="btn primary"
                disabled={pairingBusy}
                onClick={() => void doPair(pairCode)}>
                {pairingBusy ? 'جارٍ الربط…' : 'ربط المتجر'}
              </button>
            </div>
          </div>
        ) : (
          /* ── مقترن: بطاقة الحالة + التبويبان ── */
          <>
            <div className="card sila-pair-card">
              <div className="sila-pair-head">
                <div className="sila-pair-icon">🏪</div>
                <div style={{flex: 1, minWidth: 240}}>
                  <b>{pairing.merchantName}</b>
                  <div className="sila-pair-meta">
                    مرتبط منذ {formatDate(pairing.pairedAt.slice(0, 10))} ·
                    رمز نقطة البيع{' '}
                    <code className="sila-token" dir="ltr">
                      {tokenPreview(pairing.posToken)}
                    </code>{' '}
                    · صالح حتى {formatDate(pairing.tokenExpiresAt.slice(0, 10))}
                  </div>
                </div>
                <span
                  className={`chip ${syncState === 'device_invalid' ? 'danger' : 'ok'}`}>
                  {syncState === 'device_invalid' ? 'منتهٍ' : 'مرتبط'}
                </span>
              </div>

              {syncState === 'device_invalid' && (
                <div className="sila-alert danger">
                  ⚠ ربط هذا الجهاز منتهٍ أو ملغى من تطبيق التاجر — الديون
                  محفوظة محلياً ولن تُفقد. أعد الربط برمز جديد لاستئناف
                  المزامنة.
                </div>
              )}

              <div className={`sila-sync-line ${syncStatus.cls}`}>
                <span className="sila-sync-dot" />
                <span>{syncStatus.text}</span>
                {lastSyncAt ? (
                  <span>
                    · آخر مزامنة {relativeTime(friendlyTime(lastSyncAt))}
                  </span>
                ) : null}
              </div>

              <div className="sila-chiprow">
                <span className="chip warn">بالانتظار {pending}</span>
                <span className="chip danger">فشل {failed}</span>
                <span className="chip ok">مُزامن {synced}</span>
              </div>

              <div className="sila-actions">
                <button
                  className="btn primary"
                  disabled={syncingNow}
                  onClick={() => void syncNow()}>
                  {syncingNow ? 'جارٍ المزامنة…' : 'زامن الآن'}
                </button>
                <button
                  className="btn"
                  disabled={refreshingBalances}
                  onClick={() => void refreshBalancesNow()}>
                  {refreshingBalances ? 'جارٍ التحديث…' : 'تحديث الأرصدة'}
                </button>
                <span className="sila-spacer" />
                <button
                  className="btn danger"
                  onClick={() => void confirmUnpair()}>
                  فك الربط
                </button>
              </div>
            </div>

            <div className="sila-tabs">
              <button
                className={`sila-tab ${tab === 'debts' ? 'on' : ''}`}
                onClick={() => setTab('debts')}>
                الديون والمزامنة
              </button>
              <button
                className={`sila-tab ${tab === 'vouchers' ? 'on' : ''}`}
                onClick={() => setTab('vouchers')}>
                قسائم الحملات
              </button>
            </div>

            {tab === 'debts' ? (
              /* ── تبويب الديون والمزامنة ── */
              <>
                <div className="grid-4">
                  <div className="card kpi">
                    <span className="label">دين فواتير متجرك (صِلة)</span>
                    <span className="value brand">
                      {formatMoney(ownTotals.ownMinor / 100)}
                    </span>
                  </div>
                  <div className="card kpi">
                    <span className="label">زبون مدين لك</span>
                    <span className="value">{ownTotals.debtorsCount}</span>
                  </div>
                  <div className="card kpi">
                    <span className="label">بانتظار الرفع لصِلة</span>
                    <span className="value">
                      {formatMoney((queueTotals?.pendingMinor ?? 0) / 100)}
                    </span>
                    <span className="label">
                      فواتير دين لم تصل الخادم بعد
                    </span>
                  </div>
                  <div className="card kpi">
                    <span className="label">ديون اليوم</span>
                    <span className="value ok">
                      {formatMoney((queueTotals?.todayMinor ?? 0) / 100)}
                    </span>
                  </div>
                </div>

                {/* طابور الديون */}
                <div className="card">
                  <div className="sila-list-head">
                    <b>طابور الديون</b>
                    <span className="sila-list-hint">
                      كل فاتورة بِعتها ديناً عبر صِلة وحالة مزامنتها
                    </span>
                    <span className="grow" />
                    <span className="chip muted">{debtsTotal} فاتورة</span>
                  </div>
                  <div className="sila-toolbar">
                    {DEBT_FILTERS.map(item => (
                      <button
                        key={item.value}
                        className={`chip-toggle ${debtFilter === item.value ? 'on' : ''}`}
                        onClick={() => onDebtFilterChange(item.value)}>
                        {item.label}
                      </button>
                    ))}
                    <input
                      className="sila-search"
                      placeholder="ابحث برقم الفاتورة أو اسم الزبون…"
                      value={debtSearch}
                      onChange={event =>
                        onDebtSearchChange(event.target.value)
                      }
                    />
                  </div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>الزبون</th>
                        <th>الفاتورة</th>
                        <th>المبلغ</th>
                        <th>التاريخ</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {debts.map(row => {
                        const chip = DEBT_STATE_CHIP[row.state];
                        return (
                          <tr key={row.local_id}>
                            <td>
                              <b>{row.customer_name ?? 'زبون صِلة'}</b>
                              {row.credit_covered_minor > 0 ? (
                                <span className="sila-cell-sub">
                                  غطّى الرصيد المسبق{' '}
                                  {formatMoney(row.credit_covered_minor / 100)}{' '}
                                  — الفاتورة مسددة بهذا المقدار
                                </span>
                              ) : null}
                            </td>
                            <td dir="ltr">
                              {row.pos_invoice_ref}
                              {row.state === 'synced' && row.reference_code ? (
                                <span className="sila-cell-sub">
                                  مرجع صِلة: {row.reference_code}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <b style={{color: 'var(--brand-ink)'}}>
                                {formatMoney(row.amount_minor / 100)}
                              </b>
                            </td>
                            <td>
                              {formatDateTime(friendlyTime(row.created_at))}
                            </td>
                            <td>
                              <span className={`chip ${chip.cls}`}>
                                {chip.label}
                              </span>
                              {row.state === 'failed' && row.error_message ? (
                                <span className="sila-cell-sub sila-err">
                                  {row.error_message}
                                </span>
                              ) : null}
                            </td>
                            <td className="row-actions">
                              {row.state === 'failed' ? (
                                <>
                                  <button
                                    className="btn sm"
                                    onClick={() => void requeueRow(row)}>
                                    إعادة المحاولة
                                  </button>
                                  {printerConnected ? (
                                    <button
                                      className="btn sm ghost"
                                      onClick={() => void reprintDebt(row)}>
                                      طباعة الإيصال
                                    </button>
                                  ) : null}
                                </>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {debts.length === 0 && !debtsLoading && (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <div className="icon">🧾</div>
                              لا ديون مطابقة — استخدم زر «دين» في شاشة نقطة
                              البيع لتسجيل فاتورة ديناً على زبون صِلة
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {debts.length < debtsTotal ? (
                    <button
                      className="btn sm ghost sila-more"
                      disabled={debtsLoading}
                      onClick={() => void loadMoreDebts()}>
                      {debtsLoading
                        ? 'جارٍ التحميل…'
                        : `عرض المزيد (${debtsTotal - debts.length} متبقية)`}
                    </button>
                  ) : null}
                </div>

                {/* زبائن صِلة وأرصدتهم */}
                <div className="card">
                  <div className="sila-list-head">
                    <b>زبائن صِلة وأرصدتهم</b>
                    <span className="sila-list-hint">
                      ديون فواتير متجرك فقط — ديون تطبيق صِلة غير الخاصة بمتجرك
                      تظهر للمعلومية ولا يُسدّدها الكاشير
                    </span>
                  </div>
                  <div className="sila-toolbar">
                    <input
                      className="sila-search"
                      placeholder="ابحث باسم الزبون أو آخر 4 أرقام من هاتفه…"
                      value={customerSearch}
                      onChange={event => setCustomerSearch(event.target.value)}
                    />
                  </div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>الزبون</th>
                        <th>الهاتف</th>
                        <th>دين متجرك</th>
                        <th>دين تطبيق صِلة</th>
                        <th>الإجمالي الشامل</th>
                        <th>آخر تحديث</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers
                        .slice(0, customersShown)
                        .map(customer => {
                          const own =
                            ownByCustomer.get(customer.customer_id) ?? 0;
                          return (
                            <tr key={customer.customer_id}>
                              <td>
                                <b>{customer.name}</b>
                              </td>
                              <td dir="ltr">
                                {customer.phone_last4
                                  ? `****${customer.phone_last4}`
                                  : '—'}
                              </td>
                              <td>
                                <b
                                  style={{
                                    color: own > 0
                                      ? 'var(--danger)'
                                      : 'var(--ok)',
                                  }}>
                                  {formatMoney(own / 100)}
                                </b>
                                {own > 0 ? (
                                  <span className="sila-cell-sub">
                                    فواتير هذا المتجر فقط
                                  </span>
                                ) : null}
                              </td>
                              <td className="sila-muted">
                                {formatMoney(customer.app_outstanding_minor / 100)}
                              </td>
                              <td className="sila-muted">
                                {formatMoney(customer.outstanding_minor / 100)}
                              </td>
                              <td>
                                {customer.last_synced_at
                                  ? relativeTime(
                                      friendlyTime(customer.last_synced_at),
                                    )
                                  : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      {filteredCustomers.length === 0 && (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <div className="icon">👥</div>
                              ستظهر هنا أرصدة زبائن صِلة لدى متجرك بعد أول
                              مزامنة ناجحة
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {filteredCustomers.length > customersShown ? (
                    <button
                      className="btn sm ghost sila-more"
                      onClick={() =>
                        setCustomersShown(shown => shown + 12)
                      }>
                      عرض المزيد ({filteredCustomers.length - customersShown}{' '}
                      متبقية)
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              /* ── تبويب قسائم الحملات ── */
              <>
                {/* المستحق لك (§7.2) */}
                <div className="card">
                  <div className="sila-due-row">
                    <div className="sila-due-icon">🎟️</div>
                    <div style={{flex: 1, minWidth: 200}}>
                      <span className="sila-due-label">
                        المستحق لك من الحملات
                      </span>
                      <div className="sila-due-value">
                        {formatMoney((campaignTotals?.dueMinor ?? 0) / 100)}
                      </div>
                    </div>
                    <div className="sila-actions">
                      <button
                        className="btn"
                        disabled={syncingVouchers}
                        onClick={() => void refreshVouchersNow()}>
                        {syncingVouchers
                          ? 'جارٍ التحديث…'
                          : 'تحديث الحملات'}
                      </button>
                      <button
                        className="btn primary"
                        onClick={() => setRedeemOpen(true)}>
                        استبدال قسيمة
                      </button>
                    </div>
                  </div>
                  <div className="sila-due-meta">
                    <span>
                      فعّالة: {campaignTotals?.activeCount ?? 0} · مكتملة:{' '}
                      {campaignTotals?.completedCount ?? 0} · مصروف:{' '}
                      {formatMoney((campaignTotals?.redeemedMinor ?? 0) / 100)}{' '}
                      · مستلم:{' '}
                      {formatMoney(
                        (campaignTotals?.settledMinorTotal ?? 0) / 100,
                      )}
                    </span>
                    <span className="sila-due-time">
                      {settlementsSyncedAt
                        ? `آخر مزامنة: ${relativeTime(
                            friendlyTime(settlementsSyncedAt),
                          )}`
                        : 'لم تتم مزامنة الحملات بعد'}
                    </span>
                  </div>
                  {(campaignTotals?.settledPendingMinor ?? 0) > 0 ? (
                    <div className="sila-alert warn">
                      ⏳ تسويات بانتظار تأكيد استلامك:{' '}
                      {formatMoney(
                        (campaignTotals?.settledPendingMinor ?? 0) / 100,
                      )}{' '}
                      — أكّدها من تطبيق صِلة بعد وصول المبلغ
                    </div>
                  ) : null}
                </div>

                {/* الحملات */}
                <div className="card">
                  <div className="sila-list-head">
                    <b>الحملات</b>
                    <span className="sila-list-hint">
                      فعّل حملة متاحة لتُحتسب مستحقاتها وتسوياتها في متجرك —
                      التفعيل لا يتكرر ولا يمكن التراجع عنه
                    </span>
                    <span className="grow" />
                    <span className="chip muted">
                      {matchingCampaigns.length} حملة
                    </span>
                  </div>
                  <div className="sila-toolbar">
                    <input
                      className="sila-search"
                      placeholder="ابحث باسم الحملة…"
                      value={campaignSearch}
                      onChange={event => setCampaignSearch(event.target.value)}
                    />
                  </div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>الحملة</th>
                        <th>النوع</th>
                        <th>الحالة</th>
                        <th>عمليات الصرف</th>
                        <th>مصروف</th>
                        <th>مستلم</th>
                        <th>المستحق لك</th>
                        <th>التسوية</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {matchingCampaigns.map(campaign => {
                        const stateChip = CAMPAIGN_STATE_CHIP[
                          campaign.store_state
                        ];
                        const settle = SETTLEMENT_STATE_LABEL[
                          campaign.settlement_state
                        ];
                        return (
                          <tr key={campaign.campaign_id}>
                            <td>
                              <b>{campaign.campaign_name}</b>
                              {campaign.ends_at ? (
                                <span className="sila-cell-sub">
                                  تنتهي {formatDate(campaign.ends_at.slice(0, 10))}
                                </span>
                              ) : null}
                            </td>
                            <td>{kindLabelOf(campaign)}</td>
                            <td>
                              <span className={`chip ${stateChip.cls}`}>
                                {stateChip.label}
                              </span>
                            </td>
                            <td>{campaign.redeemed_count}</td>
                            <td>
                              {formatMoney(campaign.redeemed_value_minor / 100)}
                            </td>
                            <td style={{color: 'var(--ok)'}}>
                              {formatMoney(campaign.settled_minor / 100)}
                            </td>
                            <td>
                              <b
                                style={{
                                  color:
                                    campaign.due_minor > 0
                                      ? 'var(--warn)'
                                      : 'var(--ink-soft)',
                                }}>
                                {formatMoney(campaign.due_minor / 100)}
                              </b>
                            </td>
                            <td title={settle.title}>{settle.label}</td>
                            <td className="row-actions">
                              {campaign.store_state === 'available' ? (
                                <button
                                  className="btn sm primary"
                                  disabled={toggling === campaign.campaign_id}
                                  onClick={() =>
                                    void activateCampaign(campaign)
                                  }>
                                  {toggling === campaign.campaign_id
                                    ? 'جارٍ…'
                                    : 'تفعيل في متجري'}
                                </button>
                              ) : campaign.store_state === 'active' ? (
                                <button
                                  className="btn sm danger"
                                  disabled={toggling === campaign.campaign_id}
                                  onClick={() =>
                                    void completeCampaignFlow(campaign)
                                  }>
                                  إنهاء (مكتملة)
                                </button>
                              ) : (
                                <span className="sila-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {matchingCampaigns.length === 0 ? (
                        <tr>
                          <td colSpan={9}>
                            <div className="empty">
                              <div className="icon">🎟️</div>
                              لا حملات بعد — تصل من صِلة عند مزامنة الحملات،
                              أو جرّب اسماً آخر
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {/* سجل الصرف */}
                <div className="card">
                  <div className="sila-list-head">
                    <b>سجل الصرف</b>
                    <span className="sila-list-hint">
                      كل عملية صرف بمرجعها الرسمي وحالتها — المعلّقة تُكمل
                      تلقائياً عند عودة الاتصال، ولا تُسلَّم البضاعة قبل نجاحها
                    </span>
                    <span className="grow" />
                    <span className="chip muted">
                      {redemptionsTotal} عملية
                    </span>
                  </div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>الحالة</th>
                        <th>القيمة والحملة</th>
                        <th>الإيصال والمرجع</th>
                        <th>الفرق النقدي</th>
                        <th>الوقت</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {redemptions.map(row => {
                        const chip = REDEMPTION_STATE_CHIP[row.state];
                        /** صف مكتمل على الخادم بلا فاتورة بضاعة بعد —
                         *  السلة كانت أقل من قيمة القسيمة (v22). */
                        const awaitingGoods =
                          row.state === 'ok' &&
                          row.cart_json != null &&
                          row.sale_id == null;
                        return (
                          <tr key={row.local_id}>
                            <td>
                              <span className={`chip ${chip.cls}`}>
                                {chip.label}
                              </span>
                            </td>
                            <td>
                              {row.state === 'ok' ? (
                                <b>
                                  {formatMoney(row.value_minor / 100)} —{' '}
                                  {row.campaign_name ?? 'حملة'}
                                </b>
                              ) : row.state === 'pending' ? (
                                <b>بانتظار الاتصال…</b>
                              ) : (
                                <b className="sila-err">
                                  {row.error_message ?? 'فشل الصرف'}
                                </b>
                              )}
                              {awaitingGoods ? (
                                <span className="sila-cell-sub sila-err">
                                  بانتظار إكمال السلة — كانت أقل من قيمة
                                  القسيمة؛ أكملها من شاشة البيع وسجّل البضاعة
                                </span>
                              ) : null}
                            </td>
                            <td dir="ltr">
                              {row.pos_receipt_ref ?? '—'}
                              {row.reference_code ? (
                                <span className="sila-cell-sub">
                                  {row.reference_code}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              {row.counter_extra_minor > 0
                                ? formatMoney(row.counter_extra_minor / 100)
                                : '—'}
                            </td>
                            <td>{relativeTime(friendlyTime(row.created_at))}</td>
                            <td className="row-actions">
                              {row.state === 'pending' || row.state === 'failed' ? (
                                <button
                                  className="btn sm"
                                  disabled={busyRedemption === row.local_id}
                                  onClick={() => void completePending(row)}>
                                  {busyRedemption === row.local_id
                                    ? 'جارٍ…'
                                    : row.state === 'pending'
                                      ? 'إكمال الآن'
                                      : 'إعادة المحاولة'}
                                </button>
                              ) : null}
                              {row.state === 'ok' &&
                              printerConnected &&
                              row.pos_receipt_ref != null ? (
                                <button
                                  className="btn sm ghost"
                                  onClick={() => void reprintRedemption(row)}>
                                  إعادة الطباعة
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {redemptions.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <div className="icon">🎟️</div>
                              لا عمليات صرف بعد — كل قسيمة تصرفها تُسجَّل هنا
                              مع مرجعها الرسمي وحالتها
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {/* تسويات المؤسسات */}
                <div className="card">
                  <div className="sila-list-head">
                    <b>تسويات المؤسسات</b>
                    <span className="sila-list-hint">
                      تصل من صِلة — «مؤكدة» يعني أن المبلغ وصلك فعلاً
                    </span>
                  </div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>الحملة</th>
                        <th>المبلغ</th>
                        <th>النوع</th>
                        <th>الحالة</th>
                        <th>الطريقة والمرجع</th>
                        <th>التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map(entry => {
                        const chip = SETTLEMENT_STATUS_CHIP[entry.status];
                        return (
                          <tr key={entry.settlement_id}>
                            <td>
                              <b>{entry.campaign_name ?? 'حملة'}</b>
                            </td>
                            <td>
                              <b style={{color: 'var(--ok)'}}>
                                {formatMoney(entry.amount_minor / 100)}
                              </b>
                            </td>
                            <td>
                              {SETTLEMENT_KIND_LABEL[entry.kind] ?? entry.kind}
                            </td>
                            <td>
                              <span className={`chip ${chip.cls}`}>
                                {chip.label}
                              </span>
                            </td>
                            <td dir="ltr" className="sila-muted">
                              {[entry.method, entry.reference]
                                .filter(part => part != null && part !== '')
                                .join(' · ') || '—'}
                            </td>
                            <td>{formatDateTime(friendlyTime(entry.created_at))}</td>
                          </tr>
                        );
                      })}
                      {settlements.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty">
                              <div className="icon">💰</div>
                              لا تسويات بعد — ستظهر هنا عند وصولها من المؤسسات
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* نافذة استبدال قسيمة (مكوّن داخلي). */}
      <VoucherRedeemModal
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onRedeemed={() => void loadVouchers()}
        receiptSettings={receiptSettings}
        printerConnected={printerConnected}
      />
    </div>
  );
}
