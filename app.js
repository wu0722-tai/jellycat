// =============================================
// Firebase Configuration
// =============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDocs,
  deleteDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyPLACEHOLDER",
  authDomain: "jellycat-proxy.firebaseapp.com",
  projectId: "jellycat-proxy",
  storageBucket: "jellycat-proxy.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:placeholder"
};

// App State
let app, auth, db;
let currentUser = null;
let settings = { quoteRate: 50, costRate: 41.5, depositRatio: 30 };
let buyers = [];
let orders = [];
let products = [];
let unsubscribers = [];

let editOrderId = null;
let editBuyerId = null;
let editProductId = null;
let viewBuyerId = null;
let selectedBuyerId = null;
let orderItems = [];

let orderFilter = 'all';
let orderSearch = '';
let buyerSearch = '';
let productSearch = '';

// Init Firebase
const isPlaceholderConfig = firebaseConfig.apiKey === 'AIzaSyPLACEHOLDER';
const isFileProtocol = location.protocol === 'file:';

if (!isPlaceholderConfig && !isFileProtocol) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    onAuthStateChanged(auth, user => {
      if (user) { currentUser = user; showApp(); loadData(); }
      else { currentUser = null; showLogin(); cleanup(); }
    });
  } catch (e) { console.warn('Firebase init failed:', e.message); }
}

// Auth
const loginBtn = document.getElementById('google-login-btn');
if (isPlaceholderConfig || isFileProtocol) {
  loginBtn.innerHTML = '🐰 直接進入（Demo 模式）';
  loginBtn.addEventListener('click', () => showDemoMode());
} else {
  loginBtn.addEventListener('click', async () => {
    if (!auth) { showDemoMode(); return; }
    loginBtn.disabled = true;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      showToast('登入失敗，進入 Demo 模式'); showDemoMode();
    } finally { loginBtn.disabled = false; }
  });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (confirm('確定要登出嗎？')) { if (auth) await signOut(auth); else showLogin(); }
});

function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
}
function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
}
function showDemoMode() {
  currentUser = { uid: 'demo', displayName: 'Demo User' };
  loadLocalData(); showApp();
}

// Data: Firestore
function getUserPath(col) { return collection(db, 'users', currentUser.uid, col); }

async function loadData() {
  try {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'settings'));
    snap.forEach(d => { if (d.id === 'main') Object.assign(settings, d.data()); });
  } catch {}
  if (settings.rate && !settings.quoteRate) settings.quoteRate = settings.rate;
  if (!settings.quoteRate) settings.quoteRate = 50;
  if (!settings.costRate) settings.costRate = 41.5;
  updateRateDisplay();
  unsubscribers.push(onSnapshot(query(getUserPath('buyers'), orderBy('name')), snap => {
    buyers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBuyers(); renderDashboard();
  }));
  unsubscribers.push(onSnapshot(query(getUserPath('orders'), orderBy('createdAt', 'desc')), snap => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(); renderDashboard(); renderPending();
  }));
  unsubscribers.push(onSnapshot(query(getUserPath('products'), orderBy('name')), snap => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProducts(); renderProductPicker();
  }));
}

async function saveBuyer(data) {
  const id = data.id || Date.now().toString();
  if (db) { await setDoc(doc(db, 'users', currentUser.uid, 'buyers', id), { ...data, id }); }
  else {
    const idx = buyers.findIndex(b => b.id === id);
    if (idx >= 0) buyers[idx] = { ...data, id }; else buyers.push({ ...data, id });
    saveLocalData(); renderBuyers(); renderDashboard();
  }
  return id;
}
async function deleteBuyer(id) {
  if (db) await deleteDoc(doc(db, 'users', currentUser.uid, 'buyers', id));
  else { buyers = buyers.filter(b => b.id !== id); saveLocalData(); renderBuyers(); renderDashboard(); }
}

async function saveOrder(data) {
  const id = data.id || Date.now().toString();
  if (!data.createdAt) data.createdAt = Date.now();
  if (db) { await setDoc(doc(db, 'users', currentUser.uid, 'orders', id), { ...data, id }); }
  else {
    const idx = orders.findIndex(o => o.id === id);
    if (idx >= 0) orders[idx] = { ...data, id }; else orders.unshift({ ...data, id });
    saveLocalData(); renderOrders(); renderDashboard(); renderPending();
  }
}
async function deleteOrder(id) {
  if (db) await deleteDoc(doc(db, 'users', currentUser.uid, 'orders', id));
  else { orders = orders.filter(o => o.id !== id); saveLocalData(); renderOrders(); renderDashboard(); renderPending(); }
}

async function saveProduct(data) {
  const id = data.id || Date.now().toString();
  if (!data.createdAt) data.createdAt = Date.now();
  if (db) { await setDoc(doc(db, 'users', currentUser.uid, 'products', id), { ...data, id }); }
  else {
    const idx = products.findIndex(p => p.id === id);
    if (idx >= 0) products[idx] = { ...data, id }; else products.push({ ...data, id });
    saveLocalData(); renderProducts(); renderProductPicker();
  }
}
async function deleteProduct(id) {
  if (db) await deleteDoc(doc(db, 'users', currentUser.uid, 'products', id));
  else { products = products.filter(p => p.id !== id); saveLocalData(); renderProducts(); }
}

async function saveSettings() {
  if (db) await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), settings);
  else saveLocalData();
}

function loadLocalData() {
  try {
    const raw = localStorage.getItem('jc_data');
    if (raw) {
      const d = JSON.parse(raw);
      buyers = d.buyers || []; orders = d.orders || []; products = d.products || [];
      Object.assign(settings, d.settings || {});
    }
  } catch {}
  if (settings.rate && !settings.quoteRate) settings.quoteRate = settings.rate;
  if (!settings.quoteRate) settings.quoteRate = 50;
  if (!settings.costRate) settings.costRate = 41.5;
  updateRateDisplay(); renderAll();
}
function saveLocalData() {
  localStorage.setItem('jc_data', JSON.stringify({ buyers, orders, products, settings }));
}
function cleanup() {
  unsubscribers.forEach(u => u && u()); unsubscribers = [];
  buyers = []; orders = []; products = [];
}

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
}
window.switchTab = switchTab;

// Settings
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('quote-rate-input').value = settings.quoteRate || 50;
  document.getElementById('cost-rate-input').value = settings.costRate || 41.5;
  document.getElementById('deposit-ratio-input').value = settings.depositRatio || 30;
  updateSettingsDiffHint();
  openModal('settings-modal');
});

function updateSettingsDiffHint() {
  const q = parseFloat(document.getElementById('quote-rate-input').value) || 50;
  const c = parseFloat(document.getElementById('cost-rate-input').value) || 41.5;
  const diff = (q - c).toFixed(1);
  const elem = document.getElementById('rate-diff-hint');
  if (elem) {
    elem.textContent = `${diff >= 0 ? '+' : ''}NT$${diff} / £`;
    elem.style.color = diff >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

['quote-rate-input', 'cost-rate-input'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateSettingsDiffHint);
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  settings.quoteRate = parseFloat(document.getElementById('quote-rate-input').value) || 50;
  settings.costRate = parseFloat(document.getElementById('cost-rate-input').value) || 41.5;
  settings.depositRatio = parseInt(document.getElementById('deposit-ratio-input').value) || 30;
  await saveSettings();
  updateRateDisplay();
  renderAll();
  closeModal('settings-modal');
  showToast('匯率設定已儲存 ✅');
});

document.getElementById('fetch-rate-btn').addEventListener('click', async () => {
  const btn = document.getElementById('fetch-rate-btn');
  btn.textContent = '抓取中…';
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/GBP');
    const data = await resp.json();
    const rate = data.rates && data.rates.TWD;
    if (rate) {
      const r = Math.round(rate * 10) / 10;
      document.getElementById('cost-rate-input').value = r;
      document.getElementById('cost-rate-hint').textContent = `即時市場匯率：1 GBP = NT$${r}`;
      updateSettingsDiffHint();
      showToast(`已抓取即時採購成本匯率 £1 = NT$${r} 🎉`);
    } else throw new Error('no rate');
  } catch {
    showToast('抓取失敗，請手動輸入');
  }
  btn.textContent = '抓即時匯率';
});

function updateRateDisplay() {
  const q = settings.quoteRate || 50;
  const c = settings.costRate || 41.5;
  const diff = (q - c).toFixed(1);
  const disp = document.getElementById('rate-display');
  if (disp) {
    disp.innerHTML = `💷 代購 £1=NT$${q} · 成本 ${c} <span style="color:var(--green);font-weight:800">(+NT$${diff}/£)</span>`;
  }
}

// Helpers
function getOrderRevenue(o) {
  if (o.items && Array.isArray(o.items)) return o.items.reduce((s, i) => s + (i.twd||0)*(i.qty||1), 0);
  return (o.twd||0)*(o.qty||1);
}
function getOrderCost(o) {
  const costRate = settings.costRate || 41.5;
  if (o.items && Array.isArray(o.items)) return o.items.reduce((s, i) => s + (i.gbp||0)*costRate*(i.qty||1), 0);
  return (o.gbp||0)*costRate*(o.qty||1);
}
function getOrderGbp(o) {
  if (o.items && Array.isArray(o.items)) return o.items.reduce((s, i) => s + (i.gbp||0)*(i.qty||1), 0);
  return (o.gbp||0)*(o.qty||1);
}

// Dashboard
function renderDashboard() {
  const totalRevenue = orders.reduce((s, o) => s + getOrderRevenue(o), 0);
  const totalCost = orders.reduce((s, o) => s + getOrderCost(o), 0);
  const totalPaid = orders.reduce((s, o) => {
    if (o.payment === 'paid') return s + getOrderRevenue(o);
    if (o.payment === 'deposit') return s + (parseFloat(o.deposit)||0);
    return s;
  }, 0);
  document.getElementById('stat-revenue').textContent = 'NT$' + totalRevenue.toLocaleString();
  document.getElementById('stat-profit').textContent = 'NT$' + Math.round(totalRevenue-totalCost).toLocaleString();
  document.getElementById('stat-unpaid').textContent = 'NT$' + Math.round(totalRevenue-totalPaid).toLocaleString();
  document.getElementById('stat-orders').textContent = orders.length;

  const pC = orders.filter(o => o.payment==='paid').length;
  const dC = orders.filter(o => o.payment==='deposit').length;
  const uC = orders.filter(o => o.payment==='unpaid'||!o.payment).length;
  const tot = orders.length||1;
  document.getElementById('bar-paid').style.width = (pC/tot*100)+'%';
  document.getElementById('bar-deposit').style.width = (dC/tot*100)+'%';
  document.getElementById('bar-unpaid').style.width = (uC/tot*100)+'%';
  document.getElementById('count-paid').textContent = pC;
  document.getElementById('count-deposit').textContent = dC;
  document.getElementById('count-unpaid').textContent = uC;

  document.getElementById('status-pending').textContent = orders.filter(o => (o.status||'pending')==='pending').length;
  document.getElementById('status-ordered').textContent = orders.filter(o => o.status==='ordered').length;
  document.getElementById('status-arrived').textContent = orders.filter(o => o.status==='arrived').length;
  document.getElementById('status-shipped').textContent = orders.filter(o => o.status==='shipped').length;

  const recent = orders.slice(0,5);
  const rList = document.getElementById('recent-orders-list');
  if (!recent.length) { rList.innerHTML = '<div class="empty-hint">尚無訂單</div>'; return; }
  rList.innerHTML = recent.map(o => {
    const buyer = buyers.find(b => b.id===o.buyerId);
    const rev = getOrderRevenue(o);
    const firstItem = o.items&&o.items.length>0 ? o.items[0].name : (o.product||'');
    const extra = o.items&&o.items.length>1 ? ` +${o.items.length-1}` : '';
    return `<div class="compact-item" onclick="openEditOrder('${o.id}')">
      <div class="compact-left">
        <div class="compact-name">${escapeHtml(firstItem)}${extra}</div>
        <div class="compact-sub">${escapeHtml(buyer?.name||'未知買家')} · £${getOrderGbp(o).toFixed(2)}</div>
      </div>
      <div class="compact-right">
        <div class="compact-price" style="color:var(--purple-light)">NT$${rev.toLocaleString()}</div>
        <span class="compact-badge badge ${o.payment||'unpaid'}">${paymentLabel(o.payment)}</span>
      </div>
    </div>`;
  }).join('');
}

// Orders
function renderOrders() {
  const list = document.getElementById('orders-list');
  let filtered = orders.filter(o => {
    if (orderFilter!=='all' && (o.status||'pending')!==orderFilter) return false;
    if (orderSearch) {
      const buyer = buyers.find(b => b.id===o.buyerId);
      const q = orderSearch.toLowerCase();
      const names = o.items ? o.items.map(i=>i.name||'').join(' ') : (o.product||'');
      return names.toLowerCase().includes(q) || (buyer?.name||'').toLowerCase().includes(q);
    }
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>${orders.length===0?'還沒有訂單，點右上角新增！':'沒有符合的訂單'}</p></div>`;
    return;
  }
  const costRate = settings.costRate || 41.5;
  list.innerHTML = filtered.map(o => {
    const buyer = buyers.find(b => b.id===o.buyerId);
    const cost = getOrderCost(o), rev = getOrderRevenue(o), profit = rev-cost;
    const pColor = profit>=0 ? 'var(--green)' : 'var(--red)';
    const tags = o.items&&o.items.length>0
      ? o.items.map(i=>`<span class="order-item-tag">${escapeHtml(i.name)}${i.variant?` (${escapeHtml(i.variant)})`:''} ×${i.qty||1}</span>`).join('')
      : `<span class="order-item-tag">${escapeHtml(o.product||'')} ×${o.qty||1}</span>`;
    return `<div class="order-card s-${o.status||'pending'}" onclick="openEditOrder('${o.id}')">
      <div class="order-row1"><div class="order-product">${tags}</div><div class="order-price">NT$${rev.toLocaleString()}</div></div>
      <div class="order-row2">
        <div class="order-buyer">👤 ${escapeHtml(buyer?.name||'未知買家')}</div>
        <div class="order-badges"><span class="badge ${o.status||'pending'}">${statusLabel(o.status)}</span><span class="badge ${o.payment||'unpaid'}">${paymentLabel(o.payment)}</span></div>
      </div>
      <div class="order-row3" style="display:flex;justify-content:space-between">
        <span class="order-gbp">£${getOrderGbp(o).toFixed(2)} → 採購成本 NT$${Math.round(cost).toLocaleString()} (£1=NT$${costRate})</span>
        <span style="color:${pColor};font-weight:800;font-size:11px">利潤 NT$${Math.round(profit).toLocaleString()}</span>
      </div>
      ${o.deposit&&o.payment==='deposit'?`<div class="order-row3" style="color:var(--yellow)">💛 已付訂金 NT$${parseFloat(o.deposit).toLocaleString()}</div>`:''}
      ${o.notes?`<div class="order-row3" style="margin-top:4px">📝 ${escapeHtml(o.notes)}</div>`:''}
    </div>`;
  }).join('');
}

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active'); orderFilter = chip.dataset.filter; renderOrders();
  });
});
document.getElementById('order-search').addEventListener('input', e => { orderSearch=e.target.value; renderOrders(); });

// Products Tab
function renderProducts() {
  const list = document.getElementById('products-list');
  const q = productSearch.toLowerCase();
  let filtered = products.filter(p => !q||(p.name||'').toLowerCase().includes(q)||(p.variant||'').toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🏪</div><p>${products.length===0?'還沒有商品，點右上角新增！':'沒有符合的商品'}</p></div>`;
    return;
  }
  const costRate = settings.costRate || 41.5;
  list.innerHTML = filtered.map(p => {
    const cost=(p.gbp||0)*costRate, profit=(p.twd||0)-cost;
    const pColor = profit>=0?'var(--green)':'var(--red)';
    return `<div class="product-card" onclick="openEditProduct('${p.id}')">
      <div class="product-card-left">
        <div class="product-name">${escapeHtml(p.name||'')}${p.variant?` <span class="product-variant">${escapeHtml(p.variant)}</span>`:''}</div>
        <div class="product-price-row">
          <span class="product-gbp">£${p.gbp||0}</span>
          <span class="product-arrow">→ 售價</span>
          <span class="product-twd">NT$${(p.twd||0).toLocaleString()}</span>
        </div>
        <div class="product-meta">成本 NT$${Math.round(cost).toLocaleString()} (£1=NT$${costRate}) · <span style="color:${pColor};font-weight:800">利潤 NT$${Math.round(profit).toLocaleString()}</span></div>
        ${p.notes?`<div class="product-notes">📝 ${escapeHtml(p.notes)}</div>`:''}
      </div>
      <button class="add-to-order-btn" onclick="event.stopPropagation();quickAddToNewOrder('${p.id}')">＋ 加入代購單</button>
    </div>`;
  }).join('');
}

document.getElementById('product-search').addEventListener('input', e => { productSearch=e.target.value; renderProducts(); });
document.getElementById('add-product-btn').addEventListener('click', openAddProduct);

function openAddProduct() {
  editProductId = null;
  document.getElementById('product-modal-title').textContent = '🏪 新增商品';
  ['product-name','product-variant','product-gbp','product-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('delete-product-btn').style.display = 'none';
  updateProductHints();
  openModal('product-modal');
}

function openEditProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  editProductId = id;
  document.getElementById('product-modal-title').textContent = '✏️ 編輯商品';
  document.getElementById('product-name').value = p.name || '';
  document.getElementById('product-variant').value = p.variant || '';
  document.getElementById('product-gbp').value = p.gbp || '';
  document.getElementById('product-notes').value = p.notes || '';
  document.getElementById('delete-product-btn').style.display = 'block';
  updateProductHints();
  openModal('product-modal');
}
window.openEditProduct = openEditProduct;

function updateProductHints() {
  const gbp = parseFloat(document.getElementById('product-gbp').value) || 0;
  const costRate = settings.costRate || 41.5;
  const quoteRate = settings.quoteRate || 50;
  const twd = Math.round(gbp * quoteRate);
  const cost = gbp * costRate;
  const profit = twd - cost;
  const diff = (quoteRate - costRate).toFixed(1);

  const twdElem = document.getElementById('product-twd-calc');
  if (twdElem) twdElem.textContent = `NT$${twd.toLocaleString()} (£${gbp} × ${quoteRate})`;

  const costElem = document.getElementById('product-cost-calc');
  if (costElem) costElem.textContent = `NT$${Math.round(cost).toLocaleString()} (£1=NT$${costRate})`;

  const profitElem = document.getElementById('product-profit-calc');
  if (profitElem) {
    profitElem.textContent = `${profit >= 0 ? '+' : ''}NT$${Math.round(profit).toLocaleString()} (每 £ 賺 NT$${diff})`;
    profitElem.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

document.getElementById('product-gbp').addEventListener('input', updateProductHints);

document.getElementById('save-product-btn').addEventListener('click', async () => {
  const name = document.getElementById('product-name').value.trim();
  const gbp = parseFloat(document.getElementById('product-gbp').value);
  if (!name) { showToast('請填寫商品名稱 🏷️'); return; }
  if (!gbp || gbp <= 0) { showToast('請填寫英鎊標價 💷'); return; }

  const quoteRate = settings.quoteRate || 50;
  const twd = Math.round(gbp * quoteRate);

  const data = {
    id: editProductId || Date.now().toString(),
    name,
    variant: document.getElementById('product-variant').value.trim(),
    gbp,
    twd,
    notes: document.getElementById('product-notes').value.trim(),
    createdAt: editProductId ? (products.find(p => p.id === editProductId)?.createdAt || Date.now()) : Date.now()
  };
  await saveProduct(data);
  closeModal('product-modal');
  showToast(editProductId ? '商品已更新 ✅' : '商品已新增 ✅');
});

document.getElementById('delete-product-btn').addEventListener('click', async () => {
  if (!editProductId || !confirm('確定要刪除此商品？')) return;
  await deleteProduct(editProductId);
  closeModal('product-modal');
  showToast('商品已刪除');
});

function quickAddToNewOrder(productId) {
  openAddOrder();
  addProductToOrder(productId);
  switchTab('orders');
  openModal('order-modal');
}
window.quickAddToNewOrder = quickAddToNewOrder;

// Order Modal
document.getElementById('add-order-btn').addEventListener('click',()=>openAddOrder());

function openAddOrder() {
  editOrderId=null; selectedBuyerId=null; orderItems=[];
  document.getElementById('order-modal-title').textContent='📦 新增代購單';
  document.getElementById('order-phone').value='';
  document.getElementById('buyer-autofill-card').style.display='none';
  document.getElementById('buyer-new-fields').style.display='none';
  document.getElementById('order-new-buyer-name').value='';
  document.getElementById('order-new-buyer-contact').value='';
  document.getElementById('order-new-buyer-address').value='';
  document.getElementById('order-quick-paste').value='';
  const fb = document.getElementById('smart-parse-feedback');
  if (fb) { fb.style.display='none'; fb.innerHTML=''; }
  const ps=document.getElementById('phone-suggestions');
  ps.innerHTML=''; ps.style.display='none';
  document.getElementById('product-picker-search').value='';
  document.getElementById('order-status').value='pending';
  document.getElementById('order-payment').value='unpaid';
  document.getElementById('order-deposit').value='';
  document.getElementById('order-notes').value='';
  document.getElementById('deposit-amount-group').style.display='none';
  document.getElementById('delete-order-btn').style.display='none';
  document.getElementById('save-order-btn').textContent='新增代購單';
  renderOrderItems(); renderProductPicker(); openModal('order-modal');
}

function openEditOrder(id) {
  const o=orders.find(x=>x.id===id); if(!o) return;
  editOrderId=id; selectedBuyerId=o.buyerId||null;
  if(o.items&&Array.isArray(o.items)&&o.items.length>0) orderItems=o.items.map(i=>({...i}));
  else orderItems=[{productId:o.productId||null,name:o.product||'',variant:o.variant||'',gbp:o.gbp||0,twd:o.twd||0,qty:o.qty||1}];
  document.getElementById('order-modal-title').textContent='✏️ 編輯代購單';
  const buyer=buyers.find(b=>b.id===o.buyerId);
  if(buyer){document.getElementById('order-phone').value=buyer.phone||'';showAutofillCard(buyer);}
  else{document.getElementById('order-phone').value='';document.getElementById('buyer-autofill-card').style.display='none';document.getElementById('buyer-new-fields').style.display='none';}
  document.getElementById('order-quick-paste').value='';
  const fb = document.getElementById('smart-parse-feedback');
  if (fb) { fb.style.display='none'; fb.innerHTML=''; }
  const ps=document.getElementById('phone-suggestions'); ps.innerHTML=''; ps.style.display='none';
  document.getElementById('product-picker-search').value='';
  document.getElementById('order-status').value=o.status||'pending';
  document.getElementById('order-payment').value=o.payment||'unpaid';
  document.getElementById('order-deposit').value=o.deposit||'';
  document.getElementById('order-notes').value=o.notes||'';
  document.getElementById('deposit-amount-group').style.display=o.payment==='deposit'?'block':'none';
  document.getElementById('delete-order-btn').style.display='block';
  document.getElementById('save-order-btn').textContent='儲存代購單';
  renderOrderItems(); renderProductPicker(); openModal('order-modal');
}
window.openEditOrder=openEditOrder;

// =============================================
// Smart Text Parser & Fuzzy Product Matching
// =============================================
document.getElementById('smart-parse-btn').addEventListener('click', handleSmartParse);

function handleSmartParse() {
  const raw = document.getElementById('order-quick-paste').value.trim();
  const feedback = document.getElementById('smart-parse-feedback');
  if (!raw) {
    showToast('請先貼上買家資訊文字 📋');
    feedback.style.display = 'none';
    return;
  }

  const parsed = parseOrderText(raw);
  const messages = [];

  // 1. Phone & Buyer
  if (parsed.phone) {
    document.getElementById('order-phone').value = parsed.phone;
    const existingBuyer = buyers.find(b => b.phone === parsed.phone);
    if (existingBuyer) {
      selectBuyerFromPhone(existingBuyer);
      messages.push(`👤 已自動辨識老客戶：<strong>${escapeHtml(existingBuyer.name)}</strong>`);
    } else {
      selectedBuyerId = null;
      document.getElementById('buyer-autofill-card').style.display = 'none';
      document.getElementById('buyer-new-fields').style.display = 'block';
      if (parsed.name) {
        document.getElementById('order-new-buyer-name').value = parsed.name;
      }
      if (parsed.address) {
        document.getElementById('order-new-buyer-address').value = parsed.address;
      }
      messages.push(`👤 已填入新買家：<strong>${escapeHtml(parsed.name || '待輸入姓名')}</strong>（${escapeHtml(parsed.phone)}）`);
    }
  } else if (parsed.name) {
    document.getElementById('buyer-new-fields').style.display = 'block';
    document.getElementById('order-new-buyer-name').value = parsed.name;
    if (parsed.address) document.getElementById('order-new-buyer-address').value = parsed.address;
    messages.push(`👤 已填入姓名：<strong>${escapeHtml(parsed.name)}</strong>（請補填電話）`);
  }

  if (parsed.address && !selectedBuyerId) {
    document.getElementById('order-new-buyer-address').value = parsed.address;
    messages.push(`📍 門市 / 地址：${escapeHtml(parsed.address)}`);
  }

  // 2. Products Fuzzy Matching
  let matchedCount = 0;
  let unmatchedList = [];

  parsed.items.forEach(item => {
    if (item.matched) {
      const p = item.matched;
      const quoteRate = settings.quoteRate || 50;
      const itemTwd = p.twd || Math.round((p.gbp || 0) * quoteRate);
      
      const existing = orderItems.find(i => i.productId === p.id);
      if (existing) {
        existing.qty = (existing.qty || 1) + item.qty;
      } else {
        orderItems.push({
          productId: p.id,
          name: p.name || '',
          variant: p.variant || '',
          gbp: p.gbp || 0,
          twd: itemTwd,
          qty: item.qty
        });
      }
      matchedCount += item.qty;
      messages.push(`🛍️ 成功匹配商品：<strong>${escapeHtml(p.name)}</strong>${p.variant ? ` (${escapeHtml(p.variant)})` : ''} ×${item.qty}`);
    } else {
      unmatchedList.push(item.rawText);
    }
  });

  renderOrderItems();

  if (unmatchedList.length > 0) {
    messages.push(`⚠️ 未能自動匹配的品項（請由下方商品庫手動選取）：${unmatchedList.map(u => `<code>${escapeHtml(u)}</code>`).join('、')}`);
  }

  if (messages.length > 0) {
    feedback.style.display = 'block';
    feedback.className = `smart-parse-feedback ${unmatchedList.length > 0 ? 'warning' : 'success'}`;
    feedback.innerHTML = messages.join('<br>');
    showToast(matchedCount > 0 ? '✨ 資訊與商品已自動帶入！' : '買家資訊已解析');
  } else {
    feedback.style.display = 'block';
    feedback.className = 'smart-parse-feedback warning';
    feedback.textContent = '未能成功識別格式，請檢查文字內容。';
  }
}

function parseOrderText(text) {
  const result = { name: '', phone: '', address: '', items: [] };
  if (!text) return result;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let inProductSection = false;
  let productLines = [];

  for (let line of lines) {
    // Name
    const nameMatch = line.match(/(?:姓名|名字|買家|收件人|稱呼)\s*[:：]\s*(.+)/i);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      inProductSection = false;
      continue;
    }

    // Phone
    const phoneMatch = line.match(/(?:電話|手機|聯絡電話|連絡電話|行動電話|tel|phone)\s*[:：]\s*([0-9\-+ ]+)/i) 
      || line.match(/(09\d{2}[-\s]?\d{3}[-\s]?\d{3})/);
    if (phoneMatch) {
      result.phone = phoneMatch[1].replace(/[\s\-]/g, '').trim();
      inProductSection = false;
      continue;
    }

    // Store / Address
    const addrMatch = line.match(/(?:賣貨便門市|賣貨便|7-11門市|全家門市|門市名稱|門市|超商門市|取件門市|收件門市|收件地址|收貨地址|地址|住址)\s*[:：]\s*(.+)/i);
    if (addrMatch) {
      result.address = addrMatch[1].trim();
      inProductSection = false;
      continue;
    }

    // Product Header
    const prodSectionMatch = line.match(/(?:訂購商品|購買商品|商品明細|商品名稱|訂單品項|商品|品項)\s*[:：]\s*(.*)/i);
    if (prodSectionMatch) {
      inProductSection = true;
      const rest = prodSectionMatch[1].trim();
      if (rest) productLines.push(rest);
      continue;
    }

    if (inProductSection) {
      productLines.push(line);
    }
  }

  // Fallback: if no explicit product header, check remaining lines
  if (productLines.length === 0) {
    for (let line of lines) {
      if (!line.match(/(?:姓名|名字|買家|電話|手機|門市|地址|收件)/i)) {
        productLines.push(line);
      }
    }
  }

  // Split product lines by commas or semicolons
  const segments = [];
  productLines.forEach(pl => {
    pl.split(/[,，;；、]/).forEach(s => {
      const trimmed = s.trim();
      if (trimmed) segments.push(trimmed);
    });
  });

  segments.forEach(seg => {
    let qty = 1;
    let clean = seg;

    // Pattern: *2, x2, ×2, X2
    const qtyMatch1 = clean.match(/[*xX×]\s*(\d+)/);
    if (qtyMatch1) {
      qty = parseInt(qtyMatch1[1], 10) || 1;
      clean = clean.replace(qtyMatch1[0], '').trim();
    } else {
      // Pattern: 2隻, 2個, 2件, 2入
      const qtyMatch2 = clean.match(/(\d+)\s*(?:個|隻|只|件|本|入|條|組|盒|包|顆)/);
      if (qtyMatch2) {
        qty = parseInt(qtyMatch2[1], 10) || 1;
        clean = clean.replace(qtyMatch2[0], '').trim();
      } else {
        // Pattern: trailing number e.g. "拿鐵兔 2"
        const qtyMatch3 = clean.match(/\s+(\d+)$/);
        if (qtyMatch3) {
          qty = parseInt(qtyMatch3[1], 10) || 1;
          clean = clean.replace(qtyMatch3[0], '').trim();
        }
      }
    }

    if (clean) {
      const matchedProd = fuzzyMatchProduct(clean, products);
      result.items.push({
        rawText: seg,
        query: clean,
        qty: qty,
        matched: matchedProd
      });
    }
  });

  return result;
}

function fuzzyMatchProduct(query, list) {
  if (!query || !list.length) return null;
  const q = query.toLowerCase().replace(/[\s\-_]/g, '');

  // 1. Direct exact or substring containment match
  for (const p of list) {
    const fullName = `${p.name || ''}${p.variant || ''}`.toLowerCase().replace(/[\s\-_]/g, '');
    const cleanName = (p.name || '').toLowerCase().replace(/[\s\-_]/g, '');
    if (fullName === q || cleanName === q) return p;
    if (fullName.includes(q) || q.includes(cleanName)) return p;
  }

  // 2. Character & keyword overlap scoring
  let best = null;
  let maxScore = 0;

  for (const p of list) {
    const fullName = `${p.name || ''} ${p.variant || ''}`.toLowerCase();
    const qTokens = extractTokens(query);
    if (!qTokens.length) continue;

    let hits = 0;
    qTokens.forEach(token => {
      if (fullName.includes(token)) hits++;
    });

    const score = hits / qTokens.length;
    if (score > maxScore && score >= 0.35) {
      maxScore = score;
      best = p;
    }
  }

  return best;
}

function extractTokens(str) {
  const words = str.match(/[a-zA-Z0-9]+/g) || [];
  const chineseChars = str.match(/[\u4e00-\u9fa5]/g) || [];
  return [...words.map(w => w.toLowerCase()), ...chineseChars];
}

// Phone Autocomplete
const phoneInput=document.getElementById('order-phone');
const phoneSugg=document.getElementById('phone-suggestions');

phoneInput.addEventListener('input',()=>{
  const val=phoneInput.value.trim();
  if(!val){
    phoneSugg.style.display='none'; phoneSugg.innerHTML='';
    document.getElementById('buyer-autofill-card').style.display='none';
    document.getElementById('buyer-new-fields').style.display='none';
    selectedBuyerId=null; return;
  }
  const matches=buyers.filter(b=>(b.phone||'').includes(val));
  if(matches.length>0){
    phoneSugg.innerHTML=matches.slice(0,5).map(b=>
      `<div class="phone-suggestion-item" data-id="${b.id}">
        <span class="suggestion-avatar">${(b.name||'?')[0].toUpperCase()}</span>
        <span class="suggestion-name">${escapeHtml(b.name)}</span>
        <span class="suggestion-phone">${escapeHtml(b.phone||'')}</span>
      </div>`).join('');
    phoneSugg.style.display='block';
    const exact=matches.find(b=>b.phone===val);
    if(exact) selectBuyerFromPhone(exact);
  } else {
    phoneSugg.style.display='none'; phoneSugg.innerHTML='';
    if(val.length>=4){
      document.getElementById('buyer-autofill-card').style.display='none';
      document.getElementById('buyer-new-fields').style.display='block';
      selectedBuyerId=null;
    }
  }
});

phoneSugg.addEventListener('click',e=>{
  const item=e.target.closest('.phone-suggestion-item'); if(!item) return;
  const buyer=buyers.find(b=>b.id===item.dataset.id);
  if(buyer){phoneInput.value=buyer.phone||'';selectBuyerFromPhone(buyer);}
  phoneSugg.style.display='none';
});

function selectBuyerFromPhone(buyer){
  selectedBuyerId=buyer.id; showAutofillCard(buyer);
  document.getElementById('buyer-new-fields').style.display='none';
  phoneSugg.style.display='none';
}
function showAutofillCard(buyer){
  document.getElementById('buyer-autofill-card').style.display='block';
  document.getElementById('autofill-avatar').textContent=(buyer.name||'?')[0].toUpperCase();
  document.getElementById('autofill-name').textContent=buyer.name||'—';
  document.getElementById('autofill-contact').textContent=buyer.contact||buyer.phone||'—';
  document.getElementById('autofill-address').textContent=buyer.address||'—';
}
document.getElementById('autofill-clear-btn').addEventListener('click',()=>{
  selectedBuyerId=null;
  document.getElementById('buyer-autofill-card').style.display='none';
  document.getElementById('buyer-new-fields').style.display='none';
  document.getElementById('order-phone').value='';
  phoneSugg.style.display='none';
});

// Product Picker & Order Items
document.getElementById('product-picker-search').addEventListener('input', () => {
  renderProductPicker();
});

function renderProductPicker() {
  const container = document.getElementById('product-picker-list');
  if (!container) return;
  const q = (document.getElementById('product-picker-search').value || '').trim().toLowerCase();
  let list = products;
  if (q) {
    list = products.filter(p => 
      (p.name || '').toLowerCase().includes(q) || 
      (p.variant || '').toLowerCase().includes(q)
    );
  }
  if (list.length === 0) {
    container.innerHTML = `
      <div class="product-picker-empty" style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px">
        ${products.length === 0 ? '商品庫目前沒有商品，請先到「商品庫」新增商品' : '找不到符合的商品'}
      </div>
    `;
    return;
  }
  const quoteRate = settings.quoteRate || 50;
  container.innerHTML = list.map(p => {
    const twd = p.twd || Math.round((p.gbp || 0) * quoteRate);
    return `
      <div class="product-picker-item" onclick="addProductToOrder('${p.id}')">
        <div class="picker-item-info">
          <div class="picker-item-name">${escapeHtml(p.name || '')}${p.variant ? ` <span class="product-variant">${escapeHtml(p.variant)}</span>` : ''}</div>
          <div class="picker-item-prices">£${p.gbp || 0} → NT$${twd.toLocaleString()}</div>
        </div>
        <button type="button" class="picker-add-btn">＋ 加入</button>
      </div>
    `;
  }).join('');
}
window.renderProductPicker = renderProductPicker;

function addProductToOrder(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const quoteRate = settings.quoteRate || 50;
  const itemTwd = p.twd || Math.round((p.gbp || 0) * quoteRate);
  const existing = orderItems.find(i => i.productId === productId);
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
  } else {
    orderItems.push({
      productId: p.id,
      name: p.name || '',
      variant: p.variant || '',
      gbp: p.gbp || 0,
      twd: itemTwd,
      qty: 1
    });
  }
  renderOrderItems();
}
window.addProductToOrder = addProductToOrder;

function renderOrderItems() {
  const container = document.getElementById('order-items-container');
  const list = document.getElementById('order-items-list');
  const totalText = document.getElementById('order-items-total-text');
  if (!orderItems || orderItems.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  
  let totalTwd = 0;
  let totalGbp = 0;
  
  list.innerHTML = orderItems.map((item, idx) => {
    const itemTotalTwd = (item.twd || 0) * (item.qty || 1);
    const itemTotalGbp = (item.gbp || 0) * (item.qty || 1);
    totalTwd += itemTotalTwd;
    totalGbp += itemTotalGbp;
    
    return `
      <div class="order-item-row">
        <div class="order-item-main">
          <div class="order-item-title">${escapeHtml(item.name || '')}${item.variant ? ` <span class="product-variant">${escapeHtml(item.variant)}</span>` : ''}</div>
          <div class="order-item-sub">£${item.gbp || 0} / NT$${(item.twd || 0).toLocaleString()} 單價</div>
        </div>
        <div class="order-item-qty-ctrl">
          <button type="button" class="qty-btn" onclick="updateOrderItemQty(${idx}, -1)">−</button>
          <span class="qty-val">${item.qty || 1}</span>
          <button type="button" class="qty-btn" onclick="updateOrderItemQty(${idx}, 1)">＋</button>
        </div>
        <div class="order-item-price">NT$${itemTotalTwd.toLocaleString()}</div>
        <button type="button" class="order-item-del" onclick="removeOrderItem(${idx})" title="移除">✕</button>
      </div>
    `;
  }).join('');
  
  totalText.textContent = `NT$${totalTwd.toLocaleString()} (£${totalGbp.toFixed(2)})`;
}
window.renderOrderItems = renderOrderItems;

function updateOrderItemQty(index, delta) {
  if (!orderItems[index]) return;
  orderItems[index].qty = (orderItems[index].qty || 1) + delta;
  if (orderItems[index].qty <= 0) {
    orderItems.splice(index, 1);
  }
  renderOrderItems();
}
window.updateOrderItemQty = updateOrderItemQty;

function removeOrderItem(index) {
  if (!orderItems[index]) return;
  orderItems.splice(index, 1);
  renderOrderItems();
}
window.removeOrderItem = removeOrderItem;

// Payment select handler
document.getElementById('order-payment').addEventListener('change', e => {
  const isDeposit = e.target.value === 'deposit';
  const depGroup = document.getElementById('deposit-amount-group');
  depGroup.style.display = isDeposit ? 'block' : 'none';
  if (isDeposit && !document.getElementById('order-deposit').value) {
    const totalTwd = orderItems.reduce((s, i) => s + (i.twd || 0) * (i.qty || 1), 0);
    if (totalTwd > 0) {
      document.getElementById('order-deposit').value = Math.round(totalTwd * (settings.depositRatio || 30) / 100);
    }
  }
});

// Save Order
document.getElementById('save-order-btn').addEventListener('click', async () => {
  const phone = phoneInput.value.trim();
  if (!phone) {
    showToast('請輸入買家電話 📱');
    phoneInput.focus();
    return;
  }
  
  let finalBuyerId = selectedBuyerId;
  
  // If no buyer selected yet, check if phone matches existing buyer
  if (!finalBuyerId) {
    const existing = buyers.find(b => b.phone === phone);
    if (existing) {
      finalBuyerId = existing.id;
    } else {
      // Must create a new buyer
      const newName = document.getElementById('order-new-buyer-name').value.trim();
      if (!newName) {
        document.getElementById('buyer-new-fields').style.display = 'block';
        showToast('此電話為新買家，請填寫買家名稱 👤');
        document.getElementById('order-new-buyer-name').focus();
        return;
      }
      const newContact = document.getElementById('order-new-buyer-contact').value.trim();
      const newAddress = document.getElementById('order-new-buyer-address').value.trim();
      
      const newBuyerData = {
        id: Date.now().toString(),
        name: newName,
        phone: phone,
        contact: newContact,
        address: newAddress,
        notes: '',
        createdAt: Date.now()
      };
      finalBuyerId = await saveBuyer(newBuyerData);
    }
  }
  
  if (!orderItems || orderItems.length === 0) {
    showToast('請至少選取一項商品 🛍️');
    return;
  }
  
  const status = document.getElementById('order-status').value;
  const payment = document.getElementById('order-payment').value;
  const deposit = payment === 'deposit' ? (parseFloat(document.getElementById('order-deposit').value) || 0) : 0;
  const notes = document.getElementById('order-notes').value.trim();
  
  const orderData = {
    id: editOrderId || Date.now().toString(),
    buyerId: finalBuyerId,
    items: orderItems,
    status: status,
    payment: payment,
    deposit: deposit,
    notes: notes,
    createdAt: editOrderId ? (orders.find(o => o.id === editOrderId)?.createdAt || Date.now()) : Date.now()
  };
  
  await saveOrder(orderData);
  closeModal('order-modal');
  showToast(editOrderId ? '代購單已更新 ✅' : '代購單已新增 🎉');
});

// Delete Order
document.getElementById('delete-order-btn').addEventListener('click', async () => {
  if (!editOrderId || !confirm('確定要刪除這筆代購單嗎？')) return;
  await deleteOrder(editOrderId);
  closeModal('order-modal');
  showToast('代購單已刪除');
});

// Buyers Tab
function renderBuyers() {
  const list = document.getElementById('buyers-list');
  const q = buyerSearch.toLowerCase();
  let filtered = buyers.filter(b => 
    !q || 
    (b.name || '').toLowerCase().includes(q) || 
    (b.phone || '').includes(q) || 
    (b.contact || '').toLowerCase().includes(q)
  );
  
  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <p>${buyers.length === 0 ? '還沒有買家資料，新增訂單時會自動建立！' : '沒有符合的買家'}</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = filtered.map(b => {
    const buyerOrders = orders.filter(o => o.buyerId === b.id);
    const totalSpent = buyerOrders.reduce((s, o) => s + getOrderRevenue(o), 0);
    return `
      <div class="buyer-card" onclick="viewBuyerDetail('${b.id}')">
        <div class="buyer-card-header">
          <div class="buyer-avatar">${(b.name || '?')[0].toUpperCase()}</div>
          <div class="buyer-info">
            <div class="buyer-name">${escapeHtml(b.name || '')}</div>
            <div class="buyer-contact">${escapeHtml(b.phone || b.contact || '無聯絡資訊')}</div>
          </div>
          <button class="buyer-edit-btn" onclick="event.stopPropagation();openEditBuyer('${b.id}')" title="編輯">✏️</button>
        </div>
        ${b.address ? `<div class="buyer-address">📍 ${escapeHtml(b.address)}</div>` : ''}
        <div class="buyer-stats">
          <span>共 ${buyerOrders.length} 筆訂單</span>
          <span class="buyer-total-spent">累積 NT$${totalSpent.toLocaleString()}</span>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('buyer-search').addEventListener('input', e => {
  buyerSearch = e.target.value;
  renderBuyers();
});

document.getElementById('add-buyer-btn').addEventListener('click', openAddBuyer);

function openAddBuyer() {
  editBuyerId = null;
  document.getElementById('buyer-modal-title').textContent = '👤 新增買家';
  ['buyer-name', 'buyer-contact', 'buyer-phone', 'buyer-address', 'buyer-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('delete-buyer-btn').style.display = 'none';
  openModal('buyer-modal');
}

function openEditBuyer(id) {
  const b = buyers.find(x => x.id === id);
  if (!b) return;
  editBuyerId = id;
  document.getElementById('buyer-modal-title').textContent = '✏️ 編輯買家';
  document.getElementById('buyer-name').value = b.name || '';
  document.getElementById('buyer-contact').value = b.contact || '';
  document.getElementById('buyer-phone').value = b.phone || '';
  document.getElementById('buyer-address').value = b.address || '';
  document.getElementById('buyer-notes').value = b.notes || '';
  document.getElementById('delete-buyer-btn').style.display = 'block';
  openModal('buyer-modal');
}
window.openEditBuyer = openEditBuyer;

document.getElementById('save-buyer-btn').addEventListener('click', async () => {
  const name = document.getElementById('buyer-name').value.trim();
  if (!name) { showToast('請填寫買家名稱'); return; }
  const data = {
    id: editBuyerId || Date.now().toString(),
    name,
    contact: document.getElementById('buyer-contact').value.trim(),
    phone: document.getElementById('buyer-phone').value.trim(),
    address: document.getElementById('buyer-address').value.trim(),
    notes: document.getElementById('buyer-notes').value.trim(),
    createdAt: editBuyerId ? (buyers.find(b => b.id === editBuyerId)?.createdAt || Date.now()) : Date.now()
  };
  await saveBuyer(data);
  closeModal('buyer-modal');
  showToast(editBuyerId ? '買家已更新 ✅' : '買家已新增 ✅');
});

document.getElementById('delete-buyer-btn').addEventListener('click', async () => {
  if (!editBuyerId || !confirm('確定要刪除此買家？相關訂單不會被刪除。')) return;
  await deleteBuyer(editBuyerId);
  closeModal('buyer-modal');
  showToast('買家已刪除');
});

function viewBuyerDetail(id) {
  const b = buyers.find(x => x.id === id);
  if (!b) return;
  viewBuyerId = id;
  const buyerOrders = orders.filter(o => o.buyerId === id);
  const totalRev = buyerOrders.reduce((s, o) => s + getOrderRevenue(o), 0);
  const totalPaid = buyerOrders.reduce((s, o) => {
    if (o.payment === 'paid') return s + getOrderRevenue(o);
    if (o.payment === 'deposit') return s + (parseFloat(o.deposit) || 0);
    return s;
  }, 0);
  const unpaid = totalRev - totalPaid;

  document.getElementById('buyer-detail-name').textContent = `👤 ${b.name}`;
  document.getElementById('buyer-detail-body').innerHTML = `
    <div class="detail-card">
      <div class="detail-row"><span class="detail-lbl">電話：</span><span>${escapeHtml(b.phone || '—')}</span></div>
      <div class="detail-row"><span class="detail-lbl">聯絡方式：</span><span>${escapeHtml(b.contact || '—')}</span></div>
      <div class="detail-row"><span class="detail-lbl">收貨地址：</span><span>${escapeHtml(b.address || '—')}</span></div>
      ${b.notes ? `<div class="detail-row"><span class="detail-lbl">備註：</span><span>${escapeHtml(b.notes)}</span></div>` : ''}
    </div>
    <div class="detail-stats-row">
      <div class="detail-stat-box"><span class="stat-num">${buyerOrders.length}</span><span class="stat-lbl">歷史訂單</span></div>
      <div class="detail-stat-box"><span class="stat-num">NT$${totalRev.toLocaleString()}</span><span class="stat-lbl">累積金額</span></div>
      <div class="detail-stat-box"><span class="stat-num" style="color:${unpaid > 0 ? 'var(--yellow)' : 'var(--green)'}">NT$${unpaid.toLocaleString()}</span><span class="stat-lbl">未結餘額</span></div>
    </div>
    <div class="detail-section-title">📦 歷史訂單紀錄</div>
    <div class="detail-orders-list">
      ${buyerOrders.length === 0 ? '<div class="empty-hint">尚無訂單紀錄</div>' : buyerOrders.map(o => {
        const rev = getOrderRevenue(o);
        const tags = o.items && o.items.length > 0
          ? o.items.map(i => `${escapeHtml(i.name)} ×${i.qty || 1}`).join(', ')
          : escapeHtml(o.product || '');
        return `
          <div class="compact-item" onclick="closeModal('buyer-detail-modal');openEditOrder('${o.id}')">
            <div class="compact-left">
              <div class="compact-name">${tags}</div>
              <div class="compact-sub">${new Date(o.createdAt || Date.now()).toLocaleDateString()} · <span class="badge ${o.status || 'pending'}">${statusLabel(o.status)}</span></div>
            </div>
            <div class="compact-right">
              <div class="compact-price">NT$${rev.toLocaleString()}</div>
              <span class="badge ${o.payment || 'unpaid'}">${paymentLabel(o.payment)}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <button class="primary-btn full-btn" style="margin-top:16px" onclick="closeModal('buyer-detail-modal');openEditBuyer('${b.id}')">✏️ 編輯買家資料</button>
  `;
  openModal('buyer-detail-modal');
}
window.viewBuyerDetail = viewBuyerDetail;

// Pending Procurement Page
function renderPending() {
  const pendingOrders = orders.filter(o => (o.status || 'pending') === 'pending');
  const list = document.getElementById('pending-list');
  if (!list) return;
  
  let totalPendingQty = 0;
  let totalPendingGbp = 0;
  
  const agg = {};
  pendingOrders.forEach(o => {
    const buyer = buyers.find(b => b.id === o.buyerId);
    if (o.items && Array.isArray(o.items)) {
      o.items.forEach(item => {
        const key = `${item.productId || item.name}__${item.variant || ''}`;
        if (!agg[key]) {
          agg[key] = {
            name: item.name || '',
            variant: item.variant || '',
            gbp: item.gbp || 0,
            qty: 0,
            orders: []
          };
        }
        agg[key].qty += (item.qty || 1);
        agg[key].orders.push({ orderId: o.id, buyerName: buyer?.name || '未知', qty: item.qty || 1 });
        totalPendingQty += (item.qty || 1);
        totalPendingGbp += (item.gbp || 0) * (item.qty || 1);
      });
    } else {
      const key = `${o.productId || o.product}__${o.variant || ''}`;
      if (!agg[key]) {
        agg[key] = {
          name: o.product || '',
          variant: o.variant || '',
          gbp: o.gbp || 0,
          qty: 0,
          orders: []
        };
      }
      agg[key].qty += (o.qty || 1);
      agg[key].orders.push({ orderId: o.id, buyerName: buyer?.name || '未知', qty: o.qty || 1 });
      totalPendingQty += (o.qty || 1);
      totalPendingGbp += (o.gbp || 0) * (o.qty || 1);
    }
  });

  document.getElementById('pending-count').textContent = totalPendingQty;
  document.getElementById('pending-gbp').textContent = `£${totalPendingGbp.toFixed(2)}`;

  const items = Object.values(agg);
  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <p>所有商品都已購買！</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="product-card">
      <div class="product-card-left">
        <div class="product-name">
          ${escapeHtml(item.name)}
          ${item.variant ? `<span class="product-variant">${escapeHtml(item.variant)}</span>` : ''}
        </div>
        <div class="product-price-row">
          <span class="product-gbp">£${(item.gbp * item.qty).toFixed(2)}</span>
          <span class="product-meta">（£${item.gbp} × ${item.qty}）</span>
        </div>
        <div class="product-meta" style="margin-top:6px">
          買家：${item.orders.map(x => `${escapeHtml(x.buyerName)} (${x.qty})`).join('、')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <span class="badge pending" style="font-size:14px;padding:6px 12px">需買 ×${item.qty}</span>
        <button class="link-btn" style="font-size:11px" onclick="markItemOrdersOrdered('${item.orders.map(o=>o.orderId).join(',')}')">全部標記為已下單</button>
      </div>
    </div>
  `).join('');
}

async function markItemOrdersOrdered(orderIdsStr) {
  const ids = orderIdsStr.split(',');
  for (const id of ids) {
    const o = orders.find(x => x.id === id);
    if (o) {
      await saveOrder({ ...o, status: 'ordered' });
    }
  }
  showToast('已更新為「已下單」📦');
}
window.markItemOrdersOrdered = markItemOrdersOrdered;

// Modals & UI Helpers
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}
window.openModal = openModal;
window.closeModal = closeModal;

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modal || btn.closest('.modal-overlay')?.id;
    if (modalId) closeModal(modalId);
  });
});

document.querySelectorAll('.modal-overlay').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(modal.id);
  });
});

function renderAll() {
  renderDashboard();
  renderOrders();
  renderProducts();
  renderBuyers();
  renderPending();
}

function statusLabel(s) {
  const map = { pending: '🟠 待購', ordered: '🔵 已下單', arrived: '🟣 已到貨', shipped: '🟢 已出貨' };
  return map[s] || '🟠 待購';
}
function paymentLabel(p) {
  const map = { unpaid: '❌ 未付款', deposit: '💛 已付訂金', paid: '✅ 已全額付清' };
  return map[p] || '❌ 未付款';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
window.showToast = showToast;
