export const STORAGE_KEY = 'order-note:v1';
export const MAX_QUANTITY = 999;

export function prepareBulkProducts(text, supplier, products) {
  supplier = supplier.trim();
  if (!supplier || supplier.length > 80) throw new Error('業者名は1〜80文字で入力してください．');
  const lines = text.split(/\r\n|\n|\r/).map(name => name.trim()).filter(Boolean);
  if (!lines.length) throw new Error('商品名を1行に1つずつ入力してください．');
  if (lines.length > 100) throw new Error('一度に追加できるのは100行までです．');
  if (lines.some(name => name.length > 80)) throw new Error('商品名は1行につき80文字以内で入力してください．');
  const known = new Set(products.filter(p => p.supplier === supplier).map(p => p.name));
  const names = [];
  let skipped = 0;
  for (const name of lines) {
    if (known.has(name)) { skipped++; continue; }
    known.add(name);
    names.push(name);
  }
  if (!names.length) throw new Error('入力した商品はすべてこの業者に登録済みです．');
  return { supplier, names, skipped };
}

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
  if (state.supplierOrder !== undefined && (!Array.isArray(state.supplierOrder)
    || state.supplierOrder.some(name => typeof name !== 'string' || !name.trim() || name.length > 80)
    || new Set(state.supplierOrder).size !== state.supplierOrder.length)) return false;
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

export function supplierOrder(products, preferred = []) {
  const present = new Set(products.map(p => p.supplier));
  return [...new Set([...preferred, ...present])].filter(name => present.has(name));
}

export function moveSupplier(products, preferred, supplier, delta) {
  const order = supplierOrder(products, preferred);
  const from = order.indexOf(supplier);
  const to = from + delta;
  if (from >= 0 && to >= 0 && to < order.length) [order[from], order[to]] = [order[to], order[from]];
  return order;
}

export function searchProducts(products, query) {
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase('ja');
  const term = normalize(query.trim());
  return products.filter(p => normalize(p.name).includes(term));
}

export function groups(products, selectedOnly = false, preferred = []) {
  const result = new Map();
  for (const product of products) {
    if (selectedOnly && product.quantity === 0) continue;
    if (!result.has(product.supplier)) result.set(product.supplier, []);
    result.get(product.supplier).push(product);
  }
  return supplierOrder(products, preferred).filter(supplier => result.has(supplier))
    .map(supplier => ({ supplier, items: result.get(supplier) }));
}

export function totals(products) {
  const selected = products.filter(p => p.quantity > 0);
  return { count: selected.length, quantity: selected.reduce((total, p) => total + p.quantity, 0), suppliers: new Set(selected.map(p => p.supplier)).size };
}

export function orderText(products, preferred = []) {
  return ['発注内容', ...groups(products, true, preferred).map(({ supplier, items }) =>
    `\n【${supplier}】\n${items.map(p => `${p.name} × ${p.quantity}${p.note ? `\n  備考：${p.note}` : ''}`).join('\n')}`
  )].join('\n');
}

export function exportCsv(products, preferred = []) {
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  const rows = [['業者名', '商品名', '備考'], ...groups(products, false, preferred)
    .flatMap(g => g.items.map(p => [p.supplier, p.name, p.note]))];
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') {
        rows.push(row); row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (char === '"' || closed) throw new Error('CSVの引用符の形式が正しくありません．');
      field += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じられていません．');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

export function prepareCsvImport(text, products) {
  const rows = parseCsv(text).filter(row => row.some(cell => cell.trim()));
  const headers = rows.shift()?.map(cell => cell.trim());
  if (!headers || headers.length !== 3 || new Set(headers).size !== 3
    || !['業者名', '商品名', '備考'].every(name => headers.includes(name))) {
    throw new Error('CSVの先頭行は「業者名,商品名,備考」にしてください．');
  }
  if (!rows.length) throw new Error('CSVに商品がありません．');
  if (rows.length > 10000) throw new Error('CSVは10,000商品以内にしてください．');
  const known = new Set(products.map(p => JSON.stringify([p.supplier, p.name])));
  const additions = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const supplier = row[headers.indexOf('業者名')]?.trim();
    const name = row[headers.indexOf('商品名')]?.trim();
    const note = row[headers.indexOf('備考')];
    if (row.length !== 3 || !supplier || !name || supplier.length > 80 || name.length > 80 || note.length > 500) {
      throw new Error(`CSVの${index + 2}行目を確認してください．業者名・商品名は1〜80文字，備考は500文字以内です．`);
    }
    const key = JSON.stringify([supplier, name]);
    if (known.has(key)) { skipped++; return; }
    known.add(key);
    additions.push({ supplier, name, note, quantity: 0 });
  });
  return { additions, skipped };
}

export function reorderSupplierProducts(products, supplier, ids) {
  const items = products.filter(p => p.supplier === supplier);
  const known = new Map(items.map(p => [p.id, p]));
  if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) {
    throw new Error('商品の並び順が正しくありません');
  }
  let index = 0;
  return products.map(p => p.supplier === supplier ? known.get(ids[index++]) : p);
}
