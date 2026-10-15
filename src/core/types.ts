/**
 * types.ts — منقول من core/types.ts الأندرويد (الحقول المشتركة مع سطح
 * المكتب؛ البصري/الكاميرا خارج النسخة المكتبية بموجب المهمة §2.أ
 * لكن بصمات المنتجات تبقى في النسخ الاحتياطي لجوامع البيانات).
 */

export type PricingMode = 'RETAIL' | 'WHOLESALE';

export interface Category {
  id: number;
  name: string;
  productCount?: number;
}

export interface Unit {
  id: number;
  name: string;
  short_name: string;
  sort_order: number;
}

export interface ProductUnit {
  id: number;
  product_id: number;
  unit_id: number;
  unitName: string;
  unitShort: string;
  /** Base-unit pieces per 1 of this unit (e.g. 1 كرتونة = 24 قطعة). */
  conversion: number;
  barcode: string | null;
  retail_price: number | null;
  wholesale_price: number | null;
}

export interface Product {
  id: number;
  name: string;
  cost_price: number;
  retail_price: number;
  wholesale_price: number;
  stock_quantity: number;
  category_id: number | null;
  image_uri: string | null;
  created_at: string;
  low_stock_threshold: number | null;
  barcode: string | null;
  units?: ProductUnit[];
}

export type StockState = 'out' | 'low' | 'ok';

export interface CartLine {
  key: string;
  productId: number;
  name: string;
  unitPrice: number;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  quantity: number;
  availableStock: number;
  unitId: number | null;
  unitName: string;
  conversion: number;
}

export interface SaleRecord {
  id: number;
  invoice_number: string;
  total_amount: number;
  total_cost: number;
  total_profit: number;
  discount: number;
  payment_type: PricingMode;
  created_at: string;
}

export interface SaleItemRecord {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  cost_price: number;
  total_line_price: number;
  unit_name: string | null;
  base_quantity: number | null;
}

export interface SaleWithItems {
  sale: SaleRecord;
  items: SaleItemRecord[];
}

export interface Stocktake {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: 'open' | 'completed';
  note: string | null;
}

export interface StocktakeItem {
  id: number;
  stocktake_id: number;
  product_id: number;
  product_name: string;
  category_id: number | null;
  system_qty: number;
  counted_qty: number | null;
  unit_hint?: string | null;
}

export type ReportRangeKey = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportSummary {
  revenue: number;
  cogs: number;
  netProfit: number;
  invoicesCount: number;
  itemsCount: number;
  discountTotal: number;
  avgInvoice: number;
}

export interface TopProduct {
  productId: number;
  name: string;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface DailyPoint {
  day: string;
  revenue: number;
  profit: number;
}

export interface HourlyPoint {
  hour: number;
  revenue: number;
  orders: number;
}

export type NotificationKind =
  | 'out_of_stock'
  | 'low_stock'
  | 'info'
  | 'printer'
  | 'sale'
  | 'stocktake';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  productId?: number;
}

/** Derives the stock state (same rule as the Android app). */
export function stockStateOf(
  product: Pick<Product, 'stock_quantity' | 'low_stock_threshold'>,
  defaultThreshold: number,
): StockState {
  if (product.stock_quantity <= 0) return 'out';
  const threshold = product.low_stock_threshold ?? defaultThreshold;
  return product.stock_quantity <= threshold ? 'low' : 'ok';
}
