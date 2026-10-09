export const STORAGE_KEY = 'order-note:v1';
export const MAX_QUANTITY = 999;

export function sampleState() {
  return { version: 1, products: [
    { id: 'sample-1', name: '鶏もも肉', supplier: '肉屋', note: '1kgパック', quantity: 0, sample: true },
    { id: 'sample-2', name: '豚バラ肉', supplier: '肉屋', note: '薄切り・1kgパック', quantity: 0, sample: true },
    { id: 'sample-3', name: 'トマト', supplier: '八百屋', note: '1箱', quantity: 0, sample: true },
    { id: 'sample-4', name: 'レタス', supplier: '八百屋', note: '', quantity: 0, sample: true },
    { id: 'sample-5', name: '牛乳', supplier: '食品卸', note: '1L・12本入り', quantity: 0, sample: true },
    { id: 'sample-6', name: 'コーヒー豆', supplier: '食品卸', note: 'いつものブレンド・1kg', quantity: 0, sample: true },
  ] };
}

export function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.products)) return false;
  const ids = new Set();
  return state.products.every(p => {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id)) return false;
    ids.add(p.id);
    return typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 80
      && typeof p.supplier === 'string' && p.supplier.trim().length > 0 && p.supplier.length <= 80
      && typeof p.note === 'string' && p.note.length <= 500
      && Number.isInteger(p.quantity) && p.quantity >= 0 && p.quantity <= MAX_QUANTITY
      && (p.sample === undefined || typeof p.sample === 'boolean');
  });
}

export function changeQuantity(quantity, delta) {
  return Math.max(0, Math.min(MAX_QUANTITY, quantity + delta));
}

export function groups(products, selectedOnly = false) {
  const result = new Map();
  for (const product of products) {
    if (selectedOnly && product.quantity === 0) continue;
    if (!result.has(product.supplier)) result.set(product.supplier, []);
    result.get(product.supplier).push(product);
  }
  return [...result].map(([supplier, items]) => ({ supplier, items }));
}

export function totals(products) {
  const selected = products.filter(p => p.quantity > 0);
  return { count: selected.length, quantity: selected.reduce((total, p) => total + p.quantity, 0), suppliers: new Set(selected.map(p => p.supplier)).size };
}

export function orderText(products) {
  return ['発注内容', ...groups(products, true).map(({ supplier, items }) =>
    `\n【${supplier}】\n${items.map(p => `${p.name} × ${p.quantity}${p.note ? `\n  備考：${p.note}` : ''}`).join('\n')}`
  )].join('\n');
}
