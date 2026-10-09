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

// ⚠️ 請替換成你自己的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyPLACEHOLDER",
  authDomain: "jellycat-proxy.firebaseapp.com",
  projectId: "jellycat-proxy",
  storageBucket: "jellycat-proxy.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:placeholder"
};

// =============================================
// App State
// =============================================
let app, auth, db;
let currentUser = null;
let settings = { rate: 50, depositRatio: 30 };
let buyers = [];   // [{id, name, contact, phone, address, notes}]
let orders = [];   // [{id, buyerId, product, variant, gbp, twd, qty, status, payment, deposit, notes, createdAt}]
let unsubscribers = [];

// Active edit IDs
let editOrderId = null;
let editBuyerId = null;
let viewBuyerId = null;

// Current filter
let orderFilter = 'all';
let orderSearch = '';
let buyerSearch = '';

// =============================================
// Init Firebase (graceful fallback)
// =============================================
const isPlaceholderConfig = firebaseConfig.apiKey === 'AIzaSyPLACEHOLDER';
const isFileProtocol = location.protocol === 'file:';

if (isPlaceholderConfig || isFileProtocol) {
  // No real Firebase config yet → run demo mode
  console.info('Demo mode: placeholder config or file:// protocol detected.');
  // showDemoMode() will be called after DOM-ready listeners below
} else {
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
    console.warn('Firebase init failed, running in demo mode:', e.message);
  }
}

// =============================================
// Auth
// =============================================
const loginBtn = document.getElementById('google-login-btn');

// If demo/file mode: clicking login goes straight in
if (isPlaceholderConfig || isFileProtocol) {
  loginBtn.innerHTML = '🐰 直接進入（Demo 模式）';
  loginBtn.addEventListener('click', () => showDemoMode());
} else {
  loginBtn.addEventListener('click', async () => {
    if (!auth) { showDemoMode(); return; }
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span style="opacity:.6">登入中…</span>';
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      // Popup blocked or error → fall back to demo mode
      console.warn('signInWithPopup failed:', e.code, e.message);
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
        showToast('Popup 被封鎖，改用 Demo 模式');
      } else {
        showToast('登入失敗，進入 Demo 模式');
      }
      showDemoMode();
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> 使用 Google 帳號登入`;
    }
  });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (confirm('確定要登出嗎？')) {
    if (auth) await signOut(auth);
    else { showLogin(); }
  }
});

// =============================================
// Screen switching
// =============================================
function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
}
function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
}

function showDemoMode() {
  // Demo: auto-login without Firebase
  currentUser = { uid: 'demo', displayName: 'Demo User' };
  loadLocalData();
  showApp();
}

// =============================================
// Data: Firestore
// =============================================
function getUserPath(col) {
  return collection(db, 'users', currentUser.uid, col);
}

async function loadData() {
  // Settings
  const settingsRef = doc(db, 'users', currentUser.uid, 'settings', 'main');
  try {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'settings'));
    snap.forEach(d => { if (d.id === 'main') Object.assign(settings, d.data()); });
  } catch {}
  updateRateDisplay();

  // Real-time listeners
  const buyersQ = query(getUserPath('buyers'), orderBy('name'));
  const ordersQ = query(getUserPath('orders'), orderBy('createdAt', 'desc'));

  unsubscribers.push(onSnapshot(buyersQ, snap => {
    buyers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBuyers();
    renderDashboard();
    populateBuyerSelect();
  }));

  unsubscribers.push(onSnapshot(ordersQ, snap => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders();
    renderDashboard();
    renderPending();
  }));
}

async function saveBuyer(data) {
  const id = data.id || Date.now().toString();
  if (db) {
    await setDoc(doc(db, 'users', currentUser.uid, 'buyers', id), { ...data, id });
  } else {
    const idx = buyers.findIndex(b => b.id === id);
    if (idx >= 0) buyers[idx] = { ...data, id };
    else buyers.push({ ...data, id });
    saveLocalData();
    renderBuyers(); renderDashboard(); populateBuyerSelect();
  }
}

async function deleteBuyer(id) {
  if (db) {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'buyers', id));
  } else {
    buyers = buyers.filter(b => b.id !== id);
    saveLocalData();
    renderBuyers(); renderDashboard();
  }
}

async function saveOrder(data) {
  const id = data.id || Date.now().toString();
  if (!data.createdAt) data.createdAt = Date.now();
  if (db) {
    await setDoc(doc(db, 'users', currentUser.uid, 'orders', id), { ...data, id });
  } else {
    const idx = orders.findIndex(o => o.id === id);
    if (idx >= 0) orders[idx] = { ...data, id };
    else orders.unshift({ ...data, id });
    saveLocalData();
    renderOrders(); renderDashboard(); renderPending();
  }
}

async function deleteOrder(id) {
  if (db) {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'orders', id));
  } else {
    orders = orders.filter(o => o.id !== id);
    saveLocalData();
    renderOrders(); renderDashboard(); renderPending();
  }
}

async function saveSettings() {
  if (db) {
    await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), settings);
  } else {
    saveLocalData();
  }
}

// Local storage fallback
function loadLocalData() {
  try {
    const raw = localStorage.getItem('jc_data');
    if (raw) {
      const d = JSON.parse(raw);
      buyers = d.buyers || [];
      orders = d.orders || [];
      Object.assign(settings, d.settings || {});
    }
  } catch {}
  updateRateDisplay();
  renderAll();
}

function saveLocalData() {
  localStorage.setItem('jc_data', JSON.stringify({ buyers, orders, settings }));
}

function cleanup() {
  unsubscribers.forEach(u => u && u());
  unsubscribers = [];
  buyers = []; orders = [];
}

// =============================================
// Tab Navigation
// =============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
}
window.switchTab = switchTab;

// =============================================
// Settings
// =============================================
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('rate-input').value = settings.rate;
  document.getElementById('deposit-ratio-input').value = settings.depositRatio;
  document.getElementById('rate-hint').textContent = `目前設定：1 GBP = NT$${settings.rate}`;
  openModal('settings-modal');
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  settings.rate = parseFloat(document.getElementById('rate-input').value) || 50;
  settings.depositRatio = parseInt(document.getElementById('deposit-ratio-input').value) || 30;
  await saveSettings();
  updateRateDisplay();
  renderAll();
  closeModal('settings-modal');
  showToast('設定已儲存 ✅');
});

document.getElementById('fetch-rate-btn').addEventListener('click', async () => {
  const btn = document.getElementById('fetch-rate-btn');
  btn.textContent = '抓取中…';
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/GBP');
    const data = await resp.json();
    const rate = data.rates && data.rates.TWD;
    if (rate) {
      document.getElementById('rate-input').value = Math.round(rate * 10) / 10;
      document.getElementById('rate-hint').textContent = `即時匯率：1 GBP = NT$${Math.round(rate * 10) / 10}`;
      showToast(`抓到即時匯率 £1 = NT$${Math.round(rate * 10) / 10} 🎉`);
    } else throw new Error('no rate');
  } catch {
    showToast('抓取失敗，請手動輸入');
  }
  btn.textContent = '抓即時匯率';
});

function updateRateDisplay() {
  document.getElementById('rate-display').textContent = `💷 1 = NT$${settings.rate}`;
  document.getElementById('rate-hint').textContent = `目前設定：1 GBP = NT$${settings.rate}`;
  if (document.getElementById('rate-input'))
    document.getElementById('rate-input').value = settings.rate;
}

// =============================================
// Dashboard
// =============================================
function renderDashboard() {
  const totalRevenue = orders.reduce((s, o) => s + (o.twd || 0) * (o.qty || 1), 0);
  const totalCost = orders.reduce((s, o) => s + (o.gbp || 0) * settings.rate * (o.qty || 1), 0);
  const totalProfit = totalRevenue - totalCost;

  const totalPaid = orders.reduce((s, o) => {
    if (o.payment === 'paid') return s + (o.twd || 0) * (o.qty || 1);
    if (o.payment === 'deposit') return s + (parseFloat(o.deposit) || 0);
    return s;
  }, 0);
  const unpaid = totalRevenue - totalPaid;

  document.getElementById('stat-revenue').textContent = 'NT$' + totalRevenue.toLocaleString();
  document.getElementById('stat-profit').textContent = 'NT$' + Math.round(totalProfit).toLocaleString();
  document.getElementById('stat-unpaid').textContent = 'NT$' + Math.round(unpaid).toLocaleString();
  document.getElementById('stat-orders').textContent = orders.length;

  // Payment bar
  const paidCount = orders.filter(o => o.payment === 'paid').length;
  const depositCount = orders.filter(o => o.payment === 'deposit').length;
  const unpaidCount = orders.filter(o => o.payment === 'unpaid' || !o.payment).length;
  const total = orders.length || 1;
  document.getElementById('bar-paid').style.width = (paidCount / total * 100) + '%';
  document.getElementById('bar-deposit').style.width = (depositCount / total * 100) + '%';
  document.getElementById('bar-unpaid').style.width = (unpaidCount / total * 100) + '%';
  document.getElementById('count-paid').textContent = paidCount;
  document.getElementById('count-deposit').textContent = depositCount;
  document.getElementById('count-unpaid').textContent = unpaidCount;

  // Status chips
  document.getElementById('status-pending').textContent = orders.filter(o => o.status === 'pending' || !o.status).length;
  document.getElementById('status-ordered').textContent = orders.filter(o => o.status === 'ordered').length;
  document.getElementById('status-arrived').textContent = orders.filter(o => o.status === 'arrived').length;
  document.getElementById('status-shipped').textContent = orders.filter(o => o.status === 'shipped').length;

  // Recent orders (last 5)
  const recent = [...orders].slice(0, 5);
  const recentList = document.getElementById('recent-orders-list');
  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty-hint">尚無訂單</div>';
  } else {
    recentList.innerHTML = recent.map(o => {
      const buyer = buyers.find(b => b.id === o.buyerId);
      return `<div class="compact-item" onclick="openEditOrder('${o.id}')">
        <div class="compact-left">
          <div class="compact-name">${escapeHtml(o.product || '')}</div>
          <div class="compact-sub">${escapeHtml(buyer?.name || '未知買家')} · £${o.gbp || 0}</div>
        </div>
        <div class="compact-right">
          <div class="compact-price" style="color:var(--purple-light)">NT$${((o.twd || 0) * (o.qty || 1)).toLocaleString()}</div>
          <span class="compact-badge badge ${o.payment || 'unpaid'}">${paymentLabel(o.payment)}</span>
        </div>
      </div>`;
    }).join('');
  }
}

// =============================================
// Orders
// =============================================
function renderOrders() {
  const list = document.getElementById('orders-list');
  let filtered = orders.filter(o => {
    if (orderFilter !== 'all' && (o.status || 'pending') !== orderFilter) return false;
    if (orderSearch) {
      const buyer = buyers.find(b => b.id === o.buyerId);
      const q = orderSearch.toLowerCase();
      return (o.product || '').toLowerCase().includes(q) || (buyer?.name || '').toLowerCase().includes(q);
    }
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>${orders.length === 0 ? '還沒有訂單，點右上角新增！' : '沒有符合的訂單'}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(o => {
    const buyer = buyers.find(b => b.id === o.buyerId);
    const cost = (o.gbp || 0) * settings.rate * (o.qty || 1);
    const revenue = (o.twd || 0) * (o.qty || 1);
    const profit = revenue - cost;
    const profitColor = profit >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="order-card s-${o.status || 'pending'}" onclick="openEditOrder('${o.id}')">
      <div class="order-row1">
        <div class="order-product">${escapeHtml(o.product || '')}${o.variant ? ` <span style="color:var(--text-muted);font-size:12px">${escapeHtml(o.variant)}</span>` : ''}</div>
        <div class="order-price">NT$${revenue.toLocaleString()}</div>
      </div>
      <div class="order-row2">
        <div class="order-buyer">👤 ${escapeHtml(buyer?.name || '未知買家')}${(o.qty || 1) > 1 ? ` ×${o.qty}` : ''}</div>
        <div class="order-badges">
          <span class="badge ${o.status || 'pending'}">${statusLabel(o.status)}</span>
          <span class="badge ${o.payment || 'unpaid'}">${paymentLabel(o.payment)}</span>
        </div>
      </div>
      <div class="order-row3" style="display:flex;justify-content:space-between">
        <span class="order-gbp">£${o.gbp || 0} → 成本 NT$${Math.round(cost).toLocaleString()}</span>
        <span style="color:${profitColor};font-weight:800;font-size:11px">利潤 NT$${Math.round(profit).toLocaleString()}</span>
      </div>
      ${o.deposit && o.payment === 'deposit' ? `<div class="order-row3" style="color:var(--yellow)">💛 已付訂金 NT$${parseFloat(o.deposit).toLocaleString()}</div>` : ''}
      ${o.notes ? `<div class="order-row3" style="margin-top:4px">📝 ${escapeHtml(o.notes)}</div>` : ''}
    </div>`;
  }).join('');
}

// Filter chips
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    orderFilter = chip.dataset.filter;
    renderOrders();
  });
});

document.getElementById('order-search').addEventListener('input', e => {
  orderSearch = e.target.value;
  renderOrders();
});

// =============================================
// Buyers
// =============================================
function renderBuyers() {
  const list = document.getElementById('buyers-list');
  let filtered = buyers.filter(b => {
    if (!buyerSearch) return true;
    return (b.name || '').toLowerCase().includes(buyerSearch.toLowerCase());
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>${buyers.length === 0 ? '還沒有買家資料' : '沒有符合的買家'}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(b => {
    const buyerOrders = orders.filter(o => o.buyerId === b.id);
    const total = buyerOrders.reduce((s, o) => s + (o.twd || 0) * (o.qty || 1), 0);
    const paid = buyerOrders.reduce((s, o) => {
      if (o.payment === 'paid') return s + (o.twd || 0) * (o.qty || 1);
      if (o.payment === 'deposit') return s + (parseFloat(o.deposit) || 0);
      return s;
    }, 0);
    const owed = total - paid;
    return `<div class="buyer-card" onclick="openBuyerDetail('${b.id}')">
      <div class="buyer-avatar">${(b.name || '?')[0].toUpperCase()}</div>
      <div class="buyer-info">
        <div class="buyer-name">${escapeHtml(b.name || '')}</div>
        <div class="buyer-contact">${escapeHtml(b.contact || b.phone || '—')}</div>
      </div>
      <div class="buyer-stats">
        <div class="buyer-total">NT$${total.toLocaleString()}</div>
        <div class="buyer-orders">${buyerOrders.length} 筆${owed > 0 ? ` · 欠 NT$${owed.toLocaleString()}` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('buyer-search').addEventListener('input', e => {
  buyerSearch = e.target.value;
  renderBuyers();
});

// =============================================
// Pending Tab
// =============================================
function renderPending() {
  const pending = orders.filter(o => (o.status || 'pending') === 'pending');
  document.getElementById('pending-count').textContent = pending.length;
  const totalGbp = pending.reduce((s, o) => s + (o.gbp || 0) * (o.qty || 1), 0);
  document.getElementById('pending-gbp').textContent = '£' + totalGbp.toFixed(2);

  const list = document.getElementById('pending-list');
  if (pending.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><p>所有商品都已購買！</p></div>`;
    return;
  }

  // Group by buyer
  const grouped = {};
  pending.forEach(o => {
    const buyer = buyers.find(b => b.id === o.buyerId);
    const key = buyer?.name || '未知買家';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });

  list.innerHTML = Object.entries(grouped).map(([buyerName, items]) => `
    <div class="section-card" style="margin-bottom:12px">
      <div class="section-title">👤 ${escapeHtml(buyerName)}</div>
      ${items.map(o => `
        <div class="compact-item" onclick="openEditOrder('${o.id}')">
          <div class="compact-left">
            <div class="compact-name">${escapeHtml(o.product || '')}${o.variant ? ` (${escapeHtml(o.variant)})` : ''}</div>
            <div class="compact-sub">£${o.gbp || 0}${(o.qty || 1) > 1 ? ` ×${o.qty}` : ''} · NT$${((o.twd || 0) * (o.qty || 1)).toLocaleString()}</div>
          </div>
          <button class="add-btn" style="font-size:11px;padding:6px 12px" onclick="event.stopPropagation();quickUpdateStatus('${o.id}','ordered')">標記下單</button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function quickUpdateStatus(id, status) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  await saveOrder({ ...o, status });
  showToast('已更新為：' + statusLabel(status));
}
window.quickUpdateStatus = quickUpdateStatus;

// =============================================
// Populate buyer select in order form
// =============================================
function populateBuyerSelect() {
  const sel = document.getElementById('order-buyer');
  const current = sel.value;
  sel.innerHTML = '<option value="">-- 選擇買家 --</option>' +
    buyers.map(b => `<option value="${b.id}"${b.id === current ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('');
}

// =============================================
// Add / Edit Order Modal
// =============================================
document.getElementById('add-order-btn').addEventListener('click', () => openAddOrder());

function openAddOrder() {
  editOrderId = null;
  document.getElementById('order-modal-title').textContent = '📦 新增訂單';
  document.getElementById('order-buyer').value = '';
  document.getElementById('order-product').value = '';
  document.getElementById('order-variant').value = '';
  document.getElementById('order-gbp').value = '';
  document.getElementById('order-twd').value = '';
  document.getElementById('order-qty').value = 1;
  document.getElementById('order-status').value = 'pending';
  document.getElementById('order-payment').value = 'unpaid';
  document.getElementById('order-deposit').value = '';
  document.getElementById('order-notes').value = '';
  document.getElementById('delete-order-btn').style.display = 'none';
  document.getElementById('deposit-amount-group').style.display = 'none';
  updateOrderHints();
  populateBuyerSelect();
  openModal('order-modal');
}

function openEditOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  editOrderId = id;
  document.getElementById('order-modal-title').textContent = '✏️ 編輯訂單';
  populateBuyerSelect();
  document.getElementById('order-buyer').value = o.buyerId || '';
  document.getElementById('order-product').value = o.product || '';
  document.getElementById('order-variant').value = o.variant || '';
  document.getElementById('order-gbp').value = o.gbp || '';
  document.getElementById('order-twd').value = o.twd || '';
  document.getElementById('order-qty').value = o.qty || 1;
  document.getElementById('order-status').value = o.status || 'pending';
  document.getElementById('order-payment').value = o.payment || 'unpaid';
  document.getElementById('order-deposit').value = o.deposit || '';
  document.getElementById('order-notes').value = o.notes || '';
  document.getElementById('delete-order-btn').style.display = 'block';
  document.getElementById('deposit-amount-group').style.display = o.payment === 'deposit' ? 'block' : 'none';
  updateOrderHints();
  openModal('order-modal');
}
window.openEditOrder = openEditOrder;

// Live hints
function updateOrderHints() {
  const gbp = parseFloat(document.getElementById('order-gbp').value) || 0;
  const twd = parseFloat(document.getElementById('order-twd').value) || 0;
  const qty = parseInt(document.getElementById('order-qty').value) || 1;
  const cost = gbp * settings.rate * qty;
  const profit = twd * qty - cost;
  document.getElementById('order-cost-hint').textContent =
    `成本：NT$${Math.round(cost).toLocaleString()}（依匯率 £1=NT$${settings.rate}）`;
  document.getElementById('order-profit-hint').textContent =
    `利潤：NT$${Math.round(profit).toLocaleString()}`;
  document.getElementById('order-profit-hint').style.color =
    profit >= 0 ? 'var(--green)' : 'var(--red)';
}

['order-gbp', 'order-twd', 'order-qty'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateOrderHints);
});

// Auto-fill suggested price when GBP entered
document.getElementById('order-gbp').addEventListener('input', () => {
  const gbp = parseFloat(document.getElementById('order-gbp').value) || 0;
  if (gbp > 0 && !document.getElementById('order-twd').value) {
    const suggested = Math.ceil(gbp * 50 / 50) * 50; // round to 50
    document.getElementById('order-twd').value = suggested;
  }
  updateOrderHints();
});

document.getElementById('order-payment').addEventListener('change', e => {
  document.getElementById('deposit-amount-group').style.display =
    e.target.value === 'deposit' ? 'block' : 'none';
  if (e.target.value === 'deposit' && !document.getElementById('order-deposit').value) {
    const twd = parseFloat(document.getElementById('order-twd').value) || 0;
    const qty = parseInt(document.getElementById('order-qty').value) || 1;
    document.getElementById('order-deposit').value = Math.round(twd * qty * settings.depositRatio / 100);
  }
});

document.getElementById('save-order-btn').addEventListener('click', async () => {
  const buyerId = document.getElementById('order-buyer').value;
  const product = document.getElementById('order-product').value.trim();
  const gbp = parseFloat(document.getElementById('order-gbp').value);
  const twd = parseFloat(document.getElementById('order-twd').value);

  if (!buyerId) { showToast('請選擇買家'); return; }
  if (!product) { showToast('請填寫商品名稱'); return; }
  if (!gbp || !twd) { showToast('請填寫英鎊標價與售價'); return; }

  const data = {
    id: editOrderId || Date.now().toString(),
    buyerId,
    product,
    variant: document.getElementById('order-variant').value.trim(),
    gbp,
    twd,
    qty: parseInt(document.getElementById('order-qty').value) || 1,
    status: document.getElementById('order-status').value,
    payment: document.getElementById('order-payment').value,
    deposit: document.getElementById('order-deposit').value || '',
    notes: document.getElementById('order-notes').value.trim(),
    createdAt: editOrderId ? (orders.find(o => o.id === editOrderId)?.createdAt || Date.now()) : Date.now(),
  };

  await saveOrder(data);
  closeModal('order-modal');
  showToast(editOrderId ? '訂單已更新 ✅' : '訂單已新增 ✅');
});

document.getElementById('delete-order-btn').addEventListener('click', async () => {
  if (!editOrderId) return;
  if (!confirm('確定要刪除此訂單？')) return;
  await deleteOrder(editOrderId);
  closeModal('order-modal');
  showToast('訂單已刪除');
});

// =============================================
// Add / Edit Buyer Modal
// =============================================
document.getElementById('add-buyer-btn').addEventListener('click', openAddBuyer);

function openAddBuyer() {
  editBuyerId = null;
  document.getElementById('buyer-modal-title').textContent = '👤 新增買家';
  document.getElementById('buyer-name').value = '';
  document.getElementById('buyer-contact').value = '';
  document.getElementById('buyer-phone').value = '';
  document.getElementById('buyer-address').value = '';
  document.getElementById('buyer-notes').value = '';
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
  };

  await saveBuyer(data);
  closeModal('buyer-modal');
  showToast(editBuyerId ? '買家已更新 ✅' : '買家已新增 ✅');
});

document.getElementById('delete-buyer-btn').addEventListener('click', async () => {
  if (!editBuyerId) return;
  const hasOrders = orders.some(o => o.buyerId === editBuyerId);
  if (hasOrders) { showToast('此買家有訂單，無法刪除'); return; }
  if (!confirm('確定要刪除此買家？')) return;
  await deleteBuyer(editBuyerId);
  closeModal('buyer-modal');
  showToast('買家已刪除');
});

// =============================================
// Buyer Detail Modal
// =============================================
function openBuyerDetail(id) {
  const b = buyers.find(x => x.id === id);
  if (!b) return;
  viewBuyerId = id;
  document.getElementById('buyer-detail-name').textContent = '👤 ' + (b.name || '');

  const buyerOrders = orders.filter(o => o.buyerId === id);
  const total = buyerOrders.reduce((s, o) => s + (o.twd || 0) * (o.qty || 1), 0);
  const paid = buyerOrders.reduce((s, o) => {
    if (o.payment === 'paid') return s + (o.twd || 0) * (o.qty || 1);
    if (o.payment === 'deposit') return s + (parseFloat(o.deposit) || 0);
    return s;
  }, 0);
  const owed = total - paid;
  const profit = buyerOrders.reduce((s, o) => {
    return s + (o.twd || 0) * (o.qty || 1) - (o.gbp || 0) * settings.rate * (o.qty || 1);
  }, 0);

  document.getElementById('buyer-detail-body').innerHTML = `
    <div class="detail-info-grid">
      <div class="detail-info-card">
        <div class="detail-info-val purple">NT$${total.toLocaleString()}</div>
        <div class="detail-info-label">總售價</div>
      </div>
      <div class="detail-info-card">
        <div class="detail-info-val ${owed > 0 ? 'orange' : 'green'}">NT$${owed.toLocaleString()}</div>
        <div class="detail-info-label">${owed > 0 ? '尚欠金額' : '已全數付清'}</div>
      </div>
      <div class="detail-info-card">
        <div class="detail-info-val green">NT$${Math.round(profit).toLocaleString()}</div>
        <div class="detail-info-label">此買家利潤</div>
      </div>
      <div class="detail-info-card">
        <div class="detail-info-val">${buyerOrders.length}</div>
        <div class="detail-info-label">訂單數量</div>
      </div>
    </div>
    ${b.contact ? `<div class="detail-contact-row">📱 ${escapeHtml(b.contact)}</div>` : ''}
    ${b.phone ? `<div class="detail-contact-row">📞 ${escapeHtml(b.phone)}</div>` : ''}
    ${b.address ? `<div class="detail-contact-row">📍 ${escapeHtml(b.address)}</div>` : ''}
    ${b.notes ? `<div class="detail-contact-row">📝 ${escapeHtml(b.notes)}</div>` : ''}
    <button class="detail-edit-btn" onclick="closeModal('buyer-detail-modal');openEditBuyer('${id}')">✏️ 編輯買家資料</button>
    <div class="detail-subtitle">📦 訂單列表</div>
    ${buyerOrders.length === 0 ? '<div class="empty-hint">此買家尚無訂單</div>' :
      buyerOrders.map(o => `
        <div class="compact-item" onclick="closeModal('buyer-detail-modal');openEditOrder('${o.id}')">
          <div class="compact-left">
            <div class="compact-name">${escapeHtml(o.product || '')}${o.variant ? ` (${escapeHtml(o.variant)})` : ''}</div>
            <div class="compact-sub">£${o.gbp || 0} → NT$${((o.twd || 0) * (o.qty || 1)).toLocaleString()}</div>
          </div>
          <div class="compact-right">
            <span class="compact-badge badge ${o.payment || 'unpaid'}">${paymentLabel(o.payment)}</span>
          </div>
        </div>
      `).join('')
    }
  `;

  openModal('buyer-detail-modal');
}
window.openBuyerDetail = openBuyerDetail;

// =============================================
// Modal Utilities
// =============================================
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
window.closeModal = closeModal;

// Close buttons
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});

// Close overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// =============================================
// Helpers
// =============================================
function statusLabel(s) {
  return { pending: '待購', ordered: '已下單', arrived: '已到貨', shipped: '已出貨' }[s] || '待購';
}
function paymentLabel(p) {
  return { unpaid: '未付', deposit: '訂金', paid: '已付清' }[p] || '未付';
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function renderAll() {
  renderDashboard();
  renderOrders();
  renderBuyers();
  renderPending();
  populateBuyerSelect();
}
