import { STORAGE_KEY, MAX_QUANTITY, sampleState, validateState, changeQuantity, groups, totals, orderText, prepareBulkProducts, supplierOrder, moveSupplier, searchProducts, exportCsv, prepareCsvImport } from './model.js?v=7';

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
let tabGesture = null;
let suppressTabClick = false;
let importPending = false;
let productSwipe = null;
let suppressProductClick = false;

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
    <div class="list-tools"><div class="csv-tools"><button class="icon-button" data-action="csv-import" aria-label="CSVインポート" title="CSVインポート"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></svg></button><button class="icon-button" data-action="csv-export" aria-label="CSVエクスポート" title="CSVエクスポート" ${state.products.length ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5"/></svg></button></div></div>
    ${state.products.length ? `<div class="filters" aria-label="業者の絞り込み"><button class="filter" data-filter-all aria-pressed="${activeSupplier === null}">すべて<span class="filter-count">${state.products.length}</span></button>
    ${supplierGroups.map(g => `<button class="filter" data-filter="${escape(g.supplier)}" aria-pressed="${activeSupplier === g.supplier}" title="長押ししてドラッグで並び替え（キーボード：Alt＋左右）">${escape(g.supplier)}<span class="filter-count">${g.items.length}</span></button>`).join('')}</div>` : ''}
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

function managementView() {
  const cards = groups(state.products, false, state.supplierOrder).map(({ supplier, items }) =>
    `<article class="supplier-card management-card"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
      ${items.map(p => `<div class="managed-row" data-managed-id="${escape(p.id)}">
        <button class="delete-product" data-delete-product="${escape(p.id)}" aria-label="${escape(p.name)}を削除" title="商品を削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>
        <div class="managed-content"><div class="product-info"><h3 class="product-name">${escape(p.name)}</h3><textarea class="product-note" data-note="${escape(p.id)}" aria-label="${escape(p.name)}の備考" rows="1" maxlength="500" placeholder="備考を追加（任意）">${escape(p.note)}</textarea></div></div>
      </div>`).join('')}</article>`).join('');
  return heading('商品管理') + `<div class="management-layout"><section aria-label="管理する商品">${cards || '<div class="empty"><h2>商品がありません</h2></div>'}${state.products.some(p => p.sample) ? '<button class="text-link" data-action="clear-samples">サンプル商品を削除</button>' : ''}</section><aside class="management-actions"><a class="primary" href="#add">商品を追加</a></aside></div>`;
}

function addView() {
  const bulk = productAddMode === 'bulk';
  return '<a class="text-link" href="#manage">商品管理へ戻る</a>' + heading('商品を追加')
    + `<div class="form-layout"><form id="product-form" class="product-form">
      <div class="add-modes" role="group" aria-label="商品追加方法"><button type="button" data-add-mode="single" aria-pressed="${!bulk}">1件ずつ追加</button><button type="button" data-add-mode="bulk" aria-pressed="${bulk}">まとめて追加</button></div>
      <div class="field"><label for="supplier-name">業者名<span>必須</span></label><div class="supplier-picker"><input id="supplier-name" name="supplier" placeholder="例：肉屋" required maxlength="80" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplier-options"><div id="supplier-options" class="supplier-options" role="listbox" aria-label="登録済みの業者" hidden></div></div></div>
      <div id="single-product-fields" ${bulk ? 'hidden' : ''}><div class="field"><label for="product-name">商品名<span>必須</span></label><input id="product-name" name="name" placeholder="例：鶏もも肉" required maxlength="80" autocomplete="off" ${bulk ? 'disabled' : ''}></div>
      <div class="field"><label for="product-note">備考<span>任意</span></label><textarea id="product-note" name="note" maxlength="500" placeholder="例：1kgパック，薄切り" ${bulk ? 'disabled' : ''}></textarea></div></div>
      <div id="bulk-product-fields" ${bulk ? '' : 'hidden'}><div class="field"><label for="product-names">商品名（1行に1商品）<span>必須</span></label><textarea id="product-names" class="bulk-product-names" name="names" rows="7" placeholder="鶏もも肉\n豚バラ肉\n牛ひき肉" required maxlength="10000" ${bulk ? '' : 'disabled'}></textarea></div></div>
      <p id="form-error" class="error" role="alert" hidden></p><button class="primary" type="submit" id="register-products">${bulk ? 'まとめて登録する' : '商品を登録する'}</button>
    </form></div>`;
}

function pageName() {
  return ['list', 'review', 'manage', 'add'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list';
}

function render(focus = false) {
  cancelTabGesture();
  cancelProductSwipe();
  const page = pageName();
  main.dataset.page = page;
  main.innerHTML = page === 'review' ? reviewView() : page === 'add' ? addView() : page === 'manage' ? managementView() : listView();
  document.querySelectorAll('nav a').forEach(a => {
    if (a.dataset.page === (page === 'add' ? 'manage' : page)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
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

function setProductReveal(row, open) {
  row.classList.toggle('revealed', open);
  row.querySelector('.managed-content').style.removeProperty('transform');
}

function cancelProductSwipe() {
  if (!productSwipe) return;
  const g = productSwipe;
  productSwipe = null;
  if (g.row.hasPointerCapture(g.id)) g.row.releasePointerCapture(g.id);
  g.row.classList.remove('swiping');
  setProductReveal(g.row, g.open);
}

main.addEventListener('pointerdown', event => {
  const row = event.target.closest('.managed-row');
  if (!row || event.target.closest('textarea, button') || !event.isPrimary || event.button !== 0) return;
  cancelProductSwipe();
  suppressProductClick = false;
  main.querySelectorAll('.managed-row.revealed').forEach(other => { if (other !== row) setProductReveal(other, false); });
  productSwipe = { row, id: event.pointerId, x: event.clientX, y: event.clientY,
    open: row.classList.contains('revealed'), moved: false, offset: row.classList.contains('revealed') ? -76 : 0 };
});
main.addEventListener('pointermove', event => {
  const g = productSwipe;
  if (!g || g.id !== event.pointerId) return;
  const dx = event.clientX - g.x, dy = event.clientY - g.y;
  if (!g.moved) {
    if (Math.hypot(dx, dy) < 8) return;
    if (Math.abs(dy) >= Math.abs(dx)) { cancelProductSwipe(); return; }
    g.moved = true;
    g.row.setPointerCapture(g.id);
    g.row.classList.add('swiping');
  }
  g.offset = Math.max(-76, Math.min(0, (g.open ? -76 : 0) + dx));
  g.row.querySelector('.managed-content').style.transform = `translateX(${g.offset}px)`;
  g.row.classList.toggle('revealed', g.offset < 0);
  suppressProductClick = true;
});
main.addEventListener('pointerup', event => {
  const g = productSwipe;
  if (!g || g.id !== event.pointerId) return;
  g.open = g.offset < -38;
  cancelProductSwipe();
  setTimeout(() => { suppressProductClick = false; }, 0);
});
main.addEventListener('pointercancel', cancelProductSwipe);
main.addEventListener('focusin', event => {
  const row = event.target.closest('.managed-row');
  if (!row) return;
  if (event.target.closest('.delete-product')) setProductReveal(row, true);
  else if (event.target.matches('textarea')) setProductReveal(row, false);
});
main.addEventListener('keydown', event => {
  const row = event.target.closest('.managed-row');
  if (row && event.key === 'Escape') setProductReveal(row, false);
});

// Horizontal swipes scroll the tabs; holding a touch tab starts reordering.
function cancelTabGesture() {
  if (!tabGesture) return;
  clearTimeout(tabGesture.timer);
  cancelAnimationFrame(tabGesture.frame);
  tabGesture.button?.classList.remove('dragging');
  if (tabGesture.filters.hasPointerCapture(tabGesture.id)) tabGesture.filters.releasePointerCapture(tabGesture.id);
  tabGesture = null;
}

function updateTabDrag() {
  const g = tabGesture;
  if (!g?.reordering) return;
  const bounds = g.filters.getBoundingClientRect();
  const edge = g.x < bounds.left + 28 ? -7 : g.x > bounds.right - 28 ? 7 : 0;
  if (edge) g.filters.scrollLeft += edge;
  const others = [...g.filters.querySelectorAll('[data-filter]')].filter(b => b !== g.button);
  const before = others.find(b => { const r = b.getBoundingClientRect(); return g.x < r.left + r.width / 2; });
  if (before) g.filters.insertBefore(g.button, before); else g.filters.append(g.button);
  g.frame = requestAnimationFrame(updateTabDrag);
}

main.addEventListener('pointerdown', event => {
  const filters = event.target.closest('.filters');
  if (!filters || !event.isPrimary || event.button !== 0) return;
  cancelTabGesture();
  suppressTabClick = false;
  const button = event.target.closest('[data-filter]');
  const g = tabGesture = { filters, button, id: event.pointerId, startX: event.clientX,
    startY: event.clientY, x: event.clientX, scroll: filters.scrollLeft, moved: false,
    touch: event.pointerType !== 'mouse', reordering: false };
  if (g.touch && button) g.timer = setTimeout(() => {
    if (tabGesture !== g || g.moved) return;
    g.reordering = true;
    filters.setPointerCapture(g.id);
    button.classList.add('dragging');
    updateTabDrag();
  }, 350);
});

main.addEventListener('pointermove', event => {
  const g = tabGesture;
  if (!g || g.id !== event.pointerId) return;
  g.x = event.clientX;
  const dx = g.x - g.startX;
  const dy = event.clientY - g.startY;
  if (!g.moved && !g.reordering && Math.hypot(dx, dy) > 7) {
    g.moved = true;
    g.filters.setPointerCapture(g.id);
    clearTimeout(g.timer);
    if (Math.abs(dy) > Math.abs(dx)) { cancelTabGesture(); return; }
    if (!g.touch && g.button) {
      g.reordering = true;
      g.button.classList.add('dragging');
      updateTabDrag();
    }
  }
  if (g.moved || g.reordering) {
    suppressTabClick = true;
    if (!g.reordering) g.filters.scrollLeft = g.scroll - dx;
  }
});

main.addEventListener('pointerup', event => {
  const g = tabGesture;
  if (!g || g.id !== event.pointerId) return;
  const order = [...g.filters.querySelectorAll('[data-filter]')].map(b => b.dataset.filter);
  const scroll = g.filters.scrollLeft;
  const supplier = g.button?.dataset.filter;
  const reordered = g.reordering;
  suppressTabClick = g.moved || reordered;
  setTimeout(() => { suppressTabClick = false; }, 0);
  cancelTabGesture();
  if (reordered) {
    state.supplierOrder = order;
    save(); render();
    main.querySelector('.filters').scrollLeft = scroll;
    [...main.querySelectorAll('[data-filter]')].find(b => b.dataset.filter === supplier)?.focus({ preventScroll: true });
  }
});
main.addEventListener('pointercancel', () => {
  const reorder = tabGesture?.reordering;
  cancelTabGesture();
  if (reorder) render();
});
main.addEventListener('contextmenu', event => {
  if (event.target.closest('.filters')) event.preventDefault();
});
main.addEventListener('keydown', event => {
  const button = event.target.closest('[data-filter]');
  if (!button || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const supplier = button.dataset.filter;
  const scroll = button.closest('.filters').scrollLeft;
  state.supplierOrder = moveSupplier(state.products, state.supplierOrder, supplier, event.key === 'ArrowLeft' ? -1 : 1);
  save(); render();
  main.querySelector('.filters').scrollLeft = scroll;
  [...main.querySelectorAll('[data-filter]')].find(b => b.dataset.filter === supplier)?.focus({ preventScroll: true });
});

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
  if (button.closest('.managed-row') && suppressProductClick) return;
  if (button.dataset.deleteProduct) {
    const product = state.products.find(p => p.id === button.dataset.deleteProduct);
    if (!product) return;
    if (await confirmAction('商品を削除しますか', `「${product.name}」を削除します．${product.quantity ? `選択中の数量${product.quantity}も削除されます．` : ''}`, '削除する')) {
      state.products = state.products.filter(p => p.id !== product.id);
      if (!state.products.some(p => p.supplier === activeSupplier)) activeSupplier = null;
      const saved = save(); render();
      if (saved) notify(`「${product.name}」を削除しました．`);
    }
    return;
  }
  if (button.closest('.filters') && suppressTabClick) { suppressTabClick = false; return; }
  if (button.dataset.action === 'csv-export') {
    const url = URL.createObjectURL(new Blob([exportCsv(state.products, state.supplierOrder)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '発注商品一覧.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (button.dataset.action === 'csv-import') {
    if (!importPending) document.querySelector('#csv-file').click();
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
      location.hash = 'manage';
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
  location.hash = 'manage';
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
