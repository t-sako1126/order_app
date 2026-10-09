import { STORAGE_KEY, MAX_QUANTITY, sampleState, validateState, changeQuantity, groups, totals, orderText } from './model.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
let initialMessage = '';
let state = load();
let activeSupplier = null;
let noticeTimer;
let copyPending = false;
let activeSupplierOption = -1;

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return sampleState();
    const parsed = JSON.parse(saved);
    if (!validateState(parsed)) throw new Error('Invalid state');
    return parsed;
  } catch {
    initialMessage = '保存データを読み込めませんでした．サンプルを表示しています．';
    return sampleState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    notify('ブラウザに保存できません．この画面を閉じると変更が失われます．', true);
    return false;
  }
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function notify(message, persistent = false) {
  const notice = document.querySelector('#notice');
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  if (!persistent) noticeTimer = setTimeout(() => { notice.hidden = true; }, 4500);
}

function heading(title) {
  return `<div class="page-heading"><h1>${title}</h1></div>`;
}

function summary(review = false) {
  const total = totals(state.products);
  return `<aside class="summary ${review ? 'review-summary' : 'list-summary'}" aria-label="今回の発注の集計"><h2 class="summary-title">今回の発注</h2>
    <div class="summary-total"><strong id="total-count">${total.count}</strong><span>商品</span></div>
    <div class="summary-line"><span>発注先</span><strong id="total-suppliers">${total.suppliers} 業者</strong></div>
    <div class="summary-line"><span>合計数量</span><strong id="total-quantity">${total.quantity}</strong></div>
    ${review ? '<button class="primary" data-action="copy">発注内容をコピー</button><a href="#list" class="summary-back">数量を変更する</a>' : `<button class="primary" data-action="review" ${total.count ? '' : 'disabled'}>発注内容を確認</button>`}
  </aside>`;
}

function listView() {
  const supplierGroups = groups(state.products);
  const visible = supplierGroups.filter(g => activeSupplier === null || g.supplier === activeSupplier);
  return `<div class="workspace"><section aria-label="業者別の商品一覧">
    ${state.products.length ? `<div class="filters" aria-label="業者の絞り込み"><button class="filter" data-filter-all aria-pressed="${activeSupplier === null}">すべて<span class="filter-count">${state.products.length}</span></button>
    ${supplierGroups.map(g => `<button class="filter" data-filter="${escape(g.supplier)}" aria-pressed="${activeSupplier === g.supplier}">${escape(g.supplier)}<span class="filter-count">${g.items.length}</span></button>`).join('')}</div>` : ''}
    ${visible.map(({ supplier, items }) => `<article class="supplier-card"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
      ${items.map(p => `<div class="product-row" data-row="${escape(p.id)}"><div class="product-info"><h3 class="product-name">${escape(p.name)}</h3>
        <textarea class="product-note" data-note="${escape(p.id)}" aria-label="${escape(p.name)}の備考" rows="1" maxlength="500" placeholder="備考を追加（任意）">${escape(p.note)}</textarea></div>
        <div class="stepper" role="group" aria-label="${escape(p.name)}の数量"><button data-delta="-1" data-id="${escape(p.id)}" aria-label="${escape(p.name)}を1減らす" ${p.quantity === 0 ? 'disabled' : ''}>−</button>
        <output aria-label="${escape(p.name)}の数量">${p.quantity}</output><button class="plus" data-delta="1" data-id="${escape(p.id)}" aria-label="${escape(p.name)}を1増やす" ${p.quantity === MAX_QUANTITY ? 'disabled' : ''}>＋</button></div></div>`).join('')}</article>`).join('')}
    ${state.products.length ? '' : '<div class="empty"><h2>商品がありません</h2><a href="#add" class="primary">最初の商品を追加</a></div>'}
    </section>${summary()}</div>`;
}

function reviewView() {
  const selected = groups(state.products, true);
  return heading('発注内容の確認')
    + (selected.length ? `<div class="workspace"><section aria-label="発注する商品">
      ${selected.map(({ supplier, items }) => `<article class="supplier-card"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
      ${items.map(p => `<div class="review-row"><div class="product-info"><h3 class="product-name">${escape(p.name)}</h3>${p.note ? `<p class="note">${escape(p.note)}</p>` : ''}</div><div class="review-quantity"><span class="quantity-sign">×</span> ${p.quantity}</div></div>`).join('')}</article>`).join('')}
      <button class="text-link" data-action="reset">選択した数量をすべて0に戻す</button>
      </section>${summary(true)}</div>` : '<div class="empty"><h2>商品が選択されていません</h2><a href="#list" class="primary">発注リストへ</a></div>');
}

function addView() {
  return heading('商品を追加')
    + `<div class="form-layout"><form id="product-form" class="product-form">
      <div class="field"><label for="product-name">商品名<span>必須</span></label><input id="product-name" name="name" placeholder="例：鶏もも肉" required maxlength="80" autocomplete="off"></div>
      <div class="field"><label for="supplier-name">業者名<span>必須</span></label><div class="supplier-picker"><input id="supplier-name" name="supplier" placeholder="例：肉屋" required maxlength="80" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplier-options"><div id="supplier-options" class="supplier-options" role="listbox" aria-label="登録済みの業者" hidden></div></div></div>
      <div class="field"><label for="product-note">備考<span>任意</span></label><textarea id="product-note" name="note" maxlength="500" placeholder="例：1kgパック，薄切り"></textarea></div>
      <p id="form-error" class="error" role="alert" hidden></p><button class="primary" type="submit">商品を登録する</button>
    </form>${state.products.some(p => p.sample) ? '<button class="text-link" type="button" data-action="clear-samples">サンプル商品を削除</button>' : ''}</div>`;
}

function pageName() {
  return ['list', 'review', 'add'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list';
}

function render(focus = false) {
  const page = pageName();
  main.dataset.page = page;
  main.innerHTML = page === 'review' ? reviewView() : page === 'add' ? addView() : listView();
  document.querySelectorAll('nav a').forEach(a => {
    if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  updateTotals();
  if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

function updateTotals() {
  const total = totals(state.products);
  const badge = document.querySelector('#nav-count');
  badge.textContent = total.count;
  badge.hidden = total.count === 0;
  const count = document.querySelector('#total-count');
  if (count) count.textContent = total.count;
  const suppliers = document.querySelector('#total-suppliers');
  if (suppliers) suppliers.textContent = `${total.suppliers} 業者`;
  const quantity = document.querySelector('#total-quantity');
  if (quantity) quantity.textContent = total.quantity;
  const review = document.querySelector('[data-action="review"]');
  if (review) review.disabled = total.count === 0;
}

function closeSupplierOptions() {
  const input = document.querySelector('#supplier-name');
  const options = document.querySelector('#supplier-options');
  if (!input || !options) return;
  options.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  activeSupplierOption = -1;
}

function showSupplierOptions(filter = false) {
  const input = document.querySelector('#supplier-name');
  const options = document.querySelector('#supplier-options');
  if (!input || !options) return;
  const query = filter ? input.value.trim().toLocaleLowerCase('ja') : '';
  const suppliers = groups(state.products).map(g => g.supplier)
    .filter(name => name.toLocaleLowerCase('ja').includes(query));
  options.innerHTML = suppliers.map((name, index) => `<button type="button" class="supplier-option" id="supplier-option-${index}" role="option" aria-selected="false" tabindex="-1" data-supplier-option="${escape(name)}">${escape(name)}</button>`).join('');
  options.hidden = suppliers.length === 0;
  input.setAttribute('aria-expanded', String(suppliers.length > 0));
  input.removeAttribute('aria-activedescendant');
  activeSupplierOption = -1;
}

function selectSupplier(name) {
  const input = document.querySelector('#supplier-name');
  input.value = name;
  closeSupplierOptions();
  input.focus({ preventScroll: true });
}

main.addEventListener('focusin', event => {
  if (event.target.id === 'supplier-name') showSupplierOptions();
});

main.addEventListener('focusout', event => {
  if (event.target.id === 'supplier-name') closeSupplierOptions();
});

document.addEventListener('pointerdown', event => {
  if (event.target.closest('.supplier-option')) event.preventDefault();
  else if (!event.target.closest('.supplier-picker')) closeSupplierOptions();
});

main.addEventListener('keydown', event => {
  if (event.target.id !== 'supplier-name' || event.isComposing) return;
  const input = event.target;
  const list = document.querySelector('#supplier-options');
  if (event.key === 'Escape') { closeSupplierOptions(); return; }
  if (event.key === 'Enter' && !list.hidden && activeSupplierOption >= 0) {
    event.preventDefault();
    selectSupplier(list.children[activeSupplierOption].dataset.supplierOption);
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  if (list.hidden) showSupplierOptions();
  const options = [...list.children];
  if (!options.length) return;
  activeSupplierOption = activeSupplierOption < 0
    ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
    : (activeSupplierOption + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSupplierOption)));
  const active = options[activeSupplierOption];
  input.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
});

async function confirmAction(title, message, confirmLabel) {
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#dialog-message').textContent = message;
  document.querySelector('#dialog-confirm').textContent = confirmLabel;
  document.querySelector('#copy-fallback').hidden = true;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

main.addEventListener('click', async event => {
  if (event.target.id === 'supplier-name') { showSupplierOptions(); return; }
  const button = event.target.closest('button');
  if (!button) return;
  if ('supplierOption' in button.dataset) {
    selectSupplier(button.dataset.supplierOption);
  } else if (button.dataset.delta) {
    const product = state.products.find(p => p.id === button.dataset.id);
    if (!product) return;
    product.quantity = changeQuantity(product.quantity, Number(button.dataset.delta));
    save();
    const row = button.closest('.product-row');
    row.querySelector('output').textContent = product.quantity;
    row.querySelector('[data-delta="-1"]').disabled = product.quantity === 0;
    row.querySelector('[data-delta="1"]').disabled = product.quantity === MAX_QUANTITY;
    updateTotals();
  } else if ('filter' in button.dataset || 'filterAll' in button.dataset) {
    activeSupplier = button.dataset.filter ?? null;
    const scroll = main.querySelector('.filters').scrollLeft;
    render();
    main.querySelector('.filters').scrollLeft = scroll;
    const filter = [...main.querySelectorAll('.filter')].find(b => b.getAttribute('aria-pressed') === 'true');
    filter?.focus({ preventScroll: true });
  } else if (button.dataset.action === 'review') {
    location.hash = 'review';
  } else if (button.dataset.action === 'reset') {
    if (await confirmAction('数量を0に戻しますか', '商品と備考はそのまま残り，選択した数量だけが0になります．', '0に戻す')) {
      state.products.forEach(p => { p.quantity = 0; });
      const saved = save(); render(true);
      if (saved) notify('数量を0に戻しました．');
    }
  } else if (button.dataset.action === 'clear-samples') {
    if (await confirmAction('サンプルを取り除きますか', 'サンプル商品の数量と備考も削除されます．自分で登録した商品は残ります．', 'サンプルを消す')) {
      state.products = state.products.filter(p => !p.sample);
      activeSupplier = null;
      const saved = save(); render(true);
      if (saved) notify('サンプルを取り除きました．商品を追加できます．');
    }
  } else if (button.dataset.action === 'copy' && !copyPending) {
    copyPending = true;
    try {
      await navigator.clipboard.writeText(orderText(state.products));
      notify('発注内容をコピーしました．');
    } catch {
      document.querySelector('#dialog-title').textContent = '発注内容をコピー';
      document.querySelector('#dialog-message').textContent = '下の文章を選択してコピーしてください．';
      document.querySelector('#dialog-confirm').textContent = '閉じる';
      const textarea = document.querySelector('#copy-fallback');
      textarea.value = orderText(state.products);
      textarea.hidden = false;
      dialog.showModal();
      textarea.focus(); textarea.select();
    } finally { copyPending = false; }
  }
});

main.addEventListener('input', event => {
  if (event.target.id === 'supplier-name') { showSupplierOptions(true); return; }
  const id = event.target.dataset.note;
  if (!id) return;
  const product = state.products.find(p => p.id === id);
  if (product) { product.note = event.target.value; save(); }
});

main.addEventListener('submit', event => {
  if (event.target.id !== 'product-form') return;
  event.preventDefault();
  const data = new FormData(event.target);
  const name = data.get('name').trim();
  const supplier = data.get('supplier').trim();
  const note = data.get('note').trim();
  const error = document.querySelector('#form-error');
  if (!name || !supplier || name.length > 80 || supplier.length > 80 || note.length > 500) {
    error.textContent = '商品名と業者名は1〜80文字，備考は500文字以内で入力してください．';
    error.hidden = false; return;
  }
  if (state.products.some(p => p.name === name && p.supplier === supplier)) {
    error.textContent = '同じ業者に同じ商品名が登録されています．発注リストを確認してください．';
    error.hidden = false; return;
  }
  state.products.push({ id: crypto.randomUUID(), name, supplier, note, quantity: 0 });
  const saved = save();
  activeSupplier = supplier;
  location.hash = 'list';
  if (saved) notify(`「${name}」を登録しました．`);
});

window.addEventListener('hashchange', () => render(true));
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try {
    const updated = JSON.parse(event.newValue);
    if (!validateState(updated)) throw new Error('Invalid state');
    if (pageName() === 'add') { state = updated; notify('別のタブで商品リストが更新されました．'); return; }
    state = updated;
    if (!state.products.some(p => p.supplier === activeSupplier)) activeSupplier = null;
    render(); notify('別のタブで変更した内容を反映しました．');
  } catch { notify('別のタブの保存データを読み込めませんでした．', true); }
});
render();
if (initialMessage) notify(initialMessage, true);
