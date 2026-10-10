import { STORAGE_KEY, MAX_QUANTITY, sampleState, validateState, changeQuantity, groups, totals, orderText, prepareBulkProducts, supplierOrder, moveSupplier, searchProducts, exportCsv, prepareCsvImport, reorderSupplierProducts, editProduct, deleteProducts } from './model.js?v=11';

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
let bulkDeleteMode = false;
let selectedDeleteIds = new Set();

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

function csvTools() {
  return `<div class="list-tools"><div class="csv-tools"><button class="icon-button" data-action="csv-import" aria-label="CSVインポート" title="CSVインポート"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></svg></button><button class="icon-button" data-action="csv-export" aria-label="CSVエクスポート" title="CSVエクスポート" ${state.products.length ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5"/></svg></button><button class="icon-button bulk-delete-toggle" data-action="bulk-mode" aria-label="${bulkDeleteMode ? '選択を終了' : '一括削除'}" title="${bulkDeleteMode ? '選択を終了' : '一括削除'}" aria-pressed="${bulkDeleteMode}" ${state.products.length || bulkDeleteMode ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div></div>`;
}

function managementView() {
  selectedDeleteIds = new Set([...selectedDeleteIds].filter(id => state.products.some(p => p.id === id)));
  const cards = groups(state.products, false, state.supplierOrder).map(({ supplier, items }) =>
    `<article class="supplier-card management-card" data-managed-list="${escape(supplier)}"><div class="supplier-heading"><h2>${escape(supplier)}</h2><span>${items.length} 商品</span></div>
      ${items.map(p => `<div class="managed-row" data-managed-id="${escape(p.id)}">
        ${bulkDeleteMode ? '' : `<button class="delete-product" data-delete-product="${escape(p.id)}" aria-label="${escape(p.name)}を削除" title="商品を削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>`}
        <div class="managed-content">${bulkDeleteMode ? `<label class="product-select"><input type="checkbox" data-select-product="${escape(p.id)}" aria-label="${escape(p.name)}を選択" ${selectedDeleteIds.has(p.id) ? 'checked' : ''}></label>` : `<button class="reorder-product" data-reorder-product="${escape(p.id)}" aria-label="${escape(p.name)}を並び替え" title="長押しで並び替え（Alt＋上下）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h14"/></svg></button>`}<div class="product-info"><h3 class="product-name">${escape(p.name)}</h3><textarea class="product-note" data-note="${escape(p.id)}" aria-label="${escape(p.name)}の備考" rows="1" maxlength="500" placeholder="備考を追加（任意）">${escape(p.note)}</textarea></div>${bulkDeleteMode ? '' : `<button class="edit-product secondary" data-edit-product="${escape(p.id)}" aria-label="${escape(p.name)}を編集">編集</button>`}</div>
      </div>`).join('')}</article>`).join('');
  return `<div class="page-heading management-heading"><h1>商品管理</h1>${csvTools()}</div>` + `${bulkDeleteMode ? `<div class="selection-toolbar"><label class="select-all"><input type="checkbox" data-select-all ${state.products.length && selectedDeleteIds.size === state.products.length ? 'checked' : ''}>すべて選択</label><span id="selected-count" aria-live="polite">${selectedDeleteIds.size}商品を選択</span></div>` : ''}<div class="management-layout"><section aria-label="管理する商品">${cards || '<div class="empty"><h2>商品がありません</h2></div>'}${state.products.some(p => p.sample) ? '<button class="text-link" data-action="clear-samples">サンプル商品を削除</button>' : ''}</section><aside class="management-actions">${bulkDeleteMode ? `<button class="primary danger" data-action="bulk-delete" ${selectedDeleteIds.size ? '' : 'disabled'}>選択した商品を削除</button>` : '<a class="primary" href="#add">商品を追加</a>'}</aside></div>`;
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

function editView() {
  const id = location.hash.slice('#edit/'.length);
  const product = state.products.find(p => encodeURIComponent(p.id) === id);
  if (!product) return '<a class="text-link" href="#manage">商品管理へ戻る</a>' + heading('商品が見つかりません');
  return '<a class="text-link" href="#manage">商品管理へ戻る</a>' + heading('商品を編集')
    + `<div class="form-layout"><form id="product-edit-form" class="product-form" data-product-id="${escape(product.id)}">
      <div class="field"><label for="supplier-name">業者名<span>必須</span></label><div class="supplier-picker"><input id="supplier-name" name="supplier" value="${escape(product.supplier)}" required maxlength="80" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplier-options"><div id="supplier-options" class="supplier-options" role="listbox" aria-label="登録済みの業者" hidden></div></div></div>
      <div class="field"><label for="product-name">商品名<span>必須</span></label><input id="product-name" name="name" value="${escape(product.name)}" required maxlength="80" autocomplete="off"></div>
      <div class="field"><label for="product-note">備考<span>任意</span></label><textarea id="product-note" name="note" maxlength="500">${escape(product.note)}</textarea></div>
      <p id="form-error" class="error" role="alert" hidden></p><button class="primary" type="submit">変更を保存</button>
    </form></div>`;
}

function updateSelectionUI() {
  const all = main.querySelector('[data-select-all]');
  if (!all) return;
  all.checked = state.products.length > 0 && selectedDeleteIds.size === state.products.length;
  all.indeterminate = selectedDeleteIds.size > 0 && !all.checked;
  main.querySelectorAll('[data-select-product]').forEach(input => { input.checked = selectedDeleteIds.has(input.dataset.selectProduct); });
  main.querySelector('#selected-count').textContent = `${selectedDeleteIds.size}商品を選択`;
  main.querySelector('[data-action="bulk-delete"]').disabled = selectedDeleteIds.size === 0;
}

main.addEventListener('change', event => {
  if (event.target.hasAttribute('data-select-product')) {
    const id = event.target.dataset.selectProduct;
    if (event.target.checked) selectedDeleteIds.add(id); else selectedDeleteIds.delete(id);
    updateSelectionUI();
  } else if (event.target.hasAttribute('data-select-all')) {
    selectedDeleteIds = new Set(event.target.checked ? state.products.map(p => p.id) : []);
    updateSelectionUI();
  }
});

function pageName() {
  if (location.hash.startsWith('#edit/')) return 'edit';
  return ['list', 'review', 'manage', 'add'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list';
}

function render(focus = false) {
  cancelTabGesture();
  cancelProductSwipe();
  const page = pageName();
  main.dataset.page = page;
  main.innerHTML = page === 'edit' ? editView() : page === 'review' ? reviewView() : page === 'add' ? addView() : page === 'manage' ? managementView() : listView();
  document.querySelectorAll('nav a').forEach(a => {
    if (a.dataset.page === (['add', 'edit'].includes(page) ? 'manage' : page)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  updateTotals();
  updateSelectionUI();
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
  if (bulkDeleteMode || !row || event.target.closest('textarea, button, input, label') || !event.isPrimary || event.button !== 0) return;
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

// Let the browser scroll touches normally. Only a held item becomes draggable.
function cancelTabGesture() {
  const g = tabGesture;
  if (!g) return;
  tabGesture = null;
  clearTimeout(g.timer);
  cancelAnimationFrame(g.frame);
  g.ghost?.remove();
  g.item.classList.remove('drag-source');
  document.body.classList.remove('reordering');
  if (g.container.hasPointerCapture(g.id)) g.container.releasePointerCapture(g.id);
}

function startItemDrag(g) {
  if (tabGesture !== g) return;
  cancelProductSwipe();
  main.querySelectorAll('.managed-row.revealed').forEach(row => setProductReveal(row, false));
  g.dragging = true;
  suppressTabClick = true;
  const r = g.item.getBoundingClientRect();
  g.offsetX = g.x - r.left; g.offsetY = g.y - r.top;
  g.ghost = g.item.cloneNode(true);
  g.ghost.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  g.ghost.removeAttribute('id');
  g.ghost.setAttribute('aria-hidden', 'true');
  g.ghost.classList.add('drag-ghost');
  Object.assign(g.ghost.style, { width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(g.ghost);
  g.item.classList.add('drag-source');
  document.body.classList.add('reordering');
  if (!g.touch) g.container.setPointerCapture(g.id);
  updateItemDrag();
}

function updateItemDrag() {
  const g = tabGesture;
  if (!g?.dragging) return;
  g.ghost.style.left = `${g.x - g.offsetX}px`;
  g.ghost.style.top = `${g.y - g.offsetY - 6}px`;
  if (g.kind === 'supplier') {
    const r = g.container.getBoundingClientRect();
    const speed = g.x < r.left + 30 ? -6 : g.x > r.right - 30 ? 6 : 0;
    g.container.scrollLeft += speed;
  } else {
    // Keep the fixed navigation and add button clear while dragging down a list.
    const speed = g.y < 90 ? -7 : g.y > innerHeight - 180 ? 7 : 0;
    if (speed) window.scrollBy(0, speed);
  }
  const others = [...g.container.querySelectorAll(g.selector)].filter(item => item !== g.item);
  const before = others.find(item => {
    const r = item.getBoundingClientRect();
    return g.kind === 'supplier' ? g.x < r.left + r.width / 2 : g.y < r.top + r.height / 2;
  });
  if (before) g.container.insertBefore(g.item, before); else g.container.append(g.item);
  g.frame = requestAnimationFrame(updateItemDrag);
}

function prepareItemGesture(target, x, y, id, touch) {
  const handle = target.closest('[data-filter], [data-reorder-product]');
  if (!handle) return;
  cancelTabGesture();
  const product = handle.hasAttribute('data-reorder-product');
  const item = product ? handle.closest('.managed-row') : handle;
  const container = product ? handle.closest('[data-managed-list]') : handle.closest('.filters');
  const g = tabGesture = { item, container, kind: product ? 'product' : 'supplier',
    selector: product ? '.managed-row' : '[data-filter]', x, y, startX: x, startY: y, id, touch, dragging: false };
  suppressTabClick = false;
  if (touch) g.timer = setTimeout(() => startItemDrag(g), 400);
}

function finishItemDrag() {
  const g = tabGesture;
  if (!g) return;
  const dragging = g.dragging;
  const scroll = g.container.scrollLeft;
  if (dragging) {
    if (g.kind === 'supplier') state.supplierOrder = [...g.container.querySelectorAll('[data-filter]')].map(b => b.dataset.filter);
    else state.products = reorderSupplierProducts(state.products, g.container.dataset.managedList,
      [...g.container.querySelectorAll('.managed-row')].map(row => row.dataset.managedId));
  }
  cancelTabGesture();
  if (dragging) {
    save(); render();
    if (g.kind === 'supplier') main.querySelector('.filters').scrollLeft = scroll;
  }
  setTimeout(() => { suppressTabClick = false; }, 0);
}

main.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0) return;
  prepareItemGesture(event.target, event.clientX, event.clientY, event.pointerId, false);
});
main.addEventListener('pointermove', event => {
  const g = tabGesture;
  if (!g || g.touch || g.id !== event.pointerId) return;
  g.x = event.clientX; g.y = event.clientY;
  if (!g.dragging && Math.hypot(g.x - g.startX, g.y - g.startY) > 8) startItemDrag(g);
});
main.addEventListener('pointerup', event => {
  if (tabGesture && !tabGesture.touch && tabGesture.id === event.pointerId) finishItemDrag();
});
main.addEventListener('pointercancel', () => {
  if (tabGesture && !tabGesture.touch) { const dragging = tabGesture.dragging; cancelTabGesture(); if (dragging) render(); }
});
main.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) { cancelTabGesture(); return; }
  const t = event.touches[0];
  prepareItemGesture(event.target, t.clientX, t.clientY, t.identifier, true);
}, { passive: true });
main.addEventListener('touchmove', event => {
  const g = tabGesture;
  if (!g?.touch) return;
  const t = [...event.touches].find(t => t.identifier === g.id);
  if (!t) return;
  g.x = t.clientX; g.y = t.clientY;
  if (g.dragging) { event.preventDefault(); suppressTabClick = true; }
  else if (Math.hypot(g.x - g.startX, g.y - g.startY) > 8) cancelTabGesture();
}, { passive: false });
main.addEventListener('touchend', () => { if (tabGesture?.touch) finishItemDrag(); });
main.addEventListener('touchcancel', () => {
  if (tabGesture?.touch) { const dragging = tabGesture.dragging; cancelTabGesture(); if (dragging) render(); }
});
window.addEventListener('blur', () => { const dragging = tabGesture?.dragging; cancelTabGesture(); if (dragging) render(); });
main.addEventListener('contextmenu', event => {
  if (event.target.closest('.filters, .reorder-product')) event.preventDefault();
});
main.addEventListener('keydown', event => {
  if (event.key === 'Escape' && tabGesture?.dragging) { cancelTabGesture(); render(); return; }
  const handle = event.target.closest('[data-filter], [data-reorder-product]');
  if (!handle || !event.altKey) return;
  const product = handle.hasAttribute('data-reorder-product');
  const keys = product ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (product) {
    const p = state.products.find(p => p.id === handle.dataset.reorderProduct);
    const ids = state.products.filter(item => item.supplier === p.supplier).map(item => item.id);
    const from = ids.indexOf(p.id), to = from + (event.key === keys[0] ? -1 : 1);
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    state.products = reorderSupplierProducts(state.products, p.supplier, ids);
  } else state.supplierOrder = moveSupplier(state.products, state.supplierOrder, handle.dataset.filter, event.key === keys[0] ? -1 : 1);
  const scroll = handle.closest('.filters')?.scrollLeft;
  const id = product ? handle.dataset.reorderProduct : handle.dataset.filter;
  save(); render();
  if (!product) main.querySelector('.filters').scrollLeft = scroll;
  [...main.querySelectorAll(product ? '[data-reorder-product]' : '[data-filter]')]
    .find(b => (product ? b.dataset.reorderProduct : b.dataset.filter) === id)?.focus({ preventScroll: true });
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
  if (button.closest('.filters, .managed-row') && suppressTabClick) { suppressTabClick = false; return; }
  if (button.dataset.editProduct) {
    location.hash = `edit/${encodeURIComponent(button.dataset.editProduct)}`;
    return;
  }
  if (button.dataset.action === 'bulk-mode') {
    bulkDeleteMode = !bulkDeleteMode;
    selectedDeleteIds.clear();
    render();
    main.querySelector('[data-action="bulk-mode"]').focus({ preventScroll: true });
    return;
  }
  if (button.dataset.action === 'bulk-delete') {
    const selected = state.products.filter(p => selectedDeleteIds.has(p.id));
    if (!selected.length) return;
    const names = selected.map(p => `「${p.name}」`).join('，');
    if (await confirmAction(`${selected.length}商品を削除しますか`, `${names}を削除します．備考と選択中の数量も削除されます．`, '削除する')) {
      state.products = deleteProducts(state.products, selected.map(p => p.id));
      if (!state.products.some(p => p.supplier === activeSupplier)) activeSupplier = null;
      bulkDeleteMode = false; selectedDeleteIds.clear();
      const saved = save(); render();
      if (saved) notify(`${selected.length}商品を削除しました`);
    }
    return;
  }
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
      if (saved) notify('数量を0に戻しました');
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
      if (pageName() === 'manage') render(); else location.hash = 'manage';
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
  if (event.target.id === 'product-edit-form') {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      state.products = editProduct(state.products, event.target.dataset.productId, {
        name: data.get('name'), supplier: data.get('supplier'), note: data.get('note'),
      });
      if (!state.products.some(p => p.supplier === activeSupplier)) activeSupplier = null;
      const saved = save(); location.hash = 'manage';
      if (saved) notify('商品を更新しました');
    } catch (cause) {
      const error = document.querySelector('#form-error');
      error.textContent = cause.message; error.hidden = false;
    }
    return;
  }
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
    if (['add', 'edit'].includes(pageName())) { state = updated; notify('別のタブで商品リストが更新されました．'); return; }
    state = updated;
    if (!state.products.some(p => p.supplier === activeSupplier)) activeSupplier = null;
    render(); notify('別のタブで変更した内容を反映しました．');
  } catch { notify('別のタブの保存データを読み込めませんでした．', true); }
});
render();
if (initialMessage) notify(initialMessage, true);
