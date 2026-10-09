import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleState, validateState, changeQuantity, groups, totals, orderText } from './model.js';

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
