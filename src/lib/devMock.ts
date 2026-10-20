/**
 * lib/devMock.ts — محاكي أوامر Tauri للتصفح البصري في وضع التطوير
 * فقط (npm run dev بلا نافذة Tauri): بيانات متجر نموذجية بالذاكرة
 * كي تُعاين الواجهة والثيمات وتُلتقط لقطات — لا يُشحن في بناء
 * الإنتاج أبداً (import.meta.env.DEV = false يحذف الفرع كلياً).
 */
import type {Product, Category} from '../core/types';

interface MockState {
  config: Map<string, unknown>;
  products: Product[];
  categories: Category[];
}

const IMG = (hue: number, label: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="hsl(${hue},65%,80%)"/><text x="50%" y="54%" font-size="64" text-anchor="middle" fill="hsl(${hue},55%,35%)" font-family="sans-serif">${label}</text></svg>`,
  )}`;

function seed(): MockState {
  const categories: Category[] = [
    {id: 1, name: 'مشروبات', store_mode: 'grocery'},
    {id: 2, name: 'شوكولاتة وحلويات', store_mode: 'grocery'},
    {id: 3, name: 'معلبات وبقالة', store_mode: 'grocery'},
  ];
  const names = [
    'كوكا كولا 330مل',
    'ماء معدني 1.5ل',
    'شوكولاتة جالاكسي',
    'علكة اكسترا',
    'تونة معلبة',
    'جبنة نابلسية',
    'خبز عربي',
    'شيبس ملح',
    'عصير برتقال',
    'حلاوة طحينية',
    'لبن رايب',
    'بيض مسلوق',
    'بسكويت شاي',
    'قهوة سريعة الذوبان',
    'شاي أخضر',
    'معجون طماطم',
  ];
  const products: Product[] = names.map((name, i) => ({
    id: i + 1,
    name,
    cost_price: 1.5 + (i % 5) * 0.4,
    retail_price: 3 + (i % 7) * 0.75,
    wholesale_price: 2.4 + (i % 6) * 0.6,
    stock_quantity: (i * 7) % 24,
    category_id: categories[i % categories.length].id,
    image_uri: i % 3 === 2 ? null : IMG((i * 47) % 360, name.charAt(0)),
    created_at: '2026-10-01',
    discount_pct: i % 5 === 0 ? 15 : 0,
    online_listed: 0,
    low_stock_threshold: null,
    barcode: `62901${String(100000 + i)}`,
    sold_by_weight: i === 15 ? 1 : 0,
    is_archived: 0,
    expiry_date: null,
    style_group: null,
    variant_size: null,
    variant_color: null,
    has_variants: 0,
    base_unit_name: null,
    stock_untracked: i === 11 ? 1 : 0,
    sizes_count: null,
  }));
  return {config: new Map(), products, categories};
}

const state = seed();

// بذرة قفل لتجربة البوابة في المعاينة: وجود التجزئة يجعل AppLockGate
// تقفل من أول إطار (رمز التحقق غير صالح في المعاينة — المهم سلوك البوابة).
// تُفعَّل بإضافة ?lock إلى الرابط.
if (typeof window !== 'undefined' && window.location.search.includes('lock')) {
  state.config.set('applock_pin_hash_v1', 'dev-preview-pin-hash');
  state.config.set('applock_pin_salt_v1', 'dev-preview-salt');
}

function sqlMock(sql: string): {rows: Record<string, unknown>[]; insertId: null; rowsAffected: number} {
  const clean = sql.trim().toLowerCase();
  if (clean.startsWith('select id, name, store_mode from categories')) {
    return {
      rows: state.categories as unknown as Record<string, unknown>[],
      insertId: null,
      rowsAffected: 0,
    };
  }
  if (clean.startsWith('select') && clean.includes('from products')) {
    return {
      rows: state.products as unknown as Record<string, unknown>[],
      insertId: null,
      rowsAffected: 0,
    };
  }
  return {rows: [], insertId: null, rowsAffected: 0};
}

export function mockInvoke(cmd: string, args: Record<string, unknown> = {}): unknown {
  switch (cmd) {
    case 'config_get_all':
      return Object.fromEntries(state.config);
    case 'config_set':
      state.config.set(String(args.key), args.value);
      return null;
    case 'config_remove':
      state.config.delete(String(args.key));
      return null;
    case 'sql_run':
    case 'tx_execute':
      return sqlMock(String(args.sql ?? ''));
    case 'tx_begin':
      return 1;
    case 'tx_commit':
    case 'tx_rollback':
      return null;
    case 'bootstrap':
      return {
        dataDir: 'C:/Users/dev/AppData/Roaming/sela-pos',
        deviceId: 'dev-mock-device',
        coreVersion: '58.0.0',
        printer: null,
      };
    case 'device_id':
      return 'dev-mock-device';
    case 'uptime_ms':
      return 3600_000;
    case 'scanner_running':
      return false;
    case 'list_serial_ports':
      return ['COM3', 'COM4'];
    case 'list_spool_printers':
      return ['Microsoft Print to PDF'];
    case 'fs_file_exists':
      return false;
    case 'fs_file_signature':
      return '0:0';
    case 'current_printer_channel':
      return {channel: 'none'};
    case 'scanner_set_enabled':
      return null;
    case 'pick_product_image':
      // معاينة التطوير: صورة بديلة (سلسلة بيانات برتقالية صغيرة).
      return 'dev-mock://product-image.jpg';
    case 'image_compress':
      return {base64: '', hash: '', ext: 'jpg', width: 1, height: 1};
    // ── v69 (الجولة 73): معاينة شاشة الكاشير في المتصفح — القيم
    // الهادئة فقط؛ لا سجل ولا netsh خارج ويندوز الحقيقي. ──
    case 'autostart_supported':
      return false;
    case 'autostart_status':
      return false;
    case 'autostart_enable':
    case 'autostart_disable':
      return true;
    case 'lan_firewall_status':
      return {tcp: true, udp: true, app: true};
    case 'lan_firewall_fix':
      return true;
    case 'lan_all_ips':
      return [{ip: '192.168.1.20', kind: 'lan'}];
    default:
      throw new Error(`أمر غير متاح في محاكي التطوير: ${cmd}`);
  }
}
