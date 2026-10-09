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
  apiKey: "AIzaSyCczhSbLa_cHzO3_I9X5GVGkwSGLz27zco",
  authDomain: "jellycat-32a1d.firebaseapp.com",
  projectId: "jellycat-32a1d",
  storageBucket: "jellycat-32a1d.firebasestorage.app",
  messagingSenderId: "390102986960",
  appId: "1:390102986960:web:dd2bcb7f526104fd612ed5",
  measurementId: "G-22YFNS3KLZ"
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
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = user;
      showApp();
      loadData();
    } else {
      currentUser = null;
      showLogin();
      cleanup();
    }
  });
} catch (e) {
  console.warn('Firebase init error:', e.message);
}

// Auth
const loginBtn = document.getElementById('google-login-btn');
const demoBtn = document.getElementById('demo-login-btn');

if (demoBtn) {
  demoBtn.addEventListener('click', () => {
    showToast('以本機/離線模式進入系統 📱');
    showDemoMode();
  });
}

if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    if (location.protocol === 'file:') {
      showToast('💡 提示：本機檔案模式直接進入，部署到網站後即可使用 Google 雲端同步');
      showDemoMode();
      return;
    }
    if (!auth) {
      showToast('⚠️ Firebase 服務未就緒，為您切換至本機模式');
      showDemoMode();
      return;
    }
    const origHtml = loginBtn.innerHTML;
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
    loginBtn.innerHTML = '<span>⏳ 正在開啟 Google 登入視窗…</span>';

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      showToast('🎉 Google 登入成功！');
    } catch (e) {
      console.error('Login error:', e);
      if (e.code === 'auth/popup-closed-by-user') {
        showToast('已取消登入');
      } else if (e.code === 'auth/popup-blocked') {
        showToast('⚠️ 瀏覽器攔截了彈出視窗，請允許彈出視窗後重試');
      } else if (e.code === 'auth/unauthorized-domain') {
        showToast('⚠️ 網域尚未在 Firebase 授權，已自動為您切換至離線模式進入');
        showDemoMode();
      } else {
        showToast(`登入失敗（${e.message || '請確認 Firebase 已啟用 Google 登入'}），為您切換至離線模式`);
        showDemoMode();
      }
    } finally {
      loginBtn.disabled = false;
      loginBtn.style.opacity = '1';
      loginBtn.innerHTML = origHtml;
    }
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

// Data: Firestore & Local Storage
function isCloudMode() {
  return db && currentUser && currentUser.uid && currentUser.uid !== 'demo';
}

function getUserPath(col) {
  return collection(db, 'users', currentUser.uid, col);
}

async function loadData() {
  loadLocalData();

  if (!isCloudMode()) return;

  try {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'settings'));
    snap.forEach(d => { if (d.id === 'main') Object.assign(settings, d.data()); });
  } catch (err) {
    console.warn('Load cloud settings error:', err);
  }
  if (settings.rate && !settings.quoteRate) settings.quoteRate = settings.rate;
  if (!settings.quoteRate) settings.quoteRate = 50;
  if (!settings.costRate) settings.costRate = 41.5;
  updateRateDisplay();

  try {
    unsubscribers.push(onSnapshot(getUserPath('buyers'), snap => {
      if (!snap.empty) {
        buyers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocalData();
        renderBuyers(); renderDashboard();
      }
    }, err => {
      console.warn('Buyers cloud sync error:', err.message);
    }));

    unsubscribers.push(onSnapshot(getUserPath('orders'), snap => {
      if (!snap.empty) {
        orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocalData();
        renderOrders(); renderDashboard(); renderPending();
      }
    }, err => {
      console.warn('Orders cloud sync error:', err.message);
    }));

    unsubscribers.push(onSnapshot(getUserPath('products'), snap => {
      if (!snap.empty) {
        products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocalData();
        renderProducts(); renderProductPicker();
      }
    }, err => {
      console.warn('Products cloud sync error:', err.message);
    }));
  } catch (e) {
    console.warn('Firestore snapshot setup failed:', e);
  }
}

async function saveBuyer(data) {
  const id = data.id || Date.now().toString();
  const idx = buyers.findIndex(b => b.id === id);
  if (idx >= 0) buyers[idx] = { ...data, id }; else buyers.push({ ...data, id });
  saveLocalData();
  renderBuyers();
  renderDashboard();

  if (isCloudMode()) {
    try {
      await setDoc(doc(db, 'users', currentUser.uid, 'buyers', id), { ...data, id });
    } catch (err) {
      console.error('Cloud saveBuyer error:', err);
      handleCloudError(err);
    }
  }
  return id;
}

async function deleteBuyer(id) {
  buyers = buyers.filter(b => b.id !== id);
  saveLocalData();
  renderBuyers();
  renderDashboard();

  if (isCloudMode()) {
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'buyers', id));
    } catch (err) {
      console.error('Cloud deleteBuyer error:', err);
      handleCloudError(err);
    }
  }
}

async function saveOrder(data) {
  const id = data.id || Date.now().toString();
  if (!data.createdAt) data.createdAt = Date.now();
  const idx = orders.findIndex(o => o.id === id);
  if (idx >= 0) orders[idx] = { ...data, id }; else orders.unshift({ ...data, id });
  saveLocalData();
  renderOrders();
  renderDashboard();
  renderPending();

  if (isCloudMode()) {
    try {
      await setDoc(doc(db, 'users', currentUser.uid, 'orders', id), { ...data, id });
    } catch (err) {
      console.error('Cloud saveOrder error:', err);
      handleCloudError(err);
    }
  }
}

async function deleteOrder(id) {
  orders = orders.filter(o => o.id !== id);
  saveLocalData();
  renderOrders();
  renderDashboard();
  renderPending();

  if (isCloudMode()) {
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'orders', id));
    } catch (err) {
      console.error('Cloud deleteOrder error:', err);
      handleCloudError(err);
    }
  }
}

async function saveProduct(data) {
  const id = data.id || Date.now().toString();
  if (!data.createdAt) data.createdAt = Date.now();
  const idx = products.findIndex(p => p.id === id);
  if (idx >= 0) products[idx] = { ...data, id }; else products.push({ ...data, id });
  saveLocalData();
  renderProducts();
  renderProductPicker();

  if (isCloudMode()) {
    try {
      await setDoc(doc(db, 'users', currentUser.uid, 'products', id), { ...data, id });
    } catch (err) {
      console.error('Cloud saveProduct error:', err);
      handleCloudError(err);
    }
  }
}

async function deleteProduct(id) {
  products = products.filter(p => p.id !== id);
  saveLocalData();
  renderProducts();
  renderProductPicker();

  if (isCloudMode()) {
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'products', id));
    } catch (err) {
      console.error('Cloud deleteProduct error:', err);
      handleCloudError(err);
    }
  }
}

async function saveSettings() {
  saveLocalData();
  if (isCloudMode()) {
    try {
      await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), settings);
    } catch (err) {
      console.error('Cloud saveSettings error:', err);
      handleCloudError(err);
    }
  }
}

function handleCloudError(err) {
  if (err && err.code === 'permission-denied') {
    showToast('⚠️ Firestore 權限尚未開放，資料已安全保存在本機！');
  }
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
function getOrderGbp(o) {
  if (o.items && Array.isArray(o.items)) return o.items.reduce((s, i) => s + (i.gbp||0)*(i.qty||1), 0);
  return (o.gbp||0)*(o.qty||1);
}
function getOrderCostGbp(o) {
  if (o.items && Array.isArray(o.items)) {
    return o.items.reduce((s, i) => {
      const c = (i.costGbp !== undefined && i.costGbp !== null && i.costGbp > 0) ? i.costGbp : (i.gbp || 0);
      return s + c * (i.qty || 1);
    }, 0);
  }
  const c = (o.costGbp !== undefined && o.costGbp !== null && o.costGbp > 0) ? o.costGbp : (o.gbp || 0);
  return c * (o.qty || 1);
}
function getOrderCost(o) {
  const costRate = settings.costRate || 41.5;
  return getOrderCostGbp(o) * costRate;
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
    const sellingGbp = getOrderGbp(o), costGbp = getOrderCostGbp(o);
    const hasDiffCost = Math.abs(sellingGbp - costGbp) > 0.001;
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
        <span class="order-gbp">${hasDiffCost ? `標價 £${sellingGbp.toFixed(2)} (成本 £${costGbp.toFixed(2)})` : `£${sellingGbp.toFixed(2)}`} → 採購成本 NT$${Math.round(cost).toLocaleString()} (£1=NT$${costRate})</span>
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
  const quoteRate = settings.quoteRate || 50;
  list.innerHTML = filtered.map(p => {
    const costGbp = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp > 0) ? p.costGbp : (p.gbp || 0);
    const hasDiffCost = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp > 0 && Math.abs(p.costGbp - (p.gbp || 0)) > 0.001);
    const twdPrice = p.twd || Math.round((p.gbp || 0) * quoteRate);
    const cost = costGbp * costRate;
    const profit = twdPrice - cost;
    const pColor = profit >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="product-card" onclick="openEditProduct('${p.id}')">
      <div class="product-card-left">
        <div class="product-name">${escapeHtml(p.name||'')}${p.variant?` <span class="product-variant">${escapeHtml(p.variant)}</span>`:''}</div>
        <div class="product-price-row">
          <span class="product-gbp">£${p.gbp||0}</span>
          ${hasDiffCost ? `<span class="product-cost-badge" style="font-size:11px;background:rgba(234,179,8,0.15);color:var(--yellow);padding:2px 7px;border-radius:6px;border:1px solid rgba(234,179,8,0.3);font-weight:800">成本 £${p.costGbp}</span>` : ''}
          <span class="product-arrow">→ 售價</span>
          <span class="product-twd">NT$${twdPrice.toLocaleString()}</span>
        </div>
        <div class="product-meta">成本 NT$${Math.round(cost).toLocaleString()} (${hasDiffCost ? `£${costGbp} × ${costRate}` : `£1=NT$${costRate}`}) · <span style="color:${pColor};font-weight:800">利潤 NT$${Math.round(profit).toLocaleString()}</span></div>
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
  ['product-name','product-variant','product-gbp','product-cost-gbp','product-notes'].forEach(id => {
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
  const costEl = document.getElementById('product-cost-gbp');
  if (costEl) costEl.value = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp !== p.gbp) ? p.costGbp : (p.costGbp || '');
  document.getElementById('product-notes').value = p.notes || '';
  document.getElementById('delete-product-btn').style.display = 'block';
  updateProductHints();
  openModal('product-modal');
}
window.openEditProduct = openEditProduct;

function updateProductHints() {
  const gbp = parseFloat(document.getElementById('product-gbp').value) || 0;
  const costGbpInput = parseFloat(document.getElementById('product-cost-gbp').value);
  const costGbp = (!isNaN(costGbpInput) && costGbpInput > 0) ? costGbpInput : gbp;
  const costRate = settings.costRate || 41.5;
  const quoteRate = settings.quoteRate || 50;
  const twd = Math.round(gbp * quoteRate);
  const cost = costGbp * costRate;
  const profit = twd - cost;
  const hasDiffCost = (!isNaN(costGbpInput) && costGbpInput > 0 && Math.abs(costGbpInput - gbp) > 0.001);

  const twdElem = document.getElementById('product-twd-calc');
  if (twdElem) twdElem.textContent = `NT$${twd.toLocaleString()} (£${gbp} × ${quoteRate})`;

  const costElem = document.getElementById('product-cost-calc');
  if (costElem) {
    costElem.textContent = hasDiffCost
      ? `NT$${Math.round(cost).toLocaleString()} (£${costGbp} × ${costRate})`
      : `NT$${Math.round(cost).toLocaleString()} (£1=NT$${costRate})`;
  }

  const profitElem = document.getElementById('product-profit-calc');
  if (profitElem) {
    if (hasDiffCost) {
      profitElem.textContent = `${profit >= 0 ? '+' : ''}NT$${Math.round(profit).toLocaleString()} (標價£${gbp}×${quoteRate} − 成本£${costGbp}×${costRate})`;
    } else {
      const diff = (quoteRate - costRate).toFixed(1);
      profitElem.textContent = `${profit >= 0 ? '+' : ''}NT$${Math.round(profit).toLocaleString()} (每 £ 賺 NT$${diff})`;
    }
    profitElem.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

document.getElementById('product-gbp').addEventListener('input', updateProductHints);
const costGbpInputEl = document.getElementById('product-cost-gbp');
if (costGbpInputEl) costGbpInputEl.addEventListener('input', updateProductHints);

document.getElementById('save-product-btn').addEventListener('click', async () => {
  const name = document.getElementById('product-name').value.trim();
  const gbp = parseFloat(document.getElementById('product-gbp').value);
  if (!name) { showToast('請填寫商品名稱 🏷️'); return; }
  if (!gbp || gbp <= 0) { showToast('請填寫英鎊標價 💷'); return; }

  const costGbpInput = parseFloat(document.getElementById('product-cost-gbp').value);
  const costGbp = (!isNaN(costGbpInput) && costGbpInput > 0) ? costGbpInput : gbp;

  const quoteRate = settings.quoteRate || 50;
  const twd = Math.round(gbp * quoteRate);

  const data = {
    id: editProductId || Date.now().toString(),
    name,
    variant: document.getElementById('product-variant').value.trim(),
    gbp,
    costGbp,
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
  if(o.items&&Array.isArray(o.items)&&o.items.length>0) {
    orderItems=o.items.map(i=>({
      ...i,
      costGbp: (i.costGbp !== undefined && i.costGbp !== null && i.costGbp > 0) ? i.costGbp : (i.gbp || 0)
    }));
  } else {
    const costGbp = (o.costGbp !== undefined && o.costGbp !== null && o.costGbp > 0) ? o.costGbp : (o.gbp || 0);
    orderItems=[{productId:o.productId||null,name:o.product||'',variant:o.variant||'',gbp:o.gbp||0,costGbp:costGbp,twd:o.twd||0,qty:o.qty||1}];
  }
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
      const costGbp = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp > 0) ? p.costGbp : (p.gbp || 0);
      
      const existing = orderItems.find(i => i.productId === p.id);
      if (existing) {
        existing.qty = (existing.qty || 1) + item.qty;
      } else {
        orderItems.push({
          productId: p.id,
          name: p.name || '',
          variant: p.variant || '',
          gbp: p.gbp || 0,
          costGbp: costGbp,
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
    const hasDiffCost = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp > 0 && Math.abs(p.costGbp - (p.gbp || 0)) > 0.001);
    return `
      <div class="product-picker-item" onclick="addProductToOrder('${p.id}')">
        <div class="picker-item-info">
          <div class="picker-item-name">${escapeHtml(p.name || '')}${p.variant ? ` <span class="product-variant">${escapeHtml(p.variant)}</span>` : ''}</div>
          <div class="picker-item-prices">£${p.gbp || 0}${hasDiffCost ? ` (成本 £${p.costGbp})` : ''} → NT$${twd.toLocaleString()}</div>
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
  const costGbp = (p.costGbp !== undefined && p.costGbp !== null && p.costGbp > 0) ? p.costGbp : (p.gbp || 0);
  const existing = orderItems.find(i => i.productId === productId);
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
  } else {
    orderItems.push({
      productId: p.id,
      name: p.name || '',
      variant: p.variant || '',
      gbp: p.gbp || 0,
      costGbp: costGbp,
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
  let totalPurchased = 0;
  let totalUnits = 0;

  list.innerHTML = orderItems.map((item, idx) => {
    const qty = item.qty || 1;
    const pqty = item.purchasedQty || 0;
    const itemTotalTwd = (item.twd || 0) * qty;
    const itemTotalGbp = (item.gbp || 0) * qty;
    totalTwd += itemTotalTwd;
    totalGbp += itemTotalGbp;
    totalPurchased += pqty;
    totalUnits += qty;
    const hasDiffCost = (item.costGbp !== undefined && item.costGbp !== null && item.costGbp > 0 && Math.abs(item.costGbp - (item.gbp || 0)) > 0.001);

    // Build per-unit toggle rows
    let unitRows = '';
    for (let u = 0; u < qty; u++) {
      const isPurchased = u < pqty;
      unitRows += `
        <div class="unit-row ${isPurchased ? 'purchased' : ''}" onclick="toggleUnitPurchase(${idx}, ${u})">
          <span class="unit-label">${qty > 1 ? `第 ${u + 1}/${qty}` : '此商品'}</span>
          <label class="toggle-switch" onclick="event.stopPropagation()">
            <input type="checkbox" ${isPurchased ? 'checked' : ''} onchange="toggleUnitPurchase(${idx}, ${u})">
            <span class="toggle-slider"></span>
            <span class="toggle-text">${isPurchased ? '已購買' : '待購買'}</span>
          </label>
        </div>`;
    }

    return `
      <div class="order-item-block">
        <div class="order-item-header">
          <div class="order-item-main">
            <div class="order-item-title">${escapeHtml(item.name || '')}${item.variant ? ` <span class="product-variant">${escapeHtml(item.variant)}</span>` : ''}</div>
            <div class="order-item-sub">£${item.gbp || 0}${hasDiffCost ? ` (成本 £${item.costGbp})` : ''}</div>
          </div>
          <div class="order-item-price-edit">
            <span style="font-size:10px;color:var(--text-dim)">售價</span>
            <input type="number" class="inline-price-input" value="${item.twd || 0}" onchange="updateItemPrice(${idx}, this.value)" onclick="event.stopPropagation()" />
          </div>
          <div class="order-item-qty-ctrl">
            <button type="button" class="qty-btn" onclick="updateOrderItemQty(${idx}, -1)">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="qty-btn" onclick="updateOrderItemQty(${idx}, 1)">＋</button>
          </div>
          <button type="button" class="order-item-del" onclick="removeOrderItem(${idx})" title="移除">✕</button>
        </div>
        <div class="unit-rows-container">
          ${unitRows}
        </div>
        <div class="purchase-progress">
          <div class="progress-bar-mini"><div class="progress-fill-mini" style="width:${qty > 0 ? (pqty / qty * 100) : 0}%"></div></div>
          <span class="progress-text">${pqty}/${qty} 已購買</span>
        </div>
      </div>
    `;
  }).join('');

  totalText.innerHTML = `NT$${totalTwd.toLocaleString()} (£${totalGbp.toFixed(2)}) <span style="margin-left:8px;font-size:11px;color:${totalPurchased >= totalUnits ? 'var(--green)' : 'var(--orange)'}">📦 ${totalPurchased}/${totalUnits} 已購</span>`;
}
window.renderOrderItems = renderOrderItems;

function toggleUnitPurchase(itemIdx, unitIdx) {
  if (!orderItems[itemIdx]) return;
  const item = orderItems[itemIdx];
  const qty = item.qty || 1;
  const pqty = item.purchasedQty || 0;
  if (unitIdx < pqty) {
    // Un-purchase: set purchasedQty to unitIdx
    item.purchasedQty = unitIdx;
  } else {
    // Purchase: set purchasedQty to unitIdx + 1
    item.purchasedQty = unitIdx + 1;
  }
  renderOrderItems();
}
window.toggleUnitPurchase = toggleUnitPurchase;

function updateItemPrice(itemIdx, newVal) {
  if (!orderItems[itemIdx]) return;
  const twd = parseInt(newVal, 10);
  if (!isNaN(twd) && twd >= 0) {
    orderItems[itemIdx].twd = twd;
  }
  renderOrderItems();
}
window.updateItemPrice = updateItemPrice;

function updateOrderItemQty(index, delta) {
  if (!orderItems[index]) return;
  const newQty = (orderItems[index].qty || 1) + delta;
  if (newQty <= 0) {
    orderItems.splice(index, 1);
  } else {
    orderItems[index].qty = newQty;
    if ((orderItems[index].purchasedQty || 0) > newQty) {
      orderItems[index].purchasedQty = newQty;
    }
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

function areAllItemsPurchased() {
  if (!orderItems || orderItems.length === 0) return false;
  return orderItems.every(i => (i.purchasedQty || 0) >= (i.qty || 1));
}

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
  
  let finalBuyerId = selectedBuyerId;
  
  // If no buyer selected, try phone or create new
  if (!finalBuyerId) {
    if (phone) {
      const existing = buyers.find(b => b.phone === phone);
      if (existing) {
        finalBuyerId = existing.id;
      }
    }
    if (!finalBuyerId) {
      // Check new buyer name
      const newName = document.getElementById('order-new-buyer-name').value.trim();
      if (!newName && !phone) {
        document.getElementById('buyer-new-fields').style.display = 'block';
        showToast('請填寫買家名稱（電話可選填）👤');
        document.getElementById('order-new-buyer-name').focus();
        return;
      }
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
        phone: phone || '',
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
  // Gate order status: can only move beyond 'pending' if all items purchased
  if (status !== 'pending' && !areAllItemsPurchased()) {
    showToast('⚠️ 尚有商品未購買，請先將所有商品標為「已購買」再更改訂單狀態');
    document.getElementById('order-status').value = 'pending';
    return;
  }
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
        const costGbp = (item.costGbp !== undefined && item.costGbp !== null && item.costGbp > 0) ? item.costGbp : (item.gbp || 0);
        const totalQty = item.qty || 1;
        const purchased = item.purchasedQty || 0;
        const unpurchased = Math.max(0, totalQty - purchased);
        if (unpurchased <= 0) return; // Skip fully purchased items
        
        const key = `${item.productId || item.name}__${item.variant || ''}`;
        if (!agg[key]) {
          agg[key] = {
            name: item.name || '',
            variant: item.variant || '',
            gbp: item.gbp || 0,
            costGbp: costGbp,
            qty: 0,
            totalQty: 0,
            purchasedQty: 0,
            orders: []
          };
        }
        agg[key].qty += unpurchased;
        agg[key].totalQty += totalQty;
        agg[key].purchasedQty += purchased;
        agg[key].orders.push({ orderId: o.id, buyerName: buyer?.name || '未知', qty: unpurchased, totalQty: totalQty, purchased: purchased });
        totalPendingQty += unpurchased;
        totalPendingGbp += costGbp * unpurchased;
      });
    } else {
      const costGbp = (o.costGbp !== undefined && o.costGbp !== null && o.costGbp > 0) ? o.costGbp : (o.gbp || 0);
      const key = `${o.productId || o.product}__${o.variant || ''}`;
      if (!agg[key]) {
        agg[key] = {
          name: o.product || '',
          variant: o.variant || '',
          gbp: o.gbp || 0,
          costGbp: costGbp,
          qty: 0,
          totalQty: 0,
          purchasedQty: 0,
          orders: []
        };
      }
      agg[key].qty += (o.qty || 1);
      agg[key].totalQty += (o.qty || 1);
      agg[key].orders.push({ orderId: o.id, buyerName: buyer?.name || '未知', qty: o.qty || 1, totalQty: o.qty || 1, purchased: 0 });
      totalPendingQty += (o.qty || 1);
      totalPendingGbp += costGbp * (o.qty || 1);
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

  list.innerHTML = items.map(item => {
    const hasDiffCost = Math.abs(item.costGbp - item.gbp) > 0.001;
    const progressPct = item.totalQty > 0 ? (item.purchasedQty / item.totalQty * 100) : 0;
    return `
    <div class="product-card">
      <div class="product-card-left">
        <div class="product-name">
          ${escapeHtml(item.name)}
          ${item.variant ? `<span class="product-variant">${escapeHtml(item.variant)}</span>` : ''}
        </div>
        <div class="product-price-row">
          <span class="product-gbp">£${(item.costGbp * item.qty).toFixed(2)}</span>
          <span class="product-meta">（${hasDiffCost ? `成本 £${item.costGbp} · 標價 £${item.gbp}` : `£${item.gbp}`} × ${item.qty}）</span>
        </div>
        <div class="product-meta" style="margin-top:4px">
          買家：${item.orders.map(x => `${escapeHtml(x.buyerName)} (待買${x.qty})`).join('、')}
        </div>
        <div class="purchase-progress" style="margin-top:6px">
          <div class="progress-bar-mini"><div class="progress-fill-mini" style="width:${progressPct}%"></div></div>
          <span class="progress-text">${item.purchasedQty}/${item.totalQty} 已購</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <span class="badge pending" style="font-size:14px;padding:6px 12px">待買 ×${item.qty}</span>
        <button class="link-btn" style="font-size:11px" onclick="markItemOrdersOrdered('${item.orders.map(o=>o.orderId).join(',')}')">全部標記為已下單</button>
      </div>
    </div>
  `;
  }).join('');
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
  if (m) {
    m.classList.add('active');
    m.classList.add('open');
  }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('active');
    m.classList.remove('open');
  }
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

// =============================================
// CSV Import Engine (英國代購 CSV 統整與匯入)
// =============================================
const BUILTIN_CSV_DATA = `賴名稱,姓名,電話,門市,訂購商品,訂金,商品價格,運費,成本,獲利,,
亘,陳奕亘,910498594,淡水金滬,波斯貓（白）*1,1000✅(96821),2000,,暫時取消,,,
ShellyChen,陳俐瑄,989764398,板民門市,鮭魚兔*1,825✅(70224),1650,,1419,231,,退錢
孟妤,陳孟妤,979266998,金沙門市,綠*1藍*1,825✅(27752),3000,,1419,1581,,沒買到鮭魚要減825
陳希紜,,,,鮭魚兔*5藍*5綠*5波斯貓*5,8250✅(52686),33250,,7095,1155,,沒買到鮭魚要減1650
姵羽,諶姵羽,919311766,面交,鮭魚兔*2,1650✅(48583),3300,,2838,462,,
楊琇聿,楊琇聿,911280503,臨通門市,鮭魚兔*1,0,2000✅（68968）,60✅,1419,581,,
貢茶,蔡佳恩,989208030,新國門市,鮭魚兔*1,0,1650✅(04586),,1419,231,,退錢
勞倫斯,,,,大烏龜,,1914,,1720,194,,
湘,,,,碎耳兔吊飾,,1141,,1075,66,,
淋浴間,,,,蛋糕兔、可頌吊飾,,,,1720,-1720,,
甜點店,,,,可頌吊飾,,,,,0,,
雨咩咩,游芷亭,909873177,中棲門市,鮭魚兔*1,1000✅(16910),2000,,1419,581,,
蕎,張瑞原,938660554,勤學門市,鮭魚兔*1三色兔各1,0,6500✅(44023),,1419,581,,
XIAN,,,,狗*1,,1800,,1300,500,,
孫,,,,小兔子,,,,989,-989,,
徐莉緹,徐珮晴,910492088,鹿港福鹿店,鮭魚兔*3石頭人*1三色兔各2,12000✅(61099）,17600,,4257,13343,,
雅貽,張雅貽,976164522,大約門市,鮭魚兔*1、藍兔子*1,2125✅ (55176）,4250,,3397,853,,
倫敦面交仔,,,,鮭魚兔*1,,1900✅,,1419,481,,
Chian ,,,寄編,藍色兔*2,0,3000✅,,2150,850,,
珊珊Teresa ,蕭珊珊,961300663,大東園門市,綠*1藍*1,0,3000,,,,,
Rei,林語宸,934081298,國光（大里）,藍*2粉*1綠*2,0,7500,,,,,
孜孜,賴盈孜,928989984,維樂,粉*1藍*1,1500,3000,,,,,
Subway,一中街,,送店,藍*3綠*3粉*3天空龍吊飾*5拿鐵碎花吊飾*2,13500,22850,,,,,
Bonjour K,高麗玲,911830619,新真理,藍*1綠1,1500,3000,,,,,
Mandy,吳柏萱,963266233,向心,藍*1,750,1500,,,,,
金重佳蓉,鍾佳蓉,937332658,鳳新門市,三色兔各1波斯貓*1,6500,6500,,,,,`;

let pendingImportData = null;

const importCsvBtn = document.getElementById('import-csv-btn');
if (importCsvBtn) {
  importCsvBtn.addEventListener('click', () => {
    openModal('csv-modal');
  });
}

const quickImportBuiltinBtn = document.getElementById('quick-import-builtin-csv-btn');
if (quickImportBuiltinBtn) {
  quickImportBuiltinBtn.addEventListener('click', () => {
    const parsed = parseCsvData(BUILTIN_CSV_DATA);
    displayCsvPreview(parsed, '《英國代購 - 工作表1.csv》');
  });
}

const csvDropZone = document.getElementById('csv-drop-zone');
const csvFileInput = document.getElementById('csv-file-input');
if (csvDropZone && csvFileInput) {
  csvDropZone.addEventListener('click', () => csvFileInput.click());
  csvDropZone.addEventListener('dragover', e => { e.preventDefault(); csvDropZone.style.borderColor = 'var(--purple)'; });
  csvDropZone.addEventListener('dragleave', () => { csvDropZone.style.borderColor = 'rgba(255,255,255,0.15)'; });
  csvDropZone.addEventListener('drop', e => {
    e.preventDefault();
    csvDropZone.style.borderColor = 'rgba(255,255,255,0.15)';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleCsvFile(e.dataTransfer.files[0]);
    }
  });
  csvFileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleCsvFile(e.target.files[0]);
    }
  });
}

function handleCsvFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const content = e.target.result;
    const parsed = parseCsvData(content);
    displayCsvPreview(parsed, file.name);
  };
  reader.readAsText(file, 'utf-8');
}

function parseCsvData(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return { orders: [], buyers: [], products: [] };

  const parsedBuyers = [];
  const parsedOrders = [];
  const parsedProducts = [];

  for (let idx = 1; idx < lines.length; idx++) {
    const row = splitCsvLine(lines[idx]);
    if (!row || row.length < 5) continue;

    const lineName = (row[0] || '').trim();
    const realName = (row[1] || '').trim();
    const buyerDisplayName = realName || lineName || `買家_${idx}`;
    let phone = (row[2] || '').trim();
    if (phone && phone.length === 9 && phone.startsWith('9')) {
      phone = '0' + phone;
    }
    const store = (row[3] || '').trim();
    const rawItems = (row[4] || '').trim();
    const depositStr = (row[5] || '').trim();
    const priceStr = (row[6] || '').trim();
    const shipStr = (row[7] || '').trim();
    const costNote = (row[8] || '').trim();
    const extraNotes = [(row[9] || '').trim(), (row[10] || '').trim(), (row[11] || '').trim()].filter(Boolean).join(' · ');

    // 1. Buyer
    let buyer = parsedBuyers.find(b => (phone && b.phone === phone) || b.name === buyerDisplayName);
    if (!buyer) {
      buyer = {
        id: 'buyer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: buyerDisplayName,
        phone: phone,
        contact: lineName ? `@${lineName}` : phone,
        address: store,
        notes: (lineName && lineName !== realName) ? `LINE: ${lineName}` : '',
        createdAt: Date.now()
      };
      parsedBuyers.push(buyer);
    }

    // 2. Items
    const items = parseCsvItems(rawItems);
    items.forEach(it => {
      if (!parsedProducts.some(p => p.name === it.name && p.variant === it.variant)) {
        parsedProducts.push({
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          name: it.name,
          variant: it.variant,
          gbp: it.gbp || 30,
          costGbp: it.costGbp || it.gbp || 30,
          twd: it.twd || Math.round((it.gbp || 30) * (settings.quoteRate || 50)),
          notes: '由 CSV 匯入自動建立',
          createdAt: Date.now()
        });
      }
    });

    // 3. Price & Deposit & Payment
    const depNumMatch = depositStr.match(/(\d+)/);
    const deposit = depNumMatch ? parseInt(depNumMatch[1], 10) : 0;
    const priceNumMatch = priceStr.match(/(\d+)/);
    const totalPrice = priceNumMatch ? parseInt(priceNumMatch[1], 10) : items.reduce((s, i) => s + (i.twd || 0) * (i.qty || 1), 0);

    let payment = 'unpaid';
    if (priceStr.includes('✅') || (deposit >= totalPrice && totalPrice > 0)) {
      payment = 'paid';
    } else if (deposit > 0) {
      payment = 'deposit';
    }

    // 4. Notes & Remittance info
    const remMatch = depositStr.match(/[（(](\d+)[）)]/) || priceStr.match(/[（(](\d+)[）)]/);
    const notesArr = [];
    if (remMatch) notesArr.push(`末五碼 ${remMatch[1]}`);
    if (shipStr) notesArr.push(`運費 ${shipStr}`);
    if (costNote && costNote.includes('暫時取消')) notesArr.push('暫時取消');
    if (extraNotes) notesArr.push(extraNotes);

    parsedOrders.push({
      id: 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      buyerId: buyer.id,
      buyerName: buyer.name,
      buyerPhone: buyer.phone,
      items: items,
      totalPrice: totalPrice,
      status: costNote.includes('暫時取消') ? 'cancelled' : 'pending',
      payment: payment,
      deposit: deposit,
      notes: notesArr.join(' · '),
      createdAt: Date.now()
    });
  }

  return { buyers: parsedBuyers, orders: parsedOrders, products: parsedProducts };
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsvItems(raw) {
  if (!raw) return [{ name: '代購商品', variant: '', gbp: 30, costGbp: 30, twd: 1500, qty: 1 }];
  const items = [];
  const segments = raw.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);

  segments.forEach(seg => {
    const subMatches = seg.match(/([^\d*xX×各]+)(?:[*xX×各]\s*(\d+))?/g);
    if (subMatches && subMatches.length > 0) {
      subMatches.forEach(sm => {
        let qty = 1;
        const qm = sm.match(/[*xX×各]\s*(\d+)/);
        if (qm) qty = parseInt(qm[1], 10) || 1;
        let clean = sm.replace(/[*xX×各]\s*\d+/, '').trim();
        if (clean) {
          let variant = '';
          const varMatch = clean.match(/[（(]([^）)]+)[）)]/);
          if (varMatch) {
            variant = varMatch[1].trim();
            clean = clean.replace(/[（(][^）)]+[）)]/, '').trim();
          }
          if (clean === '綠') { clean = '邦尼兔'; variant = '綠色'; }
          else if (clean === '藍') { clean = '邦尼兔'; variant = '藍色'; }
          else if (clean === '粉') { clean = '邦尼兔'; variant = '粉色'; }
          else if (clean === '狗') { clean = '小狗'; }

          // Check if already in products library
          const matchedP = products.find(p => p.name === clean && (!variant || p.variant === variant));
          const quoteRate = settings.quoteRate || 50;
          const gbp = matchedP ? matchedP.gbp : 30;
          const costGbp = matchedP ? (matchedP.costGbp || matchedP.gbp) : 25;
          const twd = matchedP ? matchedP.twd : Math.round(gbp * quoteRate);

          items.push({
            productId: matchedP ? matchedP.id : null,
            name: clean,
            variant: variant,
            gbp: gbp,
            costGbp: costGbp,
            twd: twd,
            qty: qty
          });
        }
      });
    } else {
      items.push({ name: seg, variant: '', gbp: 30, costGbp: 25, twd: 1500, qty: 1 });
    }
  });

  return items.length > 0 ? items : [{ name: raw, variant: '', gbp: 30, costGbp: 25, twd: 1500, qty: 1 }];
}

function displayCsvPreview(parsed, filename) {
  pendingImportData = parsed;
  const container = document.getElementById('csv-preview-container');
  const statsSummary = document.getElementById('csv-stats-summary');
  const previewList = document.getElementById('csv-preview-list');

  if (!container || !parsed.orders.length) {
    showToast('未能成功解析 CSV 資料，請確認檔案格式');
    return;
  }

  container.style.display = 'block';

  const totalRev = parsed.orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
  const totalDep = parsed.orders.reduce((s, o) => s + (o.deposit || 0), 0);

  statsSummary.innerHTML = `
    <div class="detail-stat-box"><span class="stat-num" style="color:var(--purple-light)">${parsed.orders.length}</span><span class="stat-lbl">解析訂單</span></div>
    <div class="detail-stat-box"><span class="stat-num" style="color:var(--blue)">${parsed.buyers.length}</span><span class="stat-lbl">買家名單</span></div>
    <div class="detail-stat-box"><span class="stat-num" style="color:var(--green)">NT$${totalRev.toLocaleString()}</span><span class="stat-lbl">訂單總額</span></div>
  `;

  previewList.innerHTML = parsed.orders.map((o, i) => {
    const itemTags = o.items.map(it => `${escapeHtml(it.name)}${it.variant ? `(${escapeHtml(it.variant)})` : ''} ×${it.qty}`).join('、');
    return `
      <div style="background:var(--bg2);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:10px 12px;font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:800;color:var(--text)">${i + 1}. 👤 ${escapeHtml(o.buyerName)} ${o.buyerPhone ? `<span style="color:var(--text-muted);font-weight:600">(${escapeHtml(o.buyerPhone)})</span>` : ''}</span>
          <span class="badge ${o.payment}">${paymentLabel(o.payment)}</span>
        </div>
        <div style="color:var(--text-muted);margin-bottom:4px">🛍️ ${itemTags}</div>
        <div style="display:flex;justify-content:space-between;color:var(--text-dim);font-size:11px">
          <span>售價 NT$${o.totalPrice.toLocaleString()}${o.deposit > 0 ? ` (訂金 NT$${o.deposit.toLocaleString()})` : ''}</span>
          <span>${o.notes ? `📝 ${escapeHtml(o.notes)}` : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  showToast(`已成功解析 ${parsed.orders.length} 筆訂單，請確認後點擊「確認匯入」！`);
}

const confirmImportBtn = document.getElementById('confirm-import-csv-btn');
if (confirmImportBtn) {
  confirmImportBtn.addEventListener('click', async () => {
    if (!pendingImportData || !pendingImportData.orders.length) return;

    confirmImportBtn.disabled = true;
    confirmImportBtn.textContent = '⏳ 正在匯入資料…';

    try {
      // 1. Save Products
      for (const p of pendingImportData.products) {
        if (!products.some(x => x.name === p.name && x.variant === p.variant)) {
          await saveProduct(p);
        }
      }

      // 2. Save Buyers
      const buyerIdMap = {};
      for (const b of pendingImportData.buyers) {
        let existing = buyers.find(x => (b.phone && x.phone === b.phone) || x.name === b.name);
        if (existing) {
          buyerIdMap[b.id] = existing.id;
        } else {
          const newId = await saveBuyer(b);
          buyerIdMap[b.id] = newId || b.id;
        }
      }

      // 3. Save Orders
      for (const o of pendingImportData.orders) {
        const actualBuyerId = buyerIdMap[o.buyerId] || o.buyerId;
        const mappedItems = o.items.map(it => {
          const matchedP = products.find(p => p.name === it.name && p.variant === it.variant);
          return {
            productId: matchedP ? matchedP.id : null,
            name: it.name,
            variant: it.variant,
            gbp: matchedP ? matchedP.gbp : (it.gbp || 30),
            costGbp: matchedP ? (matchedP.costGbp || matchedP.gbp) : (it.costGbp || 25),
            twd: it.twd || Math.round((it.gbp || 30) * (settings.quoteRate || 50)),
            qty: it.qty || 1
          };
        });

        const newOrder = {
          id: o.id || Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
          buyerId: actualBuyerId,
          items: mappedItems,
          status: o.status || 'pending',
          payment: o.payment || 'unpaid',
          deposit: o.deposit || 0,
          notes: o.notes || '',
          createdAt: Date.now()
        };

        await saveOrder(newOrder);
      }

      saveLocalData();
      renderAll();
      closeModal('csv-modal');
      showToast(`🎉 成功匯入 ${pendingImportData.orders.length} 筆代購單與 ${pendingImportData.buyers.length} 位買家！`);
    } catch (err) {
      console.error('Import CSV error:', err);
      showToast(`匯入時發生錯誤：${err.message}`);
    } finally {
      confirmImportBtn.disabled = false;
      confirmImportBtn.textContent = '確認匯入資料';
    }
  });
}
