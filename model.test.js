import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleState, validateState, changeQuantity, groups, totals, orderText, prepareBulkProducts, supplierOrder, moveSupplier, searchProducts, exportCsv, parseCsv, prepareCsvImport, reorderSupplierProducts, editProduct, deleteProducts } from './model.js';

test('quantity stays between zero and 999', () => {
  assert.equal(changeQuantity(0, -1), 0);
  assert.equal(changeQuantity(999, 1), 999);
  assert.equal(changeQuantity(2, -1), 1);
});

test('review includes selected products grouped by supplier with correct totals', () => {
  const state = sampleState();
  state.products[0].quantity = 2;
  state.products[1].quantity = 1;
  state.products[2].quantity = 3;
  assert.deepEqual(totals(state.products), { count: 3, quantity: 6, suppliers: 2 });
  const selected = groups(state.products, true);
  assert.deepEqual(selected.map(g => [g.supplier, g.items.length]), [['肉屋', 2], ['八百屋', 1]]);
  const text = orderText(state.products);
  assert.match(text, /鶏もも肉 × 2\n  備考：1kgパック/);
  assert.match(text, /【八百屋】/);
  assert.doesNotMatch(text, /レタス|食品卸|コーヒー豆/);
});

test('saved state rejects damaged data and accepts an empty product list', () => {
  assert.equal(validateState(sampleState()), true);
  assert.equal(validateState({ version: 1, products: [] }), true);
  assert.equal(validateState(null), false);
  for (const quantity of [-1, 1000, 1.5, '2', null]) {
    const state = sampleState();
    state.products[0].quantity = quantity;
    assert.equal(validateState(state), false);
  }
  const duplicate = sampleState();
  duplicate.products[1].id = duplicate.products[0].id;
  assert.equal(validateState(duplicate), false);
  const invalidNote = sampleState();
  invalidNote.products[0].note = null;
  assert.equal(validateState(invalidNote), false);
});

test('unusual supplier names remain valid grouping keys', () => {
  const state = sampleState();
  state.products[0].supplier = '__proto__';
  state.products[0].quantity = 1;
  assert.equal(groups(state.products, true)[0].supplier, '__proto__');
  assert.deepEqual(totals([]), { count: 0, quantity: 0, suppliers: 0 });
});

test('bulk registration trims lines and ignores blanks and same-supplier duplicates', () => {
  const products = sampleState().products;
  const batch = prepareBulkProducts('  牛ひき肉 \r\n\n鶏もも肉\r牛ひき肉\n牛乳\n', ' 肉屋 ', products);
  assert.deepEqual(batch, { supplier: '肉屋', names: ['牛ひき肉', '牛乳'], skipped: 2 });
  assert.equal(products.length, 6);
});

test('bulk registration rejects empty input, invalid lengths, and all-existing products', () => {
  const products = sampleState().products;
  assert.throws(() => prepareBulkProducts(' \n ', '肉屋', products), /1行に1つ/);
  assert.throws(() => prepareBulkProducts('牛ひき肉', ' ', products), /業者名/);
  assert.throws(() => prepareBulkProducts('牛ひき肉\n' + '長'.repeat(81), '肉屋', products), /80文字/);
  assert.throws(() => prepareBulkProducts('鶏もも肉', '肉屋', products), /登録済み/);
  assert.throws(() => prepareBulkProducts(Array(101).fill('牛ひき肉').join('\n'), '肉屋', products), /100行/);
  assert.equal(products.length, 6);
});

test('CSV round trip preserves Japanese commas quotes and multiline notes without quantities', () => {
  const products = [{ id: 'one', supplier: '業者,Ａ', name: '豆"深煎り"', note: '1行目\r\n2行目,備考', quantity: 5 }];
  const csv = exportCsv(products);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.deepEqual(prepareCsvImport(csv, []).additions, [{ supplier: '業者,Ａ', name: '豆"深煎り"', note: '1行目\r\n2行目,備考', quantity: 0 }]);
  assert.equal(parseCsv('a,b,\r\n')[0][2], '');
});

test('CSV import supports reordered columns and skips duplicates without changing existing products', () => {
  const products = sampleState().products;
  products[0].quantity = 7;
  const csv = '商品名,備考,業者名\n鶏もも肉,変更した備考,肉屋\n牛ひき肉,,肉屋\n牛ひき肉,,肉屋\n牛乳,,肉屋\n\n';
  const batch = prepareCsvImport(csv, products);
  assert.equal(batch.skipped, 2);
  assert.deepEqual(batch.additions.map(p => p.name), ['牛ひき肉', '牛乳']);
  assert.equal(products[0].quantity, 7);
  assert.equal(products[0].note, '1kgパック');
  assert.equal(products.length, 6);
});

test('CSV rejects malformed quoting headers and invalid later rows before returning additions', () => {
  assert.throws(() => parseCsv('"abc'), /閉じ/);
  assert.throws(() => parseCsv('"abc"bad'), /引用符/);
  assert.throws(() => prepareCsvImport('業者,商品,備考\n肉屋,肉,', []), /先頭行/);
  assert.throws(() => prepareCsvImport('業者名,商品名,備考\n肉屋,肉,\n肉屋,,', []), /3行目/);
  assert.throws(() => prepareCsvImport('業者名,商品名,備考\n肉屋,肉', []), /2行目/);
  assert.throws(() => prepareCsvImport('業者名,商品名,備考', []), /商品がありません/);
});

test('supplier reordering supports old saved data and survives removed and new suppliers', () => {
  const products = sampleState().products;
  assert.deepEqual(supplierOrder(products), ['肉屋', '八百屋', '食品卸']);
  const moved = moveSupplier(products, [], '八百屋', -1);
  assert.deepEqual(moved, ['八百屋', '肉屋', '食品卸']);
  assert.deepEqual(groups(products, false, moved).map(g => g.supplier), moved);
  assert.deepEqual(moveSupplier(products, moved, '八百屋', -1), moved);
  assert.deepEqual(supplierOrder(products.filter(p => p.supplier !== '肉屋'), moved), ['八百屋', '食品卸']);
  const state = sampleState();
  assert.equal(validateState(state), true);
  state.supplierOrder = moved;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))), true);
  state.supplierOrder = ['肉屋', '肉屋'];
  assert.equal(validateState(state), false);
});

test('search normalizes width and case and leaves selection quantities untouched', () => {
  const products = sampleState().products;
  products.push({ id: 'search', supplier: '食品卸', name: 'Cafe 1L', note: '', quantity: 3 });
  assert.deepEqual(searchProducts(products, ' ＣＡＦＥ ').map(p => p.id), ['search']);
  assert.deepEqual(searchProducts(products, 'もも').map(p => p.name), ['鶏もも肉']);
  assert.equal(searchProducts(products, '不存在').length, 0);
  assert.equal(searchProducts(products, '').length, products.length);
  assert.equal(totals(products).quantity, 3);
});

test('product reordering preserves other suppliers and all notes and quantities', () => {
  const products = sampleState().products;
  products[0].quantity = 3;
  const next = reorderSupplierProducts(products, '肉屋', ['sample-2', 'sample-1']);
  assert.deepEqual(next.map(p => p.id), ['sample-2', 'sample-1', 'sample-3', 'sample-4', 'sample-5', 'sample-6']);
  assert.equal(next[1], products[0]);
  assert.equal(next[1].quantity, 3);
  assert.equal(next[1].note, '1kgパック');
  assert.deepEqual(products.map(p => p.id), ['sample-1', 'sample-2', 'sample-3', 'sample-4', 'sample-5', 'sample-6']);
  assert.throws(() => reorderSupplierProducts(products, '肉屋', ['sample-1', 'sample-1']));
  assert.throws(() => reorderSupplierProducts(products, '肉屋', ['sample-1', 'sample-3']));
  assert.throws(() => reorderSupplierProducts(products, '肉屋', ['sample-1']));
});


test('editing moves a product to another supplier and preserves its quantity and identity', () => {
  const products = sampleState().products;
  products[0].quantity = 7;
  const next = editProduct(products, 'sample-1', { name: ' 鶏むね肉 ', supplier: ' 食品卸 ', note: ' 2kg ' });
  assert.deepEqual(next[0], { ...products[0], name: '鶏むね肉', supplier: '食品卸', note: '2kg' });
  assert.equal(next[1], products[1]);
  assert.equal(products[0].name, '鶏もも肉');
  assert.equal(validateState({ version: 1, products: next }), true);
  assert.deepEqual(supplierOrder(next, ['肉屋', '八百屋', '食品卸']), ['肉屋', '八百屋', '食品卸']);
});

test('editing permits unchanged names but rejects collisions, missing products and invalid fields', () => {
  const products = sampleState().products;
  assert.doesNotThrow(() => editProduct(products, 'sample-1', products[0]));
  assert.throws(() => editProduct(products, 'sample-1', products[1]), /同じ業者/);
  assert.throws(() => editProduct(products, 'missing', products[0]), /削除/);
  for (const fields of [{ name: ' ' }, { supplier: ' ' }, { name: '長'.repeat(81) }, { note: '長'.repeat(501) }])
    assert.throws(() => editProduct(products, 'sample-1', { ...products[0], ...fields }), /文字/);
});

test('bulk deletion removes only selected identities across suppliers and supports deleting all', () => {
  const products = sampleState().products;
  products[1].quantity = 5;
  const next = deleteProducts(products, ['sample-1', 'sample-3', 'missing', 'sample-1']);
  assert.deepEqual(next.map(p => p.id), ['sample-2', 'sample-4', 'sample-5', 'sample-6']);
  assert.equal(next[0], products[1]);
  assert.equal(next[0].quantity, 5);
  assert.equal(products.length, 6);
  assert.deepEqual(deleteProducts(products, []), products);
  assert.deepEqual(deleteProducts(products, products.map(p => p.id)), []);
  assert.equal(validateState({ version: 1, products: next }), true);
});
