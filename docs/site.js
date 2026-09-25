(() => {
  "use strict";

  const API = "https://simka-store.onrender.com";
  const STORAGE_KEY = "simka-pages-cart-v1";
  const app = document.getElementById("app");
  const overlay = document.getElementById("cart-overlay");
  const cartBody = document.getElementById("cart-body");
  const state = { products: [], categories: [], countries: [], cart: {}, filters: {}, checkout: false, busy: false, error: "", receipt: null, requestId: null };
  try { state.cart = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { state.cart = {}; }

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const money = (amount, currency = "RUB") => { try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); } catch { return `${amount} ${currency}`; } };
  const route = () => { try { return decodeURIComponent(location.hash.slice(1) || "/"); } catch { return "/"; } };
  const productLink = (product) => `#/product/${encodeURIComponent(product.slug)}`;
  const isAvailable = (product) => product.available && product.availabilityStatus !== "OUT_OF_STOCK" && product.stockQuantity !== 0;
  const availableVariant = (product) => product.variants?.find((variant) => variant.available && variant.availabilityStatus !== "OUT_OF_STOCK" && variant.stockQuantity !== 0) || null;
  const offer = (product) => { const variant = availableVariant(product); return { variant, price: variant?.price ?? product.price, currency: variant?.currency ?? product.currency, data: variant?.data || product.data, days: variant?.days ?? product.days }; };
  const countryThemes = { japan: "ink", turkey: "blue", thailand: "violet", uae: "orange", germany: "green", usa: "pink" };
  const toneThemes = { "from-[#1679f2] to-[#0d46ad]": "blue", "from-[#7047eb] to-[#4020a7]": "violet", "from-[#ef6a39] to-[#bb2c21]": "orange", "from-[#10a985] to-[#08705c]": "green", "from-[#ef3f92] to-[#a20d5d]": "pink", "from-[#27344a] to-[#111827]": "ink" };
  const productTheme = (product) => {
    const countrySlug = state.countries.find((country) => country.id === product.countryId)?.slug;
    return countryThemes[countrySlug] || toneThemes[product.tone] || "blue";
  };
  const persistCart = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart)); } catch {} updateCartCount(); };
  const cartLines = () => Object.entries(state.cart).flatMap(([key, quantity]) => {
    const [productId, variantId] = key.split(":").map(Number);
    const product = state.products.find((item) => item.id === productId);
    if (!product || !isAvailable(product) || !Number.isInteger(quantity) || quantity < 1) return [];
    const variant = variantId ? product.variants?.find((item) => item.id === variantId) : null;
    if (variantId && !variant) return [];
    return [{ key, product, variant, quantity, price: variant?.price ?? product.price, currency: variant?.currency ?? product.currency }];
  });
  const updateCartCount = () => { document.getElementById("cart-count").textContent = String(cartLines().reduce((sum, line) => sum + line.quantity, 0)); };
  const card = (product) => {
    const current = offer(product);
    return `<article class="product-card"><div class="product-top tone-${productTheme(product)}"><span class="type">${escape(product.type)}</span><span class="flag" aria-hidden="true">${escape(product.flag || "🌍")}</span><strong class="top-data">${escape(current.data)}</strong></div><div class="product-body"><small class="muted">${escape(product.region || "")}</small><h3>${escape(product.country)}</h3><span class="muted">${escape(product.operator)}</span><div class="specs"><div class="spec"><span>Интернет</span><strong>${escape(current.data)}</strong></div><div class="spec"><span>Срок</span><strong>${escape(current.days)} дней</strong></div></div><div class="price">${money(current.price, current.currency)}${!isAvailable(product) ? " <small>Нет в наличии</small>" : ""}</div><div class="button-row"><a class="button-soft" href="${productLink(product)}">Подробнее</a><button class="button" data-add="${product.id}" ${isAvailable(product) ? "" : "disabled"}>В корзину</button></div></div></article>`;
  };
  const heading = (eyebrow, title, description) => `<div class="page-heading"><div class="eyebrow">${escape(eyebrow)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div>`;
  const productGrid = (products) => products.length ? `<div class="grid">${products.map(card).join("")}</div>` : `<div class="empty">Подходящих тарифов пока нет. Попробуйте другой фильтр или напишите менеджеру.</div>`;
  const infoCard = (title, body) => `<article class="info-card"><h2>${escape(title)}</h2><p>${escape(body)}</p></article>`;

  const pages = {
    faq: { title: "Ответы на частые вопросы", description: "Коротко о выборе и получении SIMKA.", cards: [
      ["Как проверить, поддерживает ли телефон eSIM?", "Проверьте модель устройства у производителя или найдите пункт «Добавить eSIM» в настройках телефона."],
      ["Когда начинает действовать тариф?", "Условия зависят от оператора. Точное правило указано в карточке выбранного тарифа."],
      ["Можно ли раздавать интернет?", "Это зависит от тарифа. Проверьте характеристики или уточните у менеджера до оплаты."],
      ["Когда отправят eSIM?", "Менеджер подтвердит получение оплаты, затем подготовит и отправит eSIM на email, указанный в заказе."],
    ] },
    payment: { title: "Оплата", description: "Выберите тариф и оформите заказ.", cards: [
      ["Через менеджера", "После создания заказа менеджер отправит актуальные реквизиты на email, указанный при оформлении. После поступления оплаты заказ перейдёт к выдаче или отправке."],
      ["Подтверждение", "Сохраните номер заказа. Оплата считается подтверждённой, когда менеджер фактически получит средства."],
    ] },
    delivery: { title: "Доставка", description: "Способ получения зависит от типа SIM.", cards: [
      ["eSIM", "Код активации и инструкция отправляются на email после подтверждения оплаты и подготовки заказа."],
      ["Физическая SIM", "При оформлении укажите адрес и выберите способ доставки. Срок и стоимость, если они не определены заранее, менеджер согласует до отправки реквизитов."],
    ] },
    contacts: { title: "Контакты", description: "Поможем с выбором и статусом заказа.", cards: [
      ["Поддержка в Telegram", "Напишите @qweJSq и укажите номер заказа, если он уже оформлен."],
      ["После оформления", "Менеджер отправит реквизиты на email, указанный в заказе. Проверьте также папку «Спам»."],
    ] },
    about: { title: "О компании", description: "SIMKA помогает выбрать SIM и eSIM для поездок.", cards: [
      ["Наш подход", "Показываем характеристики, цену и условия до оформления заказа. Наличие и итоговую стоимость сервер проверяет ещё раз при создании заказа."],
      ["Помощь", "Если сомневаетесь в совместимости устройства или способе активации, напишите менеджеру до оплаты."],
    ] },
    privacy: { title: "Политика конфиденциальности", description: "Как используются данные, необходимые для заказа.", cards: [
      ["Данные заказа", "Имя, email, контакт и адрес физической доставки используются для оформления, исполнения и поддержки заказа."],
      ["Ваши права", "Управление профилем, экспортом и удалением данных доступно в личном кабинете."],
    ] },
    terms: { title: "Условия использования", description: "Основные правила покупки в SIMKA.", cards: [
      ["Каталог", "Цена и доступность повторно проверяются при создании заказа. Условия тарифа зависят от оператора."],
      ["Заказ", "Заказ считается созданным после ответа сервера с уникальным номером. Реквизиты для оплаты через менеджера приходят отдельным письмом."],
    ] },
    returns: { title: "Возврат и отмена", description: "Порядок зависит от статуса и типа товара.", cards: [
      ["До оплаты", "Свяжитесь с менеджером и сообщите номер заказа, чтобы запросить отмену."],
      ["После оплаты", "Обратитесь в поддержку. Возможность возврата зависит от выдачи eSIM, активации и отправки физической SIM."],
    ] },
    cookies: { title: "Cookie Policy", description: "О локальном хранении и аналитике.", cards: [
      ["Корзина", "Выбранные товары сохраняются в браузере, чтобы они не пропали после перезагрузки страницы."],
      ["Личный кабинет", "Для авторизации используются необходимые технические cookie. Управлять настройками можно в браузере."],
    ] },
  };

  function renderHome() {
    const featured = state.products.filter(isAvailable).slice(0, 6);
    app.innerHTML = `<div class="hero-section"><section class="hero"><div><div class="eyebrow">Связь в путешествии</div><h1>Интернет в поездке<br><span>без роуминга</span></h1><p>Выберите страну, сравните eSIM и физические SIM по объёму интернета, сроку действия и цене.</p><div class="button-row"><a class="button" href="#/catalog">Найти тариф</a><a class="button-soft" href="#/countries">Выбрать страну</a></div></div><div class="hero-art" aria-hidden="true"><div class="sim-card"><div class="flag">🇹🇷</div><div class="card-copy"><small>Турция · eSIM</small><strong>20 ГБ</strong><small>Связь для поездки</small></div></div><div class="sim-card"><div class="flag">🇹🇭</div><div class="card-copy"><small>Таиланд · eSIM</small><strong>Безлимит</strong><small>Сразу на email</small></div></div></div></section></div><section class="section"><div class="eyebrow">Популярные направления</div><h2 class="section-title">Выберите свой тариф</h2><p class="section-intro">Актуальная цена и наличие загружаются из магазина. Итог повторно проверяется при оформлении.</p>${productGrid(featured)}<div class="button-row"><a class="button-soft" href="#/catalog">Все тарифы →</a></div></section>${state.categories.length ? `<section class="section"><div class="eyebrow">Категории</div><h2 class="section-title">Подборки SIMKA</h2><div class="grid">${state.categories.slice(0, 6).map(categoryTile).join("")}</div></section>` : ""}<section class="section"><div class="eyebrow">Как купить</div><h2 class="section-title">Три понятных шага</h2><div class="grid">${infoCard("1. Выберите тариф", "Сравните страну, оператора, объём интернета и срок.")}${infoCard("2. Оформите заказ", "Укажите email. Менеджер пришлёт реквизиты для оплаты.")}${infoCard("3. Получите SIM", "После подтверждения оплаты менеджер выдаст eSIM или отправит физическую SIM.")}</div></section>`;
  }

  function categoryTile(category) { return `<a class="tile" href="#/category/${encodeURIComponent(category.slug)}"><h3>${escape(category.name)}</h3><p>${escape(category.description || "Подборка тарифов SIMKA")}</p><small>${category.productIds?.length || 0} товаров →</small></a>`; }
  function countryTile(country) { return `<a class="tile" href="#/country/${encodeURIComponent(country.slug)}"><h3>${escape(country.flag || "🌍")} ${escape(country.name)}</h3><p>${escape(country.description || "Тарифы SIM и eSIM для поездки")}</p><small>Смотреть тарифы →</small></a>`; }

  function renderCatalog(searchMode = false) {
    const filters = state.filters;
    const countries = [...new Set(state.products.map((product) => product.country))].sort((a, b) => a.localeCompare(b, "ru"));
    const operators = [...new Set(state.products.map((product) => product.operator))].sort((a, b) => a.localeCompare(b, "ru"));
    const options = (values, selected) => values.map((value) => `<option value="${escape(value)}" ${selected === value ? "selected" : ""}>${escape(value)}</option>`).join("");
    const results = state.products.filter((product) => {
      const text = `${product.name} ${product.country} ${product.operator} ${product.sku} ${product.categoryIds?.join(" ")}`.toLocaleLowerCase("ru");
      const price = offer(product).price;
      return (!filters.q || text.includes(filters.q.toLocaleLowerCase("ru"))) && (!filters.country || product.country === filters.country) && (!filters.operator || product.operator === filters.operator) && (!filters.type || product.type === filters.type) && (!filters.availability || (filters.availability === "available" ? isAvailable(product) : !isAvailable(product))) && (!filters.maxPrice || price <= Number(filters.maxPrice));
    });
    if (filters.sort === "price-asc") results.sort((a, b) => offer(a).price - offer(b).price);
    if (filters.sort === "price-desc") results.sort((a, b) => offer(b).price - offer(a).price);
    app.innerHTML = `${heading(searchMode ? "Поиск" : "Каталог", searchMode ? "Найти тариф" : "Тарифы для поездок", "Сравните страну, оператора, тип SIM и цену.")}<form id="catalog-filters" class="filter-panel"><label>Поиск<input name="q" type="search" value="${escape(filters.q || "")}" placeholder="Название, страна, оператор или SKU"></label><label>Страна<select name="country"><option value="">Все страны</option>${options(countries, filters.country)}</select></label><label>Оператор<select name="operator"><option value="">Все операторы</option>${options(operators, filters.operator)}</select></label><label>Тип SIM<select name="type"><option value="">Все типы</option>${options(["eSIM", "SIM"], filters.type)}</select></label><label>Наличие<select name="availability"><option value="">Все товары</option><option value="available" ${filters.availability === "available" ? "selected" : ""}>В наличии</option><option value="unavailable" ${filters.availability === "unavailable" ? "selected" : ""}>Нет в наличии</option></select></label><label>Цена до<input name="maxPrice" type="number" min="0" value="${escape(filters.maxPrice || "")}" placeholder="Без ограничения"></label><label>Сортировка<select name="sort"><option value="">Популярные</option><option value="price-asc" ${filters.sort === "price-asc" ? "selected" : ""}>Сначала дешевле</option><option value="price-desc" ${filters.sort === "price-desc" ? "selected" : ""}>Сначала дороже</option></select></label><button class="button" type="submit">Показать</button></form><p class="result-count">Найдено тарифов: <strong>${results.length}</strong></p>${productGrid(results)}`;
  }

  function renderProduct(slug) {
    const product = state.products.find((item) => item.slug === slug);
    if (!product) { app.innerHTML = heading("Товар", "Тариф не найден", "Проверьте адрес или откройте каталог.") + `<a class="button" href="#/catalog">Каталог</a>`; return; }
    const current = offer(product);
    app.innerHTML = `<div class="breadcrumb"><a href="#/">Главная</a> / <a href="#/catalog">Каталог</a> / ${escape(product.country)}</div>${heading(`${product.flag || "🌍"} ${product.country} · ${product.operator}`, product.name, product.shortDescription || "Тариф для поездки")}<div class="detail-layout"><div class="detail-visual tone-${productTheme(product)}"><span class="flag" aria-hidden="true">${escape(product.flag || "🌍")}</span><h2>${escape(current.data)}</h2><p>${escape(current.days)} дней · ${escape(product.type)}</p></div><div class="detail-panel"><div class="price">${money(current.price, current.currency)}</div><p class="muted">Артикул: ${escape(current.variant?.sku || product.sku)}</p><ul class="detail-list"><li>Страна: ${escape(product.country)}</li><li>Оператор: ${escape(product.operator)}</li><li>Интернет: ${escape(current.data)}</li><li>Срок: ${escape(current.days)} дней</li>${product.calls ? `<li>Звонки: ${escape(product.calls)}</li>` : ""}${product.compatibility ? `<li>Совместимость: ${escape(product.compatibility)}</li>` : ""}</ul><button class="button" data-add="${product.id}" ${isAvailable(product) ? "" : "disabled"}>${isAvailable(product) ? "Добавить в корзину" : "Нет в наличии"}</button><p class="muted">Цена и наличие повторно проверяются при создании заказа.</p></div></div>${product.fullDescription ? `<section class="section"><h2 class="section-title">Описание</h2><p>${escape(product.fullDescription)}</p></section>` : ""}`;
  }

  function render() {
    const path = route().split("/").filter(Boolean);
    document.title = `${path.length ? path[0] === "product" ? state.products.find((p) => p.slug === path[1])?.name || "Тариф" : pages[path[0]]?.title || "SIMKA" : "SIMKA - SIM и eSIM для путешествий"} | SIMKA`;
    if (!path.length) renderHome();
    else if (path[0] === "catalog" || path[0] === "search") renderCatalog(path[0] === "search");
    else if (path[0] === "categories") app.innerHTML = heading("Категории", "Подборки тарифов", "Выберите категорию и посмотрите доступные тарифы.") + (state.categories.length ? `<div class="grid">${state.categories.map(categoryTile).join("")}</div>` : `<div class="empty">Категорий пока нет.</div>`);
    else if (path[0] === "category") { const category = state.categories.find((item) => item.slug === path[1]); app.innerHTML = category ? heading("Категория", category.name, category.description || "Тарифы SIMKA") + productGrid(state.products.filter((product) => category.productIds?.includes(product.id))) : heading("Категория", "Категория не найдена", "Откройте список категорий."); }
    else if (path[0] === "countries") app.innerHTML = heading("Страны", "Направления для поездки", "Выберите страну и сравните доступные SIM и eSIM.") + `<div class="grid">${state.countries.map(countryTile).join("")}</div>`;
    else if (path[0] === "country") { const country = state.countries.find((item) => item.slug === path[1]); app.innerHTML = country ? heading("Страна", `${country.flag || "🌍"} ${country.name}`, country.description || "Тарифы SIM и eSIM") + productGrid(state.products.filter((product) => product.countryId === country.id)) : heading("Страна", "Страна не найдена", "Откройте список стран."); }
    else if (path[0] === "product") renderProduct(path[1]);
    else if (pages[path[0]]) { const page = pages[path[0]]; app.innerHTML = heading("Информация", page.title, page.description) + `<div class="info-grid">${page.cards.map(([title, body]) => infoCard(title, body)).join("")}</div>${["terms", "privacy", "returns", "cookies"].includes(path[0]) ? `<p class="muted">Полный действующий текст документа: <a href="${API}/${path[0]}" target="_blank" rel="noopener noreferrer">открыть документ</a>.</p>` : ""}`; }
    else app.innerHTML = heading("SIMKA", "Страница не найдена", "Откройте каталог или вернитесь на главную.") + `<a class="button" href="#/catalog">Каталог</a>`;
    document.getElementById("content").focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }

  function addToCart(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product || !isAvailable(product)) return;
    const variant = availableVariant(product);
    if (product.variants?.length && !variant) return;
    const key = `${product.id}:${variant?.id || 0}`;
    const stock = variant?.stockQuantity ?? product.stockQuantity;
    const next = (state.cart[key] || 0) + 1;
    if (stock !== null && next > stock) return;
    state.cart[key] = next;
    persistCart();
    openCart();
  }

  function changeQuantity(key, delta) {
    const line = cartLines().find((item) => item.key === key);
    if (!line) return;
    const stock = line.variant?.stockQuantity ?? line.product.stockQuantity;
    const next = Math.max(0, line.quantity + delta);
    if (stock !== null && next > stock) return;
    if (next) state.cart[key] = next; else delete state.cart[key];
    persistCart(); renderCart();
  }

  function openCart() { overlay.hidden = false; document.body.style.overflow = "hidden"; renderCart(); document.getElementById("cart-close").focus(); }
  function closeCart() { overlay.hidden = true; document.body.style.overflow = ""; state.checkout = false; state.error = ""; document.getElementById("cart-button").focus(); }

  function renderCart() {
    const lines = cartLines();
    document.getElementById("cart-subtitle").textContent = lines.length ? `${lines.reduce((sum, line) => sum + line.quantity, 0)} товаров` : "Пока здесь пусто";
    if (state.receipt) { cartBody.innerHTML = `<div class="success"><div class="check">✓</div><strong>Заказ создан</strong><p>Номер заказа: <b>${escape(state.receipt.orderNumber)}</b></p><div class="notice">Реквизиты для оплаты придут на email, указанный при оформлении. Сохраните номер заказа.${state.receipt.customerNotified ? " Письмо-подтверждение отправлено." : " Если письмо-подтверждение не пришло, обратитесь в поддержку."}</div>${state.receipt.checkoutUrl ? `<p><a class="button" href="${escape(state.receipt.checkoutUrl)}">Перейти к оплате</a></p>` : ""}</div>`; return; }
    if (state.checkout) { renderCheckout(lines); return; }
    if (!lines.length) { cartBody.innerHTML = `<div class="empty">Добавьте подходящий тариф из каталога.</div><button class="button" data-close-cart>Выбрать тариф</button>`; return; }
    const currencies = new Set(lines.map((line) => line.currency));
    const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    cartBody.innerHTML = `${lines.map((line) => `<article class="cart-item"><div><strong>${escape(line.product.country)} · ${escape(line.variant?.name || line.product.data)}</strong><small>${escape(line.product.type)} · ${escape(line.variant?.sku || line.product.sku)}</small><div class="quantity"><button data-quantity="${escape(line.key)}" data-delta="-1" aria-label="Уменьшить количество">−</button><span>${line.quantity}</span><button data-quantity="${escape(line.key)}" data-delta="1" aria-label="Увеличить количество">+</button></div></div><div><strong>${money(line.price * line.quantity, line.currency)}</strong><button class="icon-button" data-remove="${escape(line.key)}" aria-label="Удалить товар">×</button></div></article>`).join("")}<div class="summary"><span>Стоимость товаров</span><span>${currencies.size === 1 ? money(total, lines[0].currency) : "Несколько валют"}</span></div>${currencies.size > 1 ? `<p class="error-text">Товары в разных валютах оформляются отдельными заказами.</p>` : `<button class="button" data-checkout>Перейти к оформлению</button>`}`;
  }

  function renderCheckout(lines) {
    if (!lines.length) { state.checkout = false; renderCart(); return; }
    const physical = [...new Map(lines.filter((line) => line.product.type === "SIM").map((line) => [line.product.id, line.product])).values()];
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const delivery = physical.reduce((sum, product) => sum + (product.deliveryOptions?.[0]?.cost ?? 0), 0);
    cartBody.innerHTML = `<button class="button-soft" data-back-cart>← Вернуться в корзину</button><h3>Оформление заказа</h3>${state.error ? `<p class="error-text" role="alert">${escape(state.error)}</p>` : ""}<form id="checkout-form" class="checkout"><label>Имя<input name="customerName" required minlength="2" maxlength="100" autocomplete="name"></label><label>Email для получения реквизитов<input name="customerEmail" type="email" required maxlength="254" autocomplete="email"><span class="hint">Менеджер отправит реквизиты для оплаты на этот адрес.</span></label><label>Telegram или телефон<input name="customerContact" maxlength="100" placeholder="@username"></label>${physical.length ? `<label>Адрес доставки физической SIM<input name="deliveryAddress" required maxlength="500" autocomplete="street-address" placeholder="Город, улица, дом, квартира"></label>${physical.map((product) => `<label>Доставка: ${escape(product.name)}<select name="delivery-${product.id}" required>${(product.deliveryOptions || []).map((option) => `<option value="${escape(option.id)}">${escape(option.label)}${option.cost === null ? " - стоимость уточнит менеджер" : ` - ${money(option.cost, option.currency)}`}</option>`).join("")}</select></label>`).join("")}` : ""}<label>Комментарий<input name="customerComment" maxlength="1000" placeholder="Необязательно"></label><div class="notice">Оплата по реквизитам через менеджера. После заказа реквизиты придут на указанный email.</div><div class="summary"><span>Итого${physical.some((product) => product.deliveryOptions?.[0]?.cost === null) ? " без уточняемой доставки" : ""}</span><span>${money(subtotal + delivery, lines[0].currency)}</span></div><button class="button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Создаём заказ..." : "Создать заказ"}</button><small class="muted">Оформляя заказ, вы соглашаетесь с <a href="#/terms">условиями</a> и <a href="#/privacy">политикой конфиденциальности</a>.</small></form>`;
  }

  async function submitOrder(form) {
    if (state.busy) return;
    const lines = cartLines();
    if (!lines.length) return;
    const data = new FormData(form);
    const physical = [...new Map(lines.filter((line) => line.product.type === "SIM").map((line) => [line.product.id, line.product])).values()];
    state.busy = true; state.error = ""; renderCheckout(lines);
    try {
      state.requestId ||= crypto.randomUUID();
      const response = await fetch(`${API}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        requestId: state.requestId,
        customerName: data.get("customerName"), customerEmail: data.get("customerEmail"), customerContact: data.get("customerContact") || "",
        deliveryAddress: data.get("deliveryAddress") || undefined, customerComment: data.get("customerComment") || "", paymentMethod: "manager",
        items: lines.map((line) => ({ productId: line.product.id, ...(line.variant ? { variantId: line.variant.id } : {}), quantity: line.quantity })),
        deliverySelections: physical.map((product) => ({ productId: product.id, optionId: data.get(`delivery-${product.id}`) })),
      }) });
      const payload = await response.json();
      if (!response.ok || !payload.order?.orderNumber) throw new Error(payload.error || "Не удалось создать заказ. Попробуйте ещё раз.");
      state.receipt = payload.order; state.cart = {}; state.checkout = false; state.requestId = null; persistCart();
    } catch (error) { state.error = error instanceof Error ? error.message : "Не удалось создать заказ. Попробуйте ещё раз."; }
    finally { state.busy = false; renderCart(); }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.add) addToCart(Number(button.dataset.add));
    if (button.dataset.quantity) changeQuantity(button.dataset.quantity, Number(button.dataset.delta));
    if (button.dataset.remove) { delete state.cart[button.dataset.remove]; persistCart(); renderCart(); }
    if (button.dataset.checkout !== undefined) { state.checkout = true; state.error = ""; renderCart(); }
    if (button.dataset.backCart !== undefined) { state.checkout = false; state.error = ""; renderCart(); }
    if (button.dataset.closeCart !== undefined) closeCart();
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "catalog-filters") { event.preventDefault(); state.filters = Object.fromEntries(new FormData(event.target).entries()); renderCatalog(route() === "/search"); }
    if (event.target.id === "checkout-form") { event.preventDefault(); void submitOrder(event.target); }
  });
  document.getElementById("cart-button").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeCart(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) closeCart(); });
  const menuButton = document.getElementById("menu-button");
  const mobileNav = document.getElementById("mobile-nav");
  menuButton.addEventListener("click", () => { mobileNav.hidden = !mobileNav.hidden; menuButton.setAttribute("aria-expanded", String(!mobileNav.hidden)); });
  mobileNav.addEventListener("click", (event) => { if (event.target.closest("a")) { mobileNav.hidden = true; menuButton.setAttribute("aria-expanded", "false"); } });
  window.addEventListener("hashchange", render);

  async function loadCatalog() {
    try {
      const response = await fetch(`${API}/api/pages/catalog`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Каталог временно недоступен");
      const payload = await response.json();
      state.products = Array.isArray(payload.products) ? payload.products : [];
      state.categories = Array.isArray(payload.categories) ? payload.categories : [];
      state.countries = Array.isArray(payload.countries) ? payload.countries : [];
      updateCartCount(); render();
    } catch {
      app.innerHTML = `<div class="error-panel"><h1>Не удалось загрузить тарифы</h1><p>Попробуйте обновить страницу. Если ошибка повторяется, откройте основной магазин.</p><button class="button" id="retry-catalog">Повторить</button> <a class="button-soft" href="${API}/">Открыть магазин</a></div>`;
      document.getElementById("retry-catalog").addEventListener("click", loadCatalog);
    }
  }
  void loadCatalog();
})();
