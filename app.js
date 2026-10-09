document.querySelector('#main').innerHTML = `
  <div class="page-heading"><div><p class="eyebrow">ORDER LIST</p><h1>今日の発注を，整える．</h1><p class="lead">業者ごとに，必要な商品の数量を選んでください．</p></div></div>
  <div class="workspace"><section><div class="filters"><button class="filter" aria-pressed="true">すべての業者</button><button class="filter">肉屋</button><button class="filter">八百屋</button></div>
  <article class="supplier-card"><div class="supplier-heading"><h2>肉屋</h2><span>2 商品</span></div>
  ${['鶏もも肉','豚バラ肉'].map(name => `<div class="product-row"><div class="product-info"><p class="product-name">${name}</p><p class="lead">1kgパック</p></div><div class="stepper"><button disabled>−</button><output>0</output><button class="plus">＋</button></div></div>`).join('')}</article></section>
  <aside class="summary"><p class="eyebrow">今回の発注</p><div class="summary-total"><strong>0</strong><span>商品を選択中</span></div><button class="primary" disabled>発注内容を確認</button><p class="save-caption">選択した内容はこのブラウザに保存されます．</p></aside></div>`;
