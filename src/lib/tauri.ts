/**
 * tauri.ts — جسر الأوامر والأحداث (الطبقة الوحيدة التي تعرف Tauri).
 * كل نداء يعيد الأخطاء نصاً عربياً جاهزاً للعرض.
 *
 * وضع التطوير بلا نافذة Tauri (npm run dev في المتصفح): محاكٍ
 * بالذاكرة يُعاين الواجهة — يُحذف كلياً من بناء الإنتاج.
 */
import {invoke as tauriInvoke, convertFileSrc} from '@tauri-apps/api/core';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';

const isTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window;

/**
 * تبديل ملء الشاشة الحقيقي (F11) — داخل نافذة Tauri فقط؛
 * في معاينة المتصفح يُستخدم ملء شاشة المتصفح نفسه.
 */
export async function toggleFullscreen(): Promise<void> {
  if (!isTauri) {
    try {
      if (document.fullscreenElement != null) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // المتصفح رفض — تجاهل.
    }
    return;
  }
  const {getCurrentWindow} = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (await win.isFullscreen()) {
    await win.setFullscreen(false);
  } else {
    await win.setFullscreen(true);
  }
}

let mockReady: Promise<typeof import('./devMock')> | null = null;
if (!isTauri && import.meta.env.DEV) {
  // ديناميكي عمداً — Rollup يحذفه مع الفرع كاملاً عند import.meta.env.DEV=false
  mockReady = import('./devMock');
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri && import.meta.env.DEV && mockReady != null) {
    const mock = await mockReady;
    return mock.mockInvoke(cmd, args ?? {}) as T;
  }
  return tauriInvoke<T>(cmd, args);
}

export async function onBarcode(
  handler: (code: string) => void,
): Promise<UnlistenFn> {
  return listen<string>('scanner://barcode', event => {
    handler(event.payload);
  });
}

/**
 * رابط عرض ملف محلي عبر بروتوكول asset — آمن في معاينة المتصفح:
 * convertFileSrc الرسمية تقرأ window.__TAURI_INTERNALS__ مباشرة
 * فتنهار بلا نافذة Tauri؛ هنا نسقط للمسار الخام بدل الانهيار.
 */
export function assetSrc(path: string): string {
  if (isTauri) {
    return convertFileSrc(path);
  }
  return path;
}

// ── أوامر جاهزة باسم واضح ──
export const api = {
  bootstrap: () =>
    invoke<{
      dataDir: string;
      deviceId: string;
      coreVersion: string;
      printer: {channel?: string} | null;
    }>('bootstrap'),
  configGetAll: () => invoke<Record<string, unknown>>('config_get_all'),
  configSet: (key: string, value: unknown) =>
    invoke<void>('config_set', {key, value}),
  configRemove: (key: string) => invoke<void>('config_remove', {key: key}),

  listProducts: (search?: string, categoryId?: number | 'all') =>
    invoke<import('../core/types').Product[]>('list_products', {
      search: search ?? null,
      categoryId: categoryId === 'all' ? 'all' : categoryId ?? null,
    }),
  saveProduct: (args: unknown) => invoke<number>('save_product', {args}),
  deleteProduct: (id: number) => invoke<void>('delete_product', {id}),
  findBarcode: (code: string) =>
    invoke<{kind: 'product' | 'unit' | 'none'; product?: unknown; unit?: unknown; code?: string}>(
      'find_barcode',
      {code},
    ),

  listCategories: () => invoke<import('../core/types').Category[]>('list_categories'),
  upsertCategory: (id: number | null, name: string) =>
    invoke<number>('upsert_category', {id: id ?? null, name}),
  deleteCategory: (id: number) => invoke<void>('delete_category', {id}),

  listUnits: () => invoke<import('../core/types').Unit[]>('list_units'),
  upsertUnit: (unit: unknown) => invoke<number>('upsert_unit', {unit}),
  deleteUnit: (id: number) => invoke<void>('delete_unit', {id}),

  startStocktake: () => invoke<import('../core/types').Stocktake>('start_stocktake'),
  listStocktakes: (limit?: number) =>
    invoke<import('../core/types').Stocktake[]>('list_stocktakes', {limit: limit ?? null}),
  listStocktakeItems: (
    stocktakeId: number,
    search?: string,
    categoryId?: number | 'all',
    onlyPending?: boolean,
  ) =>
    invoke<import('../core/types').StocktakeItem[]>('list_stocktake_items', {
      stocktakeId,
      search: search ?? null,
      categoryId: categoryId === 'all' ? 'all' : categoryId ?? null,
      onlyPending: onlyPending ?? null,
    }),
  setCounted: (stocktakeId: number, productId: number, counted: number | null) =>
    invoke<void>('set_counted', {stocktakeId, productId, counted}),
  completeStocktake: (stocktakeId: number, applyAdjustments: boolean) =>
    invoke<number>('complete_stocktake', {stocktakeId, applyAdjustments}),
  cancelStocktake: (stocktakeId: number) =>
    invoke<void>('cancel_stocktake', {stocktakeId}),
  stocktakeSummary: (stocktakeId: number) => invoke<unknown>('stocktake_summary', {stocktakeId}),

  checkout: (invoiceNumber: string, lines: unknown[], discount: number, paymentType: string) =>
    invoke<import('../core/types').SaleWithItems>('checkout', {
      invoiceNumber,
      lines,
      discount,
      paymentType,
    }),
  listRecentSales: (limit?: number) =>
    invoke<import('../core/types').SaleRecord[]>('list_recent_sales', {limit: limit ?? null}),
  listSalesRange: (from: string, to: string, limit?: number) =>
    invoke<import('../core/types').SaleRecord[]>('list_sales_range', {
      from,
      to,
      limit: limit ?? null,
    }),
  getSale: (id: number) => invoke<import('../core/types').SaleWithItems>('get_sale', {id}),

  reportsSummary: (from: string, to: string) =>
    invoke<import('../core/types').ReportSummary>('reports_summary', {from, to}),
  reportsTop: (from: string, to: string, limit?: number) =>
    invoke<import('../core/types').TopProduct[]>('reports_top', {from, to, limit: limit ?? null}),
  reportsDaily: (from: string, to: string) =>
    invoke<import('../core/types').DailyPoint[]>('reports_daily', {from, to}),
  reportsHourly: (from: string, to: string) =>
    invoke<import('../core/types').HourlyPoint[]>('reports_hourly', {from, to}),

  nextInvoice: () =>
    invoke<{invoiceNumber: string; counter: number; day: string}>('next_invoice'),

  buildBackup: () => invoke<{json: string; summary: unknown}>('build_backup'),
  exportBackup: () =>
    invoke<{path: string; summary: unknown}>('export_backup'),
  importBackup: () =>
    invoke<{path: string; summary: unknown}>('import_backup'),

  printJob: (ops: unknown[]) =>
    invoke<{written: number; channel: string}>('print_job', {ops}),
  testPrinter: () => invoke<{written: number; channel: string}>('test_printer'),
  openDrawer: () => invoke<{written: number}>('open_drawer'),
  listSerialPorts: () => invoke<string[]>('list_serial_ports'),
  listSpoolPrinters: () => invoke<string[]>('list_spool_printers'),
  savePrinterChannel: (channel: unknown) =>
    invoke<void>('save_printer_channel', {channel}),
  currentPrinterChannel: () => invoke<unknown>('current_printer_channel'),
  pickStoreLogo: () => invoke<string | null>('pick_store_logo'),
  /** اختيار صورة منتج: ضغط 512px + حفظ داخل بيانات التطبيق. */
  pickProductImage: () => invoke<string | null>('pick_product_image'),
  /** تعطيل/تفعيل اعتراض الباركود (لوحات المبالغ + شاشة القفل). */
  scannerSetEnabled: (enabled: boolean) =>
    invoke<void>('scanner_set_enabled', {enabled}),

  deviceId: () => invoke<string>('device_id'),
  uptimeMs: () => invoke<number>('uptime_ms'),
  scannerRunning: () => invoke<boolean>('scanner_running'),
  wipeData: () => invoke<void>('wipe_data'),
};
