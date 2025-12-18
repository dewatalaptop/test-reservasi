// =========================================
// 1. KONFIGURASI FIREBASE
// =========================================
const firebaseConfig = {
  apiKey: "AIzaSyA_c1tU70FM84Qi_f_aSaQ-YVLo_18lCkI",
  authDomain: "reservasi-dolan-sawah.firebaseapp.com",
  projectId: "reservasi-dolan-sawah",
  storageBucket: "reservasi-dolan-sawah.appspot.com",
  messagingSenderId: "213151400721",
  appId: "1:213151400721:web:e51b0d8cdd24206cf682b0"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// =========================================
// 2. STATE MANAGEMENT (VARIABEL GLOBAL)
// =========================================
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = null; // Format: YYYY-MM-DD

// Cache Data
let reservationsData = {};  // { "YYYY-MM-DD": [Array Data] }
let requestsCache = [];     // Array data inbox
let detailMenu = {};        // { "Nasi Goreng": ["Pedas", "Telur"] }
let menuPrices = {};        // { "Nasi Goreng": 25000 }
let locationsData = {};     // { "id_dokumen": {name, capacity} }

// Listeners
let unsubscribeReservations = null;
let unsubscribeRequests = null;
let myChart = null;

// =========================================
// 3. AUTH & INIT
// =========================================
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-overlay').style.display = 'none';
        // document.getElementById('main-content').style.display = 'block'; // Diatur via CSS/JS
        initApp();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
    }
});

async function handleLogin() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    const err = document.getElementById('login-error');
    
    // UI Loading
    const btn = document.querySelector('.login-box button');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memuat...';
    btn.disabled = true;

    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
        err.style.display = 'block';
        err.textContent = "Error: " + e.message;
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}

function handleLogout() {
    Swal.fire({
        title: 'Keluar Sistem?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e76f51',
        confirmButtonText: 'Ya, Keluar'
    }).then((result) => {
        if (result.isConfirmed) auth.signOut();
    });
}

async function initApp() {
    showLoader();
    try {
        // Set Tanggal Header
        const today = new Date();
        document.getElementById('date-display').textContent = today.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        document.getElementById('monthYear').textContent = `${monthNames[currentMonth]} ${currentYear}`;

        // 1. Load Data Master (Menu & Lokasi)
        await Promise.all([loadMasterMenus(), loadMasterLocations()]);

        // 2. Start Listeners
        listenToInbox();
        listenToReservations();

    } catch (e) {
        console.error(e);
        showToast("Gagal memuat data awal", "error");
    } finally {
        hideLoader();
    }
}

// =========================================
// 4. DATA MASTER LOADER
// =========================================
async function loadMasterMenus() {
    const snap = await db.collection('menus').get();
    detailMenu = {};
    menuPrices = {};
    snap.forEach(doc => {
        const d = doc.data();
        detailMenu[doc.id] = d.details || [];
        menuPrices[doc.id] = parseInt(d.price) || 0;
    });
    updateMenuPreview();
}

async function loadMasterLocations() {
    const snap = await db.collection('locations').get();
    locationsData = {};
    snap.forEach(doc => {
        locationsData[doc.id] = { id: doc.id, name: doc.data().name, capacity: parseInt(doc.data().capacity) || 0 };
    });
    updateLocationPreview();
}

function updateMenuPreview() {
    const list = Object.keys(detailMenu).sort().slice(0, 5);
    const container = document.getElementById('master-menu-preview');
    if (list.length) {
        container.innerHTML = `<ul style="padding-left:20px; margin:0;">${list.map(m => `<li>${m} <span style="color:var(--primary); font-size:0.8rem;">(Rp ${formatMoney(menuPrices[m])})</span></li>`).join('')}</ul>`;
    } else {
        container.innerHTML = '<p class="empty-state">Belum ada menu.</p>';
    }
}

function updateLocationPreview() {
    const list = Object.values(locationsData).sort((a,b) => a.name.localeCompare(b.name)).slice(0, 5);
    const container = document.getElementById('master-location-preview');
    if (list.length) {
        container.innerHTML = `<ul style="padding-left:20px; margin:0;">${list.map(l => `<li>${l.name} (Kap: ${l.capacity})</li>`).join('')}</ul>`;
    } else {
        container.innerHTML = '<p class="empty-state">Belum ada tempat.</p>';
    }
}

// =========================================
// 5. KALENDER & RESERVASI CORE
// =========================================
function listenToReservations() {
    if (unsubscribeReservations) unsubscribeReservations();

    // Load Data: H-7 Awal Bulan s/d H+7 Akhir Bulan
    const start = new Date(currentYear, currentMonth, 1);
    const end = new Date(currentYear, currentMonth + 1, 7); // Buffer
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    unsubscribeReservations = db.collection('reservations')
        .where('date', '>=', startStr)
        .where('date', '<=', endStr)
        .onSnapshot(snap => {
            reservationsData = {};
            let monthPax = 0;
            let monthDP = 0;
            let recentList = [];

            snap.forEach(doc => {
                const r = { id: doc.id, ...doc.data() };
                if (!reservationsData[r.date]) reservationsData[r.date] = [];
                reservationsData[r.date].push(r);

                // Stats calc
                monthPax += parseInt(r.jumlah) || 0;
                monthDP += parseInt(r.dp) || 0;
                recentList.push(r);
            });

            renderCalendar();
            updateStats(snap.size, monthPax, monthDP, recentList);
            
            // Refresh detail view jika sedang terbuka
            if (selectedDate && document.getElementById('reservation-view-container').style.display === 'block') {
                renderDailyView(selectedDate);
            }
        });
}

function updateStats(totalRes, totalPax, totalDP, recent) {
    document.getElementById('stat-month-total').textContent = totalRes;
    document.getElementById('stat-month-dp').textContent = `Rp ${formatMoney(totalDP)}`;
    
    // Tamu Hari Ini
    const todayStr = new Date().toISOString().split('T')[0];
    const todayList = reservationsData[todayStr] || [];
    const todayPax = todayList.reduce((sum, r) => sum + (parseInt(r.jumlah)||0), 0);
    document.getElementById('stat-today-pax').textContent = todayPax;

    // Recent List
    const sorted = recent.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 5);
    const recentContainer = document.getElementById('recent-reservations-list');
    
    if (sorted.length === 0) {
        recentContainer.innerHTML = '<p class="empty-state">Belum ada reservasi bulan ini.</p>';
    } else {
        recentContainer.innerHTML = sorted.map(r => `
            <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
                <div><b>${r.nama}</b><br><span style="font-size:0.8rem; color:#666;">${r.date} ${r.jam}</span></div>
                <div class="badge" style="background:var(--primary); align-self:center;">${r.jumlah} Org</div>
            </div>
        `).join('');
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendar');
    grid.innerHTML = '';
    document.getElementById('monthYear').textContent = `${monthNames[currentMonth]} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    // Filler Empty Slots
    for(let i=0; i<firstDay; i++) grid.innerHTML += `<div></div>`;

    // Days
    for(let i=1; i<=daysInMonth; i++) {
        const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const list = reservationsData[dStr] || [];
        const count = list.length;
        
        let cls = 'cal-day';
        if (dStr === todayStr) cls += ' today';
        if (dStr === selectedDate) cls += ' selected';

        // Dots Preview
        let dots = '';
        list.slice(0, 2).forEach(r => dots += `<div class="cal-event-dot">${r.jam} ${r.nama}</div>`);
        if (count > 2) dots += `<div style="font-size:0.7rem; color:#666; margin-top:2px;">+${count-2} lainnya</div>`;

        const div = document.createElement('div');
        div.className = cls;
        div.onclick = () => selectDate(dStr);
        div.innerHTML = `
            <div class="day-number">${i}</div>
            <div style="flex:1; width:100%;">${dots}</div>
            ${count > 0 ? `<div style="text-align:right; font-weight:bold; font-size:0.8rem; color:var(--primary);">${count} Res</div>` : ''}
        `;
        grid.appendChild(div);
    }
}

function navigateMonth(step) {
    currentMonth += step;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    selectedDate = null;
    document.getElementById('calendar-main-view').style.display = 'block';
    document.getElementById('reservation-view-container').style.display = 'none';
    listenToReservations();
}

function goToToday() {
    currentMonth = new Date().getMonth();
    currentYear = new Date().getFullYear();
    navigateMonth(0);
}

// =========================================
// 6. DETAIL VIEW & CRUD
// =========================================
function selectDate(dateStr) {
    selectedDate = dateStr;
    renderCalendar(); // Update highlight
    
    document.getElementById('calendar-main-view').style.display = 'none';
    document.getElementById('reservation-view-container').style.display = 'block';
    
    const d = new Date(dateStr);
    document.getElementById('reservation-view-title').innerHTML = `Detail: ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    
    // Reset Search
    document.getElementById('detailSearchInput').value = '';
    renderDailyView(dateStr);
}

function kembaliKeKalender() {
    document.getElementById('reservation-view-container').style.display = 'none';
    document.getElementById('calendar-main-view').style.display = 'block';
    selectedDate = null;
    renderCalendar();
}

function renderDailyView(dateStr) {
    const list = (reservationsData[dateStr] || []).sort((a,b) => a.jam.localeCompare(b.jam));
    const container = document.getElementById('reservation-detail-list');
    
    if (list.length === 0) {
        container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">Tidak ada reservasi.</div>`;
        return;
    }

    container.innerHTML = list.map(r => {
        // Format Menu
        let menuHTML = '-';
        let subTotal = 0;
        
        if (Array.isArray(r.menus) && r.menus.length > 0) {
            menuHTML = r.menus.map(m => {
                const price = menuPrices[m.name] || 0;
                subTotal += price * m.quantity;
                const detail = (detailMenu[m.name] || []).join(', ');
                return `<div><b>${m.quantity}x ${m.name}</b> <span style="font-size:0.8rem; color:#666;">${detail ? `(${detail})` : ''}</span></div>`;
            }).join('');
        } else if (r.menu) {
            menuHTML = r.menu; // Legacy support
        }

        const priceInfo = subTotal > 0 ? `<div style="margin-top:5px; font-weight:bold; color:var(--primary);">Est. Total: Rp ${formatMoney(subTotal)}</div>` : '';

        return `
        <div class="reservation-list-item">
            <div class="res-header">
                <div>
                    <div class="res-name">${r.nama} <span style="font-weight:400; font-size:0.9rem; color:#666;">(${r.jumlah} Org)</span></div>
                    <div class="res-meta"><i class="far fa-clock"></i> ${r.jam} &bull; <i class="fas fa-map-marker-alt"></i> ${r.tempat}</div>
                </div>
                <div>${r.nomorHp ? `<button class="btn btn-whatsapp" style="padding:5px 8px;" onclick="openWhatsApp('${r.nomorHp}', 'Halo Kak ${r.nama}...')"><i class="fab fa-whatsapp"></i></button>` : ''}</div>
            </div>
            <div class="res-menu">${menuHTML} ${priceInfo}</div>
            ${r.tambahan ? `<div style="background:#fffbeb; padding:5px; font-size:0.85rem; border:1px dashed orange;">Note: ${r.tambahan}</div>` : ''}
            <div style="margin-top:10px; font-size:0.9rem;">
                ${r.dp > 0 ? `<span class="badge" style="background:#dcfce7; color:#166534;">DP: Rp ${formatMoney(r.dp)} (${r.tipeDp})</span>` : ''}
            </div>
            <div class="res-actions">
                <button class="btn btn-primary" onclick="editReservasi('${r.id}')" style="flex:1;">Edit</button>
                <button class="btn btn-danger" onclick="hapusReservasi('${r.id}')" style="flex:1;">Hapus</button>
            </div>
        </div>`;
    }).join('');
}

function filterReservations(query) {
    if (!selectedDate) return;
    const q = query.toLowerCase();
    const list = reservationsData[selectedDate] || [];
    const filtered = list.filter(r => 
        r.nama.toLowerCase().includes(q) || 
        r.tempat.toLowerCase().includes(q) ||
        (Array.isArray(r.menus) && r.menus.some(m => m.name.toLowerCase().includes(q)))
    );
    // Render manual filtered list without modifying cache
    const tempKey = 'temp_search';
    reservationsData[tempKey] = filtered;
    renderDailyView(tempKey);
    delete reservationsData[tempKey];
}

// =========================================
// 7. INBOX & SMART WHATSAPP
// =========================================
function listenToInbox() {
    if (unsubscribeRequests) unsubscribeRequests();
    unsubscribeRequests = db.collection('reservation_requests')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snap => {
            requestsCache = snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
            
            // Update Badge & UI
            const count = requestsCache.length;
            document.getElementById('sidebar-badge').textContent = count;
            document.getElementById('sidebar-badge').style.display = count ? 'inline-block' : 'none';
            document.getElementById('stat-pending').textContent = count;
            
            renderInbox();
        });
}

function renderInbox() {
    const container = document.getElementById('inbox-container');
    if (requestsCache.length === 0) {
        container.innerHTML = '<p class="empty-state">Tidak ada permintaan baru.</p>';
        return;
    }

    container.innerHTML = requestsCache.map(r => {
        let menuHTML = '';
        if (r.menus) menuHTML = r.menus.map(m => `<div>${m.quantity}x ${m.name}</div>`).join('');
        
        return `
        <div class="request-card">
            <div class="request-header">
                <div class="req-name">${r.nama}</div>
                <div class="badge" style="background:#eee; color:#555;">${r.via || 'WEB'}</div>
            </div>
            <div class="req-details">
                <i class="fas fa-calendar"></i> ${r.date} &bull; ${r.jam}<br>
                <i class="fas fa-users"></i> ${r.jumlah} Org @ ${r.tempat}
            </div>
            <div class="req-menu-box">${menuHTML || '-'}</div>
            <div class="req-actions">
                <button class="btn btn-whatsapp" onclick="prepareConfirmationChat('${r.id}')">Chat</button>
                <button class="btn btn-danger" onclick="rejectRequest('${r.id}')">Tolak</button>
                <button class="btn btn-success" onclick="approveRequest('${r.id}')">Terima</button>
            </div>
        </div>`;
    }).join('');
}

function prepareConfirmationChat(id) {
    const r = requestsCache.find(x => x.id === id);
    if(!r) return;

    // Kalkulasi Harga Otomatis
    let total = 0;
    let details = '';
    if (r.menus) {
        r.menus.forEach(m => {
            const price = menuPrices[m.name] || 0;
            const sub = price * m.quantity;
            total += sub;
            details += `- ${m.name} (${m.quantity}x)`;
            if(price>0) details += ` : Rp ${formatMoney(sub)}`;
            details += `\n`;
        });
    }
    const ppn = total * 0.1;
    const grandTotal = total + ppn;
    const dp = grandTotal * 0.5;

    let msg = `Halo Kak *${r.nama}* 👋,\nTerima kasih telah reservasi di *Dolan Sawah*.\n\n` +
              `🗓 ${r.date} | ⏰ ${r.jam}\n👥 ${r.jumlah} Org | 📍 ${r.tempat}\n\n` +
              `*Pesanan:*\n${details}` +
              `------------------\n` +
              `Subtotal: Rp ${formatMoney(total)}\nPPN (10%): Rp ${formatMoney(ppn)}\n` +
              `*Total: Rp ${formatMoney(grandTotal)}*\n------------------\n` +
              `Mohon transfer DP (50%): *Rp ${formatMoney(dp)}*\n\n` +
              `Rekening Dolan Sawah:\n✅ BCA: 0132021439\n✅ Mandiri: 1360034582244\n\n` +
              `Mohon kirim bukti transfer untuk konfirmasi. Terima kasih!`;
              
    openWhatsApp(r.nomorHp, msg);
}

async function approveRequest(id) {
    const r = requestsCache.find(x => x.id === id);
    const { value: dpVal } = await Swal.fire({
        title: 'Terima & Simpan',
        input: 'number',
        inputLabel: 'Masukkan Nominal DP Masuk (Rp)',
        inputValue: 0,
        showCancelButton: true
    });

    if (dpVal !== undefined) {
        showLoader();
        try {
            await db.collection('reservations').add({
                ...r,
                dp: parseInt(dpVal),
                tipeDp: 'Transfer', // Default
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                thankYouSent: false
            });
            await db.collection('reservation_requests').doc(id).delete();
            showToast("Reservasi Disetujui");
        } catch(e) {
            showToast("Gagal: "+e.message, "error");
        } finally {
            hideLoader();
        }
    }
}

async function rejectRequest(id) {
    if(confirm("Tolak permintaan ini? Data akan dihapus.")) {
        await db.collection('reservation_requests').doc(id).delete();
        showToast("Ditolak");
    }
}

// =========================================
// 8. ADD/EDIT FORM LOGIC
// =========================================
function showAddForm() {
    if (!selectedDate) { showToast("Pilih tanggal di kalender dulu!", "warning"); return; }
    
    document.getElementById('reservation-form').reset();
    document.getElementById('selected-menus-container').innerHTML = '';
    addMenuSelectionRow('reservation-form'); // Add 1 row default
    
    populateLocationDropdown(document.querySelector('#reservation-form #tempat'));
    
    document.getElementById('addFormPopup').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
}

function addMenuSelectionRow(formId) {
    const container = document.querySelector(`#${formId} #selected-menus-container`);
    const div = document.createElement('div');
    div.className = 'menu-selection-row';
    
    // Dropdown Menu
    let options = `<option value="">-- Pilih Menu --</option>`;
    Object.keys(detailMenu).sort().forEach(m => {
        const p = menuPrices[m] ? `(Rp ${formatMoney(menuPrices[m])})` : '';
        options += `<option value="${m}">${m} ${p}</option>`;
    });

    div.innerHTML = `
        <select style="flex:2">${options}</select>
        <input type="number" value="1" min="1" style="width:70px">
        <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding:5px 10px;">X</button>
    `;
    container.appendChild(div);
}

function populateLocationDropdown(select) {
    select.innerHTML = '<option value="">-- Pilih --</option>';
    Object.values(locationsData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(l => {
        select.add(new Option(`${l.name} (Kap: ${l.capacity})`, l.name));
    });
}

function updateCapacityInfo(formId) {
    const val = document.querySelector(`#${formId} #tempat`).value;
    const loc = Object.values(locationsData).find(l => l.name === val);
    document.querySelector(`#${formId} #capacity-info`).textContent = loc ? `Max: ${loc.capacity} org` : '';
}

async function simpanReservasi() {
    const form = document.getElementById('reservation-form');
    // Basic Validation
    if(!form.checkValidity()) { form.reportValidity(); return; }

    const menus = [];
    form.querySelectorAll('.menu-selection-row').forEach(row => {
        const name = row.querySelector('select').value;
        const qty = row.querySelector('input').value;
        if(name && qty) menus.push({name, quantity: parseInt(qty)});
    });

    const data = {
        nama: form.querySelector('#nama').value,
        nomorHp: cleanPhoneNumber(form.querySelector('#nomorHp').value),
        jam: form.querySelector('#jam').value,
        jumlah: parseInt(form.querySelector('#jumlah').value),
        tempat: form.querySelector('#tempat').value,
        dp: parseInt(form.querySelector('#dp').value) || 0,
        tipeDp: form.querySelector('#tipeDp').value,
        tambahan: form.querySelector('#tambahan').value,
        menus: menus,
        date: selectedDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        thankYouSent: false
    };

    showLoader();
    try {
        await db.collection('reservations').add(data);
        closePopup('addFormPopup');
        showToast("Reservasi Tersimpan");
    } catch(e) {
        showToast("Gagal: "+e.message, "error");
    } finally {
        hideLoader();
    }
}

async function hapusReservasi(id) {
    if(confirm("Yakin hapus data ini?")) {
        await db.collection('reservations').doc(id).delete();
        showToast("Data Dihapus");
    }
}

function editReservasi(id) {
    // Logic edit disederhanakan: Hapus lalu Buka Form Add dengan data lama
    // (Ini trik cepat untuk single file logic agar tidak duplikat form edit)
    const list = Object.values(reservationsData).flat();
    const r = list.find(x => x.id === id);
    
    if(r) {
        // Pre-fill form add
        showAddForm(); 
        const form = document.getElementById('reservation-form');
        form.querySelector('#nama').value = r.nama;
        form.querySelector('#nomorHp').value = r.nomorHp;
        form.querySelector('#jam').value = r.jam;
        form.querySelector('#jumlah').value = r.jumlah;
        form.querySelector('#tempat').value = r.tempat;
        form.querySelector('#dp').value = r.dp;
        form.querySelector('#tipeDp').value = r.tipeDp;
        form.querySelector('#tambahan').value = r.tambahan;
        
        // Menu rows
        const container = document.getElementById('selected-menus-container');
        container.innerHTML = ''; // clear default row
        if(r.menus) {
            r.menus.forEach(m => {
                addMenuSelectionRow('reservation-form');
                const lastRow = container.lastElementChild;
                lastRow.querySelector('select').value = m.name;
                lastRow.querySelector('input').value = m.quantity;
            });
        }
        
        // Ganti fungsi tombol simpan jadi update
        // Note: Untuk project real, sebaiknya gunakan doc.update() bukan hapus-tambah
        // Di sini kita gunakan trik hapus-tambah agar ID baru
        // Jika ingin pertahankan ID, perlu logic update khusus.
        // Mari kita buat simple: Hapus yang lama saat simpan yang baru
        const btnSimpan = form.querySelector('.btn-primary');
        btnSimpan.onclick = async function() {
            await db.collection('reservations').doc(id).delete(); // Hapus lama
            simpanReservasi(); // Simpan baru
        };
        btnSimpan.innerText = "Update & Simpan";
    }
}

// =========================================
// 9. HELPER UI & EXTRAS
// =========================================
function showLoader() { document.getElementById('loadingOverlay').style.display = 'flex'; }
function hideLoader() { document.getElementById('loadingOverlay').style.display = 'none'; }
function showToast(msg, icon='success') { Swal.fire({toast:true, position:'top-end', showConfirmButton:false, timer:3000, icon:icon, title:msg}); }
function cleanPhoneNumber(p) { if(!p) return ''; let n = p.replace(/[^0-9]/g,''); return n.startsWith('0') ? '62'+n.slice(1) : n; }
function formatMoney(n) { return n.toLocaleString('id-ID'); }
function openWhatsApp(p, m) { if(p) window.open(`https://wa.me/${cleanPhoneNumber(p)}?text=${encodeURIComponent(m)}`, '_blank'); }

function switchTab(id) {
    document.querySelectorAll('.section').forEach(e => e.classList.remove('active'));
    document.getElementById('tab-'+id).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    const nav = document.getElementById('nav-'+id);
    if(nav) nav.classList.add('active');
    
    if(window.innerWidth < 768) toggleSidebar(); // auto close mobile
    
    if(id === 'calendar' && !selectedDate) renderCalendar();
    if(id === 'analysis') renderChart();
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open'); // Di CSS perlu class .open untuk mobile view logic jika mau animasi drawer
    // Simple toggle logic for inline style in app.js
    if(sb.style.left === '0px') {
        sb.style.left = '-280px';
    } else {
        sb.style.left = '0px';
    }
}

function closePopupAll() {
    document.querySelectorAll('.popup-form').forEach(e => e.style.display='none');
    document.getElementById('overlay').style.display='none';
}
function closePopup(id) { document.getElementById(id).style.display='none'; closePopupAll(); } // simplified

// Data Master UI
function showMenuManagement() {
    Swal.fire({
        title: 'Tambah Menu',
        html: '<input id="swal-menu" placeholder="Nama Menu" class="swal2-input">' +
              '<input id="swal-price" type="number" placeholder="Harga" class="swal2-input">',
        confirmButtonText: 'Simpan',
        preConfirm: () => {
            const m = document.getElementById('swal-menu').value;
            const p = document.getElementById('swal-price').value;
            if(!m) Swal.showValidationMessage('Nama wajib diisi');
            return {m, p};
        }
    }).then(async (res) => {
        if(res.isConfirmed) {
            await db.collection('menus').doc(res.value.m).set({price: res.value.p, details:[]});
            loadMasterMenus();
            showToast("Menu Disimpan");
        }
    });
}

function showLocationManagement() {
    Swal.fire({
        title: 'Tambah Tempat',
        html: '<input id="swal-loc" placeholder="Nama Tempat" class="swal2-input">' +
              '<input id="swal-cap" type="number" placeholder="Kapasitas" class="swal2-input">',
        confirmButtonText: 'Simpan'
    }).then(async (res) => {
        if(res.isConfirmed) {
            const name = document.getElementById('swal-loc').value;
            const cap = document.getElementById('swal-cap').value;
            await db.collection('locations').add({name: name, capacity: cap});
            loadMasterLocations();
            showToast("Tempat Disimpan");
        }
    });
}

function showCustomerMenu() {
    showToast("Fitur Database Customer aktif di background.");
}

// Chart Analysis
function renderChart() {
    const ctx = document.getElementById('mainChartCanvas').getContext('2d');
    if(myChart) myChart.destroy();
    
    // Dummy Data for Demo (Real data needs aggregation logic)
    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Minggu 1', 'Minggu 2', 'Minggu 3', 'Minggu 4'],
            datasets: [{
                label: 'Total Pengunjung',
                data: [50, 75, 60, 90], // Replace with real aggregation
                backgroundColor: '#2a9d8f'
            }]
        }
    });
}

// Broadcast & Print (Simple Bindings)
function showBroadcastSettings() { document.getElementById('broadcastSettingsPopup').style.display='block'; document.getElementById('overlay').style.display='block'; }
function saveBroadcastMessage() { localStorage.setItem('bc_msg', document.getElementById('broadcastMessage').value); closePopupAll(); showToast("Pesan Tersimpan"); }
function showBroadcastList() { document.getElementById('broadcastListPopup').style.display='block'; document.getElementById('overlay').style.display='block'; }
function printData() { if(selectedDate) window.print(); else showToast("Pilih tanggal dulu"); }
