import { STORAGE_KEY, MAX_QUANTITY, sampleState, validateState, changeQuantity, groups, totals, orderText, prepareBulkProducts, supplierOrder, moveSupplier, searchProducts, exportCsv, prepareCsvImport } from './model.js?v=5';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
let initialMessage = '';
let state = load();
let activeSupplier = null;
let noticeTimer;
let copyPending = false;
let activeSupplierOption = -1;
let productAddMode = 'single';
let productQuery = '';
let supplierSorting = false;
let importPending = false;

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
    state.supplierOrder = supplierOrder(state.products, state.supplierOrder);
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
    <div class="summary-line"><span>発注先</span><strong id="total-suppliers">${total.suppliers} 業者</strong></div>
    <div class="summary-line summary-quantity"><span>合計数量</span><strong id="total-quantity">${total.quantity}</strong></div>
    ${review ? '<button class="primary" data-action="copy">発注内容をコピー</button><a href="#list" class="summary-back">数量を変更する</a>' : `<button class="primary" data-action="review" ${total.quantity ? '' : 'disabled'}>発注内容を確認</button>`}
  </aside>`;
}

function catalogueView() {
  const visible = groups(searchProducts(state.products, productQuery), false, state.supplierOrder)
    .filter(g => activeSupplier === null || g.supplier === activeSupplier);
  if (!state.products.length) return '<div class="empty"><h2>商品がありません</h2><a href="#add" class="primary">最初の商品を追加</a></div>';
  if (!visible.length) return '<div class="empty"><h2>該当する商品がありません</h2></div>';
  return visible.map(({ supplier, items }) => `<article class="supplier-card"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
    ${items.map(p => `<div class="product-row" data-row="${escape(p.id)}"><div class="product-info"><h3 class="product-name">${escape(p.name)}</h3>
      <textarea class="product-note" data-note="${escape(p.id)}" aria-label="${escape(p.name)}の備考" rows="1" maxlength="500" placeholder="備考を追加（任意）">${escape(p.note)}</textarea></div>
      <div class="stepper" role="group" aria-label="${escape(p.name)}の数量"><button data-delta="-1" data-id="${escape(p.id)}" aria-label="${escape(p.name)}を1減らす" ${p.quantity === 0 ? 'disabled' : ''}>−</button>
      <output aria-label="${escape(p.name)}の数量">${p.quantity}</output><button class="plus" data-delta="1" data-id="${escape(p.id)}" aria-label="${escape(p.name)}を1増やす" ${p.quantity === MAX_QUANTITY ? 'disabled' : ''}>＋</button></div></div>`).join('')}</article>`).join('');
}

function listView() {
  const supplierGroups = groups(state.products, false, state.supplierOrder);
  return `<div class="workspace"><section aria-label="業者別の商品一覧">
    <input id="product-search" class="product-search" type="search" aria-label="商品検索" placeholder="商品名で検索" value="${escape(productQuery)}" autocomplete="off">
    <div class="list-tools"><button class="text-link" data-action="sort-suppliers" aria-pressed="${supplierSorting}" ${supplierGroups.length < 2 ? 'disabled' : ''}>${supplierSorting ? '並び替え完了' : '業者の並び替え'}</button><div class="csv-tools"><button class="text-link" data-action="csv-export" ${state.products.length ? '' : 'disabled'}>CSV書き出し</button><button class="text-link" data-action="csv-import">CSV読み込み</button></div></div>
    ${state.products.length ? `<div class="filters" aria-label="業者の絞り込み"><button class="filter" data-filter-all aria-pressed="${activeSupplier === null}">すべて<span class="filter-count">${state.products.length}</span></button>
    ${supplierGroups.map((g, index) => `<div class="supplier-tab"><button class="filter" data-filter="${escape(g.supplier)}" aria-pressed="${activeSupplier === g.supplier}">${escape(g.supplier)}<span class="filter-count">${g.items.length}</span></button>${supplierSorting ? `<div class="supplier-moves"><button data-move-supplier="${escape(g.supplier)}" data-direction="-1" aria-label="${escape(g.supplier)}を左へ移動" ${index === 0 ? 'disabled' : ''}>左</button><button data-move-supplier="${escape(g.supplier)}" data-direction="1" aria-label="${escape(g.supplier)}を右へ移動" ${index === supplierGroups.length - 1 ? 'disabled' : ''}>右</button></div>` : ''}</div>`).join('')}</div>` : ''}
    <div id="product-results">${catalogueView()}</div>
    </section>${summary()}</div>`;
}

function reviewView() {
  const selected = groups(state.products, true, state.supplierOrder);
  return heading('発注内容の確認')
    + (selected.length ? `<div class="workspace"><section aria-label="発注する商品">
      ${selected.map(({ supplier, items }) => `<article class="supplier-card"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
      ${items.map(p => `<div class="review-row"><div class="product-info"><h3 class="product-name">${escape(p.name)}</h3>${p.note ? `<p class="note">${escape(p.note)}</p>` : ''}</div><div class="review-quantity"><span class="quantity-sign">×</span> ${p.quantity}</div></div>`).join('')}</article>`).join('')}
      <button class="text-link" data-action="reset">選択した数量をすべて0に戻す</button>
      </section>${summary(true)}</div>` : '<div class="empty"><h2>商品が選択されていません</h2><a href="#list" class="primary">発注リストへ</a></div>');
}

function addView() {
  const bulk = productAddMode === 'bulk';
  return heading('商品を追加')
    + `<div class="form-layout"><form id="product-form" class="product-form">
      <div class="add-modes" role="group" aria-label="商品追加方法"><button type="button" data-add-mode="single" aria-pressed="${!bulk}">1件ずつ追加</button><button type="button" data-add-mode="bulk" aria-pressed="${bulk}">まとめて追加</button></div>
      <div class="field"><label for="supplier-name">業者名<span>必須</span></label><div class="supplier-picker"><input id="supplier-name" name="supplier" placeholder="例：肉屋" required maxlength="80" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplier-options"><div id="supplier-options" class="supplier-options" role="listbox" aria-label="登録済みの業者" hidden></div></div></div>
      <div id="single-product-fields" ${bulk ? 'hidden' : ''}><div class="field"><label for="product-name">商品名<span>必須</span></label><input id="product-name" name="name" placeholder="例：鶏もも肉" required maxlength="80" autocomplete="off" ${bulk ? 'disabled' : ''}></div>
      <div class="field"><label for="product-note">備考<span>任意</span></label><textarea id="product-note" name="note" maxlength="500" placeholder="例：1kgパック，薄切り" ${bulk ? 'disabled' : ''}></textarea></div></div>
      <div id="bulk-product-fields" ${bulk ? '' : 'hidden'}><div class="field"><label for="product-names">商品名（1行に1商品）<span>必須</span></label><textarea id="product-names" class="bulk-product-names" name="names" rows="7" placeholder="鶏もも肉\n豚バラ肉\n牛ひき肉" required maxlength="10000" ${bulk ? '' : 'disabled'}></textarea></div></div>
      <p id="form-error" class="error" role="alert" hidden></p><button class="primary" type="submit" id="register-products">${bulk ? 'まとめて登録する' : '商品を登録する'}</button>
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
  badge.textContent = total.quantity;
  badge.hidden = total.quantity === 0;
  const suppliers = document.querySelector('#total-suppliers');
  if (suppliers) suppliers.textContent = `${total.suppliers} 業者`;
  const quantity = document.querySelector('#total-quantity');
  if (quantity) quantity.textContent = total.quantity;
  const review = document.querySelector('[data-action="review"]');
  if (review) review.disabled = total.quantity === 0;
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
  const suppliers = groups(state.products, false, state.supplierOrder).map(g => g.supplier)
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
  if (button.dataset.action === 'csv-export') {
    const url = URL.createObjectURL(new Blob([exportCsv(state.products, state.supplierOrder)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '発注商品一覧.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (button.dataset.action === 'csv-import') {
    if (!importPending) document.querySelector('#csv-file').click();
  } else if (button.dataset.action === 'sort-suppliers') {
    supplierSorting = !supplierSorting;
    render();
    main.querySelector('[data-action="sort-suppliers"]').focus({ preventScroll: true });
  } else if (button.dataset.moveSupplier) {
    const supplier = button.dataset.moveSupplier;
    const scroll = main.querySelector('.filters').scrollLeft;
    state.supplierOrder = moveSupplier(state.products, state.supplierOrder, supplier, Number(button.dataset.direction));
    save(); render();
    const filters = main.querySelector('.filters');
    filters.scrollLeft = scroll;
    [...filters.querySelectorAll('[data-filter]')].find(b => b.dataset.filter === supplier)?.focus({ preventScroll: true });
  } else if (button.dataset.addMode) {
    productAddMode = button.dataset.addMode;
    const bulk = productAddMode === 'bulk';
    document.querySelector('#single-product-fields').hidden = bulk;
    document.querySelector('#bulk-product-fields').hidden = !bulk;
    document.querySelector('#product-name').disabled = bulk;
    document.querySelector('#product-note').disabled = bulk;
    document.querySelector('#product-names').disabled = !bulk;
    main.querySelectorAll('[data-add-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.addMode === productAddMode)));
    document.querySelector('#register-products').textContent = bulk ? 'まとめて登録する' : '商品を登録する';
    document.querySelector('#form-error').hidden = true;
    closeSupplierOptions();
  } else if ('supplierOption' in button.dataset) {
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
      await navigator.clipboard.writeText(orderText(state.products, state.supplierOrder));
      notify('発注内容をコピーしました．');
    } catch {
      document.querySelector('#dialog-title').textContent = '発注内容をコピー';
      document.querySelector('#dialog-message').textContent = '下の文章を選択してコピーしてください．';
      document.querySelector('#dialog-confirm').textContent = '閉じる';
      const textarea = document.querySelector('#copy-fallback');
      textarea.value = orderText(state.products, state.supplierOrder);
      textarea.hidden = false;
      dialog.showModal();
      textarea.focus(); textarea.select();
    } finally { copyPending = false; }
  }
});

document.querySelector('#csv-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || importPending) return;
  importPending = true;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('CSVは2MB以内にしてください．');
    const bytes = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
    const batch = prepareCsvImport(text, state.products);
    if (!batch.additions.length) { notify('CSVの商品はすべて登録済みです．'); return; }
    if (await confirmAction('CSVを読み込みますか', `${batch.additions.length}商品を追加します．${batch.skipped ? `重複${batch.skipped}件は追加しません．` : ''}既存の商品と数量はそのまま残ります．`, '読み込む')) {
      // Recheck duplicates after the dialog in case another tab changed the list.
      const current = prepareCsvImport(text, state.products);
      state.products.push(...current.additions.map(p => ({ ...p, id: crypto.randomUUID() })));
      const saved = save();
      activeSupplier = null;
      if (pageName() === 'list') render(); else location.hash = 'list';
      if (saved) notify(`${current.additions.length}商品を読み込みました．`);
    }
  } catch (cause) { notify(cause.message || 'CSVを読み込めませんでした．', true); }
  finally { importPending = false; }
});

main.addEventListener('input', event => {
  if (event.target.id === 'product-search') {
    productQuery = event.target.value;
    main.querySelector('#product-results').innerHTML = catalogueView();
    return;
  }
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
  const supplier = data.get('supplier').trim();
  const error = document.querySelector('#form-error');
  if (productAddMode === 'bulk') {
    try {
      const batch = prepareBulkProducts(data.get('names'), supplier, state.products);
      const additions = batch.names.map(name => ({ id: crypto.randomUUID(), name, supplier: batch.supplier, note: '', quantity: 0 }));
      state.products.push(...additions);
      const saved = save();
      activeSupplier = batch.supplier;
      location.hash = 'list';
      if (saved) notify(`${additions.length}商品を登録しました．${batch.skipped ? `重複${batch.skipped}件は追加していません．` : ''}`);
    } catch (cause) {
      error.textContent = cause.message;
      error.hidden = false;
    }
    return;
  }
  const name = data.get('name').trim();
  const note = data.get('note').trim();
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
