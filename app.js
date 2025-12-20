// ============================================================================
// FILE: app.js
// BAGIAN 1: KONFIGURASI, AUTH (FIXED), NAVIGASI & DATA MASTER
// ============================================================================

/**
 * 1. KONFIGURASI FIREBASE
 * Pastikan konfigurasi ini sesuai dengan project Firebase Anda.
 */
const firebaseConfig = {
  apiKey: "AIzaSyA_c1tU70FM84Qi_f_aSaQ-YVLo_18lCkI",
  authDomain: "reservasi-dolan-sawah.firebaseapp.com",
  projectId: "reservasi-dolan-sawah",
  storageBucket: "reservasi-dolan-sawah.appspot.com",
  messagingSenderId: "213151400721",
  appId: "1:213151400721:web:e51b0d8cdd24206cf682b0"
};

// Inisialisasi Firebase (Safe Check)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); 
}

const db = firebase.firestore();
const auth = firebase.auth();

// Mengaktifkan persistensi login (agar tidak logout saat refresh)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.error);


/**
 * 2. VARIABEL GLOBAL (STATE MANAGEMENT)
 * Pusat penyimpanan data sementara agar aplikasi cepat dan reaktif.
 */

// Konstanta
const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// --- Cache Data Transaksi ---
let dataReservasi = {};       // Data Kalender (Key: "MM-DD", Value: Array)
let allReservationsList = []; // Flat list bulan aktif (Dashboard)
let requestsCache = [];       // Inbox Request
let allReservationsCache = null; // Cache Global untuk Analisis (Lazy Load)

// --- Cache Data Master (Penting untuk Print & WA) ---
let detailMenu = {};          // { "Paket G": ["Nasi", "Kakap", ...] }
let menuPrices = {};          // { "Paket G": 50000 }
let locationsData = {};       // { "Lantai 1": {capacity: 20} }

// --- State Navigasi & Kalender ---
let tanggalDipilih = '';      // Format "MM-DD"
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentSortMode = 'jam';  // Default sorting

// --- State Analisis Data ---
let analysisYear = new Date().getFullYear();
let analysisMonth = 'all'; 

// --- Listener Realtime ---
let unsubscribeReservations = null;
let unsubscribeRequests = null;

// --- State Fitur Tambahan ---
let hasAutoOpened = false;       // Deep link flag
let notificationInterval = null; // Interval notifikasi
let promoMessageCache = null;    
let allCustomersCache = [];      // Cache pelanggan unik

const BROADCAST_MESSAGE_KEY = 'dolanSawahBroadcastMessage'; 
const BG_STORAGE_KEY = 'dolanSawahBg'; 

// --- Referensi DOM Global ---
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');
const overlay = document.getElementById('overlay');


/**
 * 3. SISTEM OTENTIKASI (AUTH) - DENGAN PERBAIKAN TAMPILAN AWAL
 */
auth.onAuthStateChanged(user => {
    const loginContainer = document.getElementById('login-container');
    const appLayout = document.getElementById('app-layout');
    
    if (user) {
        // --- USER LOGIN ---
        console.log("Auth: User terhubung (" + user.email + ")");
        
        if(loginContainer) loginContainer.style.display = 'none';
        if(appLayout) {
            appLayout.style.display = 'flex'; // Menggunakan Flex agar layout stabil
            
            // --- FIX TAMPILAN AWAL ---
            // 1. Reset semua tab menjadi non-aktif
            document.querySelectorAll('.content-section').forEach(el => {
                el.classList.remove('active');
                el.style.display = 'none'; // Paksa sembunyi via inline style
            });
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            
            // 2. Paksa masuk ke Dashboard setelah jeda singkat (agar DOM siap)
            setTimeout(() => {
                switchTab('dashboard');
            }, 100);

            // 3. Efek Fade In Layout
            appLayout.style.opacity = 0;
            setTimeout(() => { 
                appLayout.style.transition = 'opacity 0.6s ease'; 
                appLayout.style.opacity = 1; 
            }, 50);
        }
        
        updateHeaderDate();
        applySavedBackground(); // Load background custom
        initializeApp();        // Mulai load data
        
    } else {
        // --- USER LOGOUT ---
        console.log("Auth: User logout");
        
        if(loginContainer) loginContainer.style.display = 'flex';
        if(appLayout) appLayout.style.display = 'none';
        cleanupApp();
    }
});

async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('login-error');
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  if (!email || !password) { 
      errorEl.textContent = 'Email dan password wajib diisi.'; 
      errorEl.style.display = 'block'; 
      return; 
  }
  
  showLoader();
  try { 
      await auth.signInWithEmailAndPassword(email, password); 
      emailInput.value = '';
      passwordInput.value = '';
      errorEl.style.display = 'none';
  } catch (err) { 
      console.error("Login Gagal:", err);
      let msg = 'Kredensial tidak valid.';
      if(err.code === 'auth/invalid-email') msg = 'Format email salah.';
      if(err.code === 'auth/user-not-found') msg = 'User tidak ditemukan.';
      if(err.code === 'auth/wrong-password') msg = 'Password salah.';
      errorEl.textContent = msg; 
      errorEl.style.display = 'block'; 
  } finally { 
      hideLoader(); 
  }
}

function handleLogout() { 
    Swal.fire({
        title: 'Keluar?',
        text: "Sesi Anda akan diakhiri.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Ya, Keluar'
    }).then((result) => {
        if (result.isConfirmed) {
            showLoader();
            auth.signOut().then(() => {
                hideLoader();
                showToast("Berhasil logout", "success");
            });
        }
    });
}

function cleanupApp() {
    if (notificationInterval) clearInterval(notificationInterval);
    if (unsubscribeReservations) unsubscribeReservations();
    if (unsubscribeRequests) unsubscribeRequests();
    
    dataReservasi = {};
    requestsCache = [];
    allReservationsList = [];
    allReservationsCache = null;
    currentSortMode = 'jam'; 
}


/**
 * 4. NAVIGASI UI (SIDEBAR & TABS) - MOBILE OPTIMIZED
 */
function switchTab(tabId) {
    // 1. Sembunyikan semua konten tab terlebih dahulu
    document.querySelectorAll('.content-section').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none'; // Penting untuk fix tampilan menumpuk
    });

    // 2. Tampilkan tab yang dipilih
    const target = document.getElementById('tab-' + tabId);
    if (target) {
        target.style.display = 'block';
        // Gunakan timeout kecil agar transisi opacity CSS berjalan
        setTimeout(() => target.classList.add('active'), 10);
    }
    
    // 3. Update status Active di Sidebar
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if(item.getAttribute('onclick').includes(tabId)) {
            item.classList.add('active');
        }
    });

    // 4. Update Header Title (Desktop & Mobile)
    const titles = {
        'dashboard': 'Dashboard Overview',
        'inbox': 'Inbox Permintaan',
        'calendar': 'Kalender Reservasi',
        'data': 'Manajemen Data Master',
        'broadcast': 'Broadcast Promosi',
        'analysis': 'Analisis Bisnis & Data',
        'settings': 'Pengaturan Tampilan'
    };
    const titleText = titles[tabId] || 'Dashboard';
    
    const titleEl = document.getElementById('page-title'); // Desktop
    if(titleEl) titleEl.innerText = titleText;

    const mobileTitle = document.getElementById('mobile-date-display'); // Mobile Subtitle
    if(mobileTitle) mobileTitle.innerText = titleText;

    // 5. UX Mobile: Tutup sidebar otomatis saat menu diklik
    if(window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if(sidebar && sidebar.classList.contains('open')) {
            toggleSidebar(); // Panggil fungsi toggle untuk menutup dengan animasi
        }
    }

    // 6. Trigger Khusus Analisis
    if(tabId === 'analysis') {
        initAnalysisFilters();
        runUIAnalysis();
    }
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('mobile-toggle');
    const icon = btn.querySelector('i');

    const isOpen = sb.classList.contains('open');

    if (isOpen) {
        // CLOSE
        sb.classList.remove('open');
        if(overlay) overlay.classList.remove('active');
        icon.classList.remove('fa-times');
        icon.classList.add('fa-bars');
    } else {
        // OPEN
        sb.classList.add('open');
        if(overlay) overlay.classList.add('active');
        icon.classList.remove('fa-bars');
        icon.classList.add('fa-times');
    }
}

function updateHeaderDate() {
    const el = document.getElementById('current-date-display');
    if(el) {
        const d = new Date();
        el.innerText = d.toLocaleDateString('id-ID', { 
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
        });
    }
}


/**
 * 5. INISIALISASI & DATA MASTER (MENU/LOKASI)
 */
async function initializeApp() { 
  showLoader();
  try {
    console.log("System: Memulai Inisialisasi...");

    // Cek URL Parameter (Deep Link)
    const urlParams = new URLSearchParams(window.location.search);
    const paramDate = urlParams.get('date');

    if (paramDate) {
        const d = new Date(paramDate);
        if (!isNaN(d.getTime())) {
            currentMonth = d.getMonth();
            currentYear = d.getFullYear();
        }
    }

    // Load Data Master (Parallel) - Penting untuk Print & WA
    await Promise.all([
        loadMenus(),     
        loadLocations()  
    ]);

    // Setup Listeners
    if (typeof loadReservationsForCurrentMonth === 'function') {
        loadReservationsForCurrentMonth(); 
    }
    initInboxListener(); 
    
    // Background Jobs
    if (typeof setupReliableNotificationChecker === 'function') {
        setupReliableNotificationChecker(); 
    }

    console.log("System: Inisialisasi Selesai.");

  } catch (e) {
    console.error("Init Error:", e);
    showToast("Gagal memuat data aplikasi. Silakan refresh.", "error");
    hideLoader();
  }
}

async function loadMenus() {
  try {
    const snapshot = await db.collection('menus').get();
    detailMenu = {};
    menuPrices = {}; 
    
    const previewList = document.getElementById('preview-menu-list');
    let htmlContent = '';

    if (snapshot.empty) {
        if(previewList) previewList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Belum ada data menu.</div>';
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        
        detailMenu[doc.id] = data.details || []; 
        menuPrices[doc.id] = data.price || 0;
        
        htmlContent += `
        <div class="menu-item" style="padding: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
            <div style="flex:1;">
                <div style="font-weight:700; color:var(--text-main); font-size:0.95rem;">${escapeHtml(doc.id)}</div>
                <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
                    ${data.details && data.details.length ? data.details.join(', ') : '-'}
                </div>
            </div>
            <div style="font-weight:700; color:var(--success); font-size:0.9rem;">
                Rp ${formatRupiah(data.price)}
            </div>
        </div>`;
    });

    if(previewList) previewList.innerHTML = htmlContent;
    console.log(`Data Master: ${Object.keys(menuPrices).length} menu dimuat.`);

  } catch (e) { 
    console.error("Error Load Menu:", e);
    showToast("Gagal memuat data menu", "error");
  }
}

async function loadLocations() {
    try {
        const snapshot = await db.collection('locations').get();
        locationsData = {};
        
        const previewList = document.getElementById('preview-location-list');
        let htmlContent = '';

        if (snapshot.empty) {
            if(previewList) previewList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Belum ada lokasi.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            locationsData[doc.id] = {
                name: data.name,
                capacity: data.capacity
            };
            
            htmlContent += `
            <div class="menu-item" style="padding: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
                <div style="flex:1;">
                    <div style="font-weight:700; color:var(--text-main); font-size:0.95rem;">${escapeHtml(data.name)}</div>
                </div>
                <div class="pill" style="background:var(--primary-gradient); color:white; font-size: 0.75rem; padding: 4px 10px; border-radius: 12px; font-weight: 600;">
                    Kap: ${data.capacity} Org
                </div>
            </div>`;
        });

        if(previewList) previewList.innerHTML = htmlContent;
        console.log(`Data Master: ${Object.keys(locationsData).length} lokasi dimuat.`);

    } catch (e) { 
        console.error("Error Load Locations:", e);
        showToast("Gagal memuat data lokasi", "error");
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 2: INBOX SYSTEM, ACTIONS & KALENDER CORE
// ============================================================================

/**
 * 6. SISTEM INBOX & LISTENER REQUEST
 */
function initInboxListener() {
    // Bersihkan listener lama untuk mencegah memory leak
    if (unsubscribeRequests) unsubscribeRequests();
    
    console.log("System: Mengaktifkan Listener Inbox...");
    
    unsubscribeRequests = db.collection('reservation_requests')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            // 1. Update Cache
            requestsCache = snapshot.docs.map(d => ({
                id: d.id, 
                ...d.data()
            }));
            
            // 2. Update UI Cards
            renderInboxUI();
            
            // 3. Update Badge Notifikasi (Sidebar & Dashboard)
            updateInboxBadges();
            
        }, err => {
            console.error("Inbox Listener Error:", err);
        });
}

function updateInboxBadges() {
    const count = requestsCache.length;
    
    // Badge Sidebar
    const badge = document.getElementById('sidebar-badge');
    if (badge) {
        if(count > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = count > 99 ? '99+' : count;
        } else {
            badge.style.display = 'none';
        }
    }
    
    // Badge Dashboard Widget
    const statPending = document.getElementById('stat-pending-count');
    if (statPending) statPending.textContent = count;
}

function renderInboxUI() {
    const container = document.getElementById('inbox-container');
    if (!container) return; 

    // Tampilan Kosong
    if (requestsCache.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--text-muted);">
            <div style="font-size:3rem; opacity:0.3; margin-bottom:15px;"><i class="fas fa-inbox"></i></div>
            <h4 style="margin:0;">Inbox Bersih</h4>
            <p style="font-size:0.9rem; margin-top:5px;">Tidak ada permintaan reservasi baru saat ini.</p>
        </div>`;
        return;
    }

    // Render Cards
    container.innerHTML = requestsCache.map(r => {
        // Generate Rincian Menu & Harga
        let menuHtml = '<div style="color:#999; font-style:italic; font-size:0.85rem; padding:10px;">Tidak ada detail menu</div>';
        
        if(r.menus && Array.isArray(r.menus) && r.menus.length > 0) {
            const listItems = r.menus.map(m => {
                // Kalkulasi harga per item (menggunakan cache menuPrices dari Bagian 1)
                const unitPrice = menuPrices[m.name] || 0;
                const subtotal = unitPrice * m.quantity;
                
                return `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.05);">
                    <span><b>${m.quantity}x</b> ${escapeHtml(m.name)}</span>
                    <span style="color:var(--text-muted);">Rp ${formatRupiah(subtotal)}</span>
                </div>`;
            }).join('');
            
            menuHtml = `<div style="padding:10px;">${listItems}</div>`;
        }

        // Label Sumber (Via Web / Manual)
        const viaBadge = r.via 
            ? `<span class="req-via" style="background:#e0f2fe; color:#0284c7; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">${escapeHtml(r.via)}</span>` 
            : `<span class="req-via" style="background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">Web</span>`;

        return `
        <div class="request-card glass-card" style="margin-bottom: 20px;">
            <div class="request-header" style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px;">
                <div>
                    <div class="req-name" style="font-size:1.1rem; font-weight:700;">${escapeHtml(r.nama)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${r.nomorHp || '-'}</div>
                </div>
                ${viaBadge}
            </div>
            
            <div class="req-details">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div style="background:rgba(255,255,255,0.6); padding:8px; border-radius:10px; text-align:center; border:1px solid rgba(0,0,0,0.05);">
                        <i class="far fa-calendar-alt" style="color:var(--primary); margin-bottom:4px;"></i>
                        <div style="font-weight:700; font-size:0.9rem;">${escapeHtml(r.date)}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.6); padding:8px; border-radius:10px; text-align:center; border:1px solid rgba(0,0,0,0.05);">
                        <i class="far fa-clock" style="color:var(--primary); margin-bottom:4px;"></i>
                        <div style="font-weight:700; font-size:0.9rem;">${escapeHtml(r.jam)}</div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; padding:0 5px; font-size:0.9rem; color:var(--text-main); margin-bottom:10px;">
                    <span><i class="fas fa-users" style="color:var(--primary);"></i> <b>${r.jumlah}</b> Orang</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${escapeHtml(r.tempat)}</span>
                </div>
            </div>
            
            <div class="req-menu-box" style="margin:15px 0; background:#fffbeb; border:1px dashed var(--accent); border-radius:10px;">
                <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--accent); margin-bottom:5px; padding:10px 10px 0 10px;">Rincian Pesanan</div>
                ${menuHtml}
            </div>
            
            ${r.tambahan ? `
            <div style="font-size:0.85rem; color:#d97706; background:rgba(255,251,235,0.8); padding:10px; border-radius:10px; margin-bottom:15px; border-left:3px solid #f59e0b;">
                <i class="fas fa-sticky-note"></i> <b>Catatan:</b> ${escapeHtml(r.tambahan)}
            </div>` : ''}
            
            <div class="req-actions" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
                <button class="btn-icon whatsapp" style="width:100%; border-radius:10px;" onclick="prepareInboxChat('${r.id}')" title="Hubungi Pelanggan">
                    <i class="fab fa-whatsapp"></i>
                </button>
                <button class="btn-icon danger" style="width:100%; border-radius:10px;" onclick="rejectRequest('${r.id}')" title="Tolak">
                    <i class="fas fa-times"></i>
                </button>
                <button class="btn-icon primary" style="width:100%; border-radius:10px;" onclick="approveRequest('${r.id}')" title="Approve">
                    <i class="fas fa-check"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}


/**
 * 7. FITUR CHAT WHATSAPP CERDAS (INBOX)
 * Menghitung total harga dan membuat template pesan konfirmasi otomatis untuk pesanan baru.
 */
function prepareInboxChat(id) {
    const r = requestsCache.find(item => item.id === id);
    if (!r) { showToast("Data permintaan tidak ditemukan", "error"); return; }

    let totalFood = 0;
    let orderSummary = "";
    
    // Kalkulasi Total Harga berdasarkan Cache Harga (menuPrices)
    if (r.menus && Array.isArray(r.menus)) {
        r.menus.forEach(m => {
            let unitPrice = menuPrices[m.name] || 0;
            let sub = unitPrice * m.quantity;
            totalFood += sub;
            orderSummary += `   • ${m.name} (${m.quantity}x) : Rp ${formatRupiah(sub)}\n`;
        });
    }
    
    // Kalkulasi DP (Logika: 50% dari total)
    let grandTotal = totalFood; 
    let dpAmount = grandTotal > 0 ? grandTotal * 0.5 : 0; 

    // Template Pesan Profesional
    let msg = `Halo Kak *${r.nama}* 👋,\n\n` +
        `Terima kasih telah melakukan reservasi di *Dolan Sawah*.\n` +
        `Kami ingin mengkonfirmasi detail pesanan Kakak sebagai berikut:\n\n` +
        `🗓 Tanggal: *${r.date}*\n` +
        `⏰ Jam: *${r.jam}*\n` +
        `👥 Jumlah: *${r.jumlah} Orang*\n` +
        `📍 Tempat: *${r.tempat}*\n\n` +
        `🍽 *Rincian Pesanan:*\n${orderSummary || '   (Tidak ada menu spesifik)\n'}\n` +
        `----------------------------------\n` +
        `💰 *Total Estimasi: Rp ${formatRupiah(grandTotal)}*\n` +
        `----------------------------------\n\n` +
        `Untuk mengamankan slot ini, mohon kesediaannya melakukan pembayaran *DP sebesar Rp ${formatRupiah(dpAmount)}*.\n\n` +
        `Transfer dapat dilakukan ke:\n` +
        `🏦 *BCA: 123-456-7890*\n` +
        `a.n Dolan Sawah Management\n\n` +
        `Mohon kirimkan bukti transfer jika sudah ya Kak. Terima kasih! 🙏`;

    // Validasi Nomor HP
    if (!r.nomorHp) {
        showToast("Nomor HP pelanggan tidak tersedia", "error");
        return;
    }

    window.open(`https://wa.me/${cleanPhoneNumber(r.nomorHp)}?text=${encodeURIComponent(msg)}`, '_blank');
}


/**
 * 8. LOGIKA APPROVE REQUEST (BATCH TRANSACTION)
 * Memindahkan data dari Inbox ke Kalender Utama dengan aman.
 */
async function approveRequest(id) {
    const req = requestsCache.find(r => r.id === id);
    if(!req) return;

    // Tampilkan Dialog Input DP & Metode Bayar
    const { value: formValues } = await Swal.fire({
        title: `<h3 style="color:var(--primary)">Approve: ${req.nama}</h3>`,
        html: `
            <div style="text-align:left; margin-bottom:15px;">
                <label style="font-weight:600; font-size:0.9rem; color:#666;">Nominal DP Masuk (Rp)</label>
                <input id="swal-input-dp" type="number" class="swal2-input" placeholder="0" style="margin-top:5px; border-radius:10px;">
            </div>
            <div style="text-align:left;">
                <label style="font-weight:600; font-size:0.9rem; color:#666;">Metode Pembayaran</label>
                <select id="swal-input-type" class="swal2-select" style="display:block; width:100%; margin-top:5px; border-radius:10px;">
                    <option value="Transfer BCA">Transfer BCA</option>
                    <option value="Transfer Mandiri">Transfer Mandiri</option>
                    <option value="Transfer BRI">Transfer BRI</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Cash">Cash</option>
                    <option value="Lainnya">Lainnya</option>
                </select>
            </div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Simpan & Approve',
        confirmButtonColor: '#059669', // Emerald Green
        cancelButtonText: 'Batal',
        preConfirm: () => {
            return {
                dp: document.getElementById('swal-input-dp').value,
                tipeDp: document.getElementById('swal-input-type').value
            }
        }
    });

    if (formValues) {
        showLoader();
        try {
            // Persiapkan Objek Data Baru
            const newData = { 
                ...req, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp(), 
                dp: parseInt(formValues.dp) || 0, 
                tipeDp: formValues.tipeDp,
                thankYouSent: false
            };
            
            // Bersihkan properti ID dan metadata inbox
            delete newData.id;
            delete newData.via; 
            delete newData.status;

            // Jalankan Batch Transaction
            const batch = db.batch();
            
            const newResRef = db.collection('reservations').doc(); // Generate ID Baru
            batch.set(newResRef, newData); // Tambah ke Reservations
            
            const oldReqRef = db.collection('reservation_requests').doc(id);
            batch.delete(oldReqRef); // Hapus dari Requests
            
            await batch.commit();
            
            showToast('Berhasil! Data masuk ke kalender.', 'success');

        } catch (e) { 
            console.error("Approve Error:", e);
            showToast('Terjadi kesalahan sistem.', 'error');
        } finally {
            hideLoader();
        }
    }
}


/**
 * 9. LOGIKA REJECT REQUEST
 * Menghapus permanen dengan konfirmasi aman.
 */
async function rejectRequest(id) {
    const result = await Swal.fire({
        title: 'Tolak Permintaan?',
        text: "Data ini akan dihapus permanen dari inbox.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Ya, Tolak',
        cancelButtonText: 'Batal'
    });

    if (result.isConfirmed) {
        showLoader();
        try {
            await db.collection('reservation_requests').doc(id).delete();
            showToast('Permintaan ditolak & dihapus.', 'success');
        } catch(e) { 
            console.error("Reject Error:", e);
            showToast('Gagal menghapus data.', 'error'); 
        } finally { 
            hideLoader(); 
        }
    }
}


/**
 * 10. LOAD RESERVASI BULANAN (REALTIME LISTENER)
 * Mengambil data reservasi range 1 bulan penuh.
 * Data ini digunakan untuk mewarnai Kalender DAN menghitung Statistik Dashboard harian.
 */
function loadReservationsForCurrentMonth() {
  // Matikan listener lama agar tidak menumpuk saat ganti bulan
  if (unsubscribeReservations) unsubscribeReservations();
  
  showLoader();

  // Tentukan range tanggal (Tanggal 1 s/d Akhir Bulan)
  // Format tanggal database: YYYY-MM-DD
  const monthStr = String(currentMonth + 1).padStart(2, '0');
  const startDate = `${currentYear}-${monthStr}-01`;
  
  // Cari tanggal terakhir bulan ini
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const endDate = `${currentYear}-${monthStr}-${lastDay}`;
  
  console.log(`System: Memuat reservasi ${startDate} s/d ${endDate}`);

  unsubscribeReservations = db.collection('reservations')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .onSnapshot( snapshot => {
        // Reset Cache Lokal
        dataReservasi = {};       // Grouping per tanggal (Key: "MM-DD")
        allReservationsList = []; // Flat list untuk statistik dashboard

        snapshot.forEach(doc => {
          const r = { id: doc.id, ...doc.data() };
          
          // Masukkan ke Flat List (untuk widget dashboard)
          allReservationsList.push(r);

          // Masukkan ke Grouping Tanggal (untuk grid kalender)
          const dateKey = r.date.substring(5); // Ambil "MM-DD"
          
          if (!dataReservasi[dateKey]) {
              dataReservasi[dateKey] = [];
          }
          dataReservasi[dateKey].push(r);
        });
        
        // 1. Render Ulang Grid Kalender
        buatKalender();
        
        // 2. Update Widget & List di Halaman Dashboard
        updateDashboardWidgets(allReservationsList);

        // 3. Cek Auto Open (Deep Link dari notifikasi WA)
        handleAutoOpen();

        // 4. Jika user sedang membuka detail tanggal tertentu, refresh list-nya secara realtime
        if (tanggalDipilih && !hasAutoOpened) {
            const reservations = dataReservasi[tanggalDipilih] || [];
            updateReservationList(reservations);
        }
        
        hideLoader();
      }, 
      err => { 
          console.error("Reservation Listener Error:", err);
          showToast("Gagal memuat data kalender. Cek koneksi.", "error");
          hideLoader(); 
      }
    );
}


/**
 * 11. UPDATE DASHBOARD WIDGETS
 * Menghitung angka-angka statistik di halaman depan secara otomatis.
 */
function updateDashboardWidgets(allData) {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // --- Widget 1: Tamu Hari Ini ---
    const todayCount = allData.filter(r => r.date === todayStr).length;
    const statToday = document.getElementById('stat-today-count');
    if(statToday) statToday.textContent = todayCount;

    // --- Widget 2: Omzet DP Bulan Ini ---
    const totalDp = allData.reduce((acc, curr) => acc + (parseInt(curr.dp) || 0), 0);
    const statRev = document.getElementById('stat-revenue-month');
    if(statRev) statRev.textContent = 'Rp ' + formatRupiah(totalDp);

    // --- Widget List: Reservasi Terbaru (5 Terakhir) ---
    const recentListContainer = document.getElementById('dashboard-recent-list');
    if (recentListContainer) {
        // Sort berdasarkan waktu input (createdAt) descending
        const sortedRecent = [...allData].sort((a,b) => {
            const timeA = a.createdAt ? a.createdAt.seconds : 0;
            const timeB = b.createdAt ? b.createdAt.seconds : 0;
            return timeB - timeA;
        }).slice(0, 5); 

        if (sortedRecent.length === 0) {
            recentListContainer.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-muted);">Belum ada reservasi bulan ini.</p>';
        } else {
            recentListContainer.innerHTML = sortedRecent.map(r => `
                <div class="reservation-list-item" style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1;">
                        <div style="font-weight:700; color:var(--text-main); font-size:0.9rem;">${escapeHtml(r.nama)}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
                            <i class="far fa-calendar"></i> ${r.date} &bull; <i class="far fa-clock"></i> ${r.jam}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span class="pill" style="background:var(--primary-gradient); color:white; font-size:0.75rem;">${r.jumlah} Pax</span>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.tempat)}</div>
                    </div>
                </div>
            `).join('');
        }
    }
}


/**
 * 12. RENDER GRID KALENDER (PRESISI)
 * Membuat kotak-kotak tanggal. Menggunakan Filler Divs agar hari Senin jatuh di kolom Senin.
 */
function buatKalender() {
  const calendarEl = document.getElementById('calendar');
  const monthYearEl = document.getElementById('monthYear');
  
  if(!calendarEl || !monthYearEl) return;

  calendarEl.innerHTML = ''; 
  monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Logika Hari: Mencari hari apa tanggal 1 dimulai (0=Minggu, 1=Senin...)
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); 
  
  // Total hari dalam bulan ini
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate(); 
  
  // Render Filler (Kotak transparan sebelum tanggal 1)
  for (let i = 0; i < firstDayIndex; i++) { 
      calendarEl.insertAdjacentHTML('beforeend', `<div class="calendar-day disabled" style="cursor:default; background:transparent; border:none; box-shadow:none;"></div>`); 
  }
  
  // Render Tanggal 1 s/d Akhir
  for (let i = 1; i <= daysInMonth; i++) {
    const dateKey = `${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    // Cek Status Hari Ini
    const isToday = new Date().toDateString() === new Date(currentYear, currentMonth, i).toDateString() ? 'today' : '';
    
    // Cek Status Terpilih (Highlight)
    const isSelected = dateKey === tanggalDipilih ? 'selected' : '';
    
    // Hitung Jumlah Reservasi
    const dailyData = dataReservasi[dateKey] || [];
    const countHTML = dailyData.length > 0 
        ? `<span class="reservation-count">${dailyData.length} Res</span>` 
        : '';
    
    calendarEl.insertAdjacentHTML('beforeend', `
      <div class="calendar-day ${isToday} ${isSelected}" onclick="pilihTanggal(${i})">
        <span class="day-number">${i}</span>
        ${countHTML}
      </div>`);
  }
}
// ============================================================================
// FILE: app.js
// BAGIAN 3: INTERAKSI KALENDER, CRUD SYSTEM & DATA MASTER
// ============================================================================

/**
 * 13. INTERAKSI TANGGAL & SORTING
 */
function pilihTanggal(day) {
  // Set global state
  tanggalDipilih = `${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Refresh highlight di kalender
  buatKalender(); 
  
  // Ambil data spesifik tanggal ini
  const reservations = dataReservasi[tanggalDipilih] || [];
  
  // Update Judul Section Detail
  const viewTitle = document.getElementById('reservation-view-title');
  if(viewTitle) {
      viewTitle.innerHTML = `<i class="far fa-calendar-check"></i> ${day} ${monthNames[currentMonth]} ${currentYear}`;
  }
  
  // Reset Search Bar
  const searchInput = document.getElementById('detailSearchInput');
  if(searchInput) searchInput.value = ''; 
  
  // Render List Detail
  updateReservationList(reservations); 
  
  // Tampilkan Container Detail & Scroll ke sana
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) {
      viewContainer.style.display = 'block';
      viewContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function kembaliKeKalender() {
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) viewContainer.style.display = 'none';
  
  tanggalDipilih = ''; 
  buatKalender(); // Hapus highlight
}

// --- LOGIKA SORTING ---
function toggleSortDropdown() {
    const d = document.getElementById('sort-dropdown');
    if (d) d.style.display = d.style.display === 'block' ? 'none' : 'block';
}

function applySort(mode) {
    currentSortMode = mode;
    showToast(`Diurutkan berdasarkan ${mode}`, 'info');
    
    // Sembunyikan dropdown
    const d = document.getElementById('sort-dropdown');
    if(d) d.style.display = 'none';
    
    // Refresh list dengan mode baru
    if (tanggalDipilih) {
        updateReservationList(dataReservasi[tanggalDipilih] || []);
    }
}


/**
 * 14. RENDER LIST DETAIL (INTI TAMPILAN DATA)
 */
function updateReservationList(reservations) {
    const container = document.getElementById('reservation-detail-list');
    if(!container) return;
    
    // Kondisi Kosong
    if (!reservations || reservations.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-muted);">
            <i class="far fa-calendar-times fa-3x" style="margin-bottom:15px; opacity:0.3;"></i>
            <p>Tidak ada reservasi untuk tanggal ini.</p>
            <button class="btn-primary-gradient" onclick="showAddForm()" style="margin-top:10px; width:auto;">
                <i class="fas fa-plus"></i> Tambah Baru
            </button>
        </div>`; 
        return;
    }
    
    // --- SORTING ---
    const sortedRes = [...reservations].sort((a,b) => {
        if (currentSortMode === 'tempat') {
            return (a.tempat || '').localeCompare(b.tempat || '');
        } else if (currentSortMode === 'nama') {
            return (a.nama || '').localeCompare(b.nama || '');
        } else {
            // Default: Jam (Pagi -> Malam)
            return (a.jam || '').localeCompare(b.jam || '');
        }
    });
    
    container.innerHTML = sortedRes.map(r => {
        // Render Menu (Versi Ringkas untuk Kartu UI)
        let menuItemsHtml = "<small style='color:#ccc; font-style:italic;'>Tidak ada menu</small>";
        
        if (Array.isArray(r.menus) && r.menus.length > 0) {
            menuItemsHtml = r.menus.map(item => {
                const details = detailMenu[item.name] || [];
                const detailStr = details.length > 0 
                    ? `<span style="font-size:0.75rem; color:#888;"> (${details.length} item)</span>` 
                    : '';
                return `<div style="margin-bottom:4px;">
                            <b>${item.quantity}x</b> ${escapeHtml(item.name)}
                            ${detailStr}
                        </div>`;
            }).join('');
        } else if (r.menu) { 
            menuItemsHtml = `<div>${escapeHtml(r.menu)}</div>`;
        }

        // Status DP
        const dpInfo = r.dp > 0 
            ? `<span class="pill" style="background:#dcfce7; color:#166534; border:1px solid #bbf7d0;">
                <i class="fas fa-check"></i> DP: Rp${formatRupiah(r.dp)}
               </span>` 
            : `<span class="pill" style="background:#fee2e2; color:#991b1b; border:1px solid #fecaca;">
                <i class="fas fa-exclamation-circle"></i> Tanpa DP
               </span>`;
        
        // Tombol Thanks
        let thanksBtn = r.thankYouSent 
            ? `<button class="btn-icon" disabled style="background:#f1f5f9; color:#94a3b8; cursor:default;" title="Sudah dikirim"><i class="fas fa-check-double"></i></button>`
            : `<button class="btn-icon info" id="thank-btn-${r.id}" onclick="sendThankYouMessage('${r.id}', '${escapeHtml(r.nama)}', '${r.nomorHp}')" title="Kirim Ucapan"><i class="fas fa-gift"></i></button>`;

        return `
        <div class="reservation-item glass-card" style="margin:0; padding:20px; border-left:4px solid var(--primary); margin-bottom:15px;">
            <div style="border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:5px;">
                    <h4 style="margin:0; color:var(--text-main); font-size:1.1rem;">${escapeHtml(r.nama)}</h4>
                    ${dpInfo}
                </div>
                <div style="font-size:0.9rem; color:var(--text-muted); display:flex; gap:15px; flex-wrap:wrap;">
                    <span><i class="far fa-clock" style="color:var(--primary);"></i> ${r.jam}</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${escapeHtml(r.tempat)}</span>
                    <span><i class="fas fa-users" style="color:var(--primary);"></i> <b>${r.jumlah}</b> Pax</span>
                </div>
                ${r.nomorHp ? `<div style="font-size:0.85rem; color:#666; margin-top:5px;"><i class="fas fa-phone"></i> ${r.nomorHp}</div>` : ''}
            </div>
            
            <div class="menu-detail" style="background:rgba(255,255,255,0.5); padding:10px; border-radius:10px; border-left:3px solid var(--accent); margin-bottom:10px;">
                <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--accent); margin-bottom:5px;">
                    Pesanan:
                </div>
                <div style="padding-left:5px; font-size:0.9rem;">${menuItemsHtml}</div>
            </div>
            
            ${r.tambahan ? `<div style="font-size:0.85rem; color:#d97706; margin-top:8px; background:#fffbeb; padding:8px; border-radius:8px; border:1px dashed #fcd34d;"><i class="fas fa-comment-dots"></i> <b>Note:</b> ${escapeHtml(r.tambahan)}</div>` : ''}
            
            <div class="item-actions" style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap; border-top:1px solid rgba(0,0,0,0.05); padding-top:12px;">
                
                ${r.nomorHp ? `
                <button class="btn-icon whatsapp" onclick="contactPersonal('${r.id}')" title="Chat WA">
                    <i class="fab fa-whatsapp"></i>
                </button>` : ''}
                
                ${thanksBtn}
                
                <div style="flex:1;"></div> 
                
                <button class="btn-icon" style="background:var(--text-muted); color:white;" onclick="editReservasi('${r.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn-icon danger" onclick="hapusReservasi('${r.id}')" title="Hapus"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}


/**
 * 15. NAVIGASI BULAN & SEARCH
 */
function navigateMonth(direction) {
    currentMonth += direction;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    
    kembaliKeKalender(); 
    loadReservationsForCurrentMonth(); 
}

const previousMonth = () => navigateMonth(-1);
const nextMonth = () => navigateMonth(1);
const goToToday = () => {
    const now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();
    kembaliKeKalender();
    loadReservationsForCurrentMonth();
    showToast("Kembali ke bulan ini");
};

function filterReservations(query) {
  if (!tanggalDipilih || !dataReservasi[tanggalDipilih]) return;
  const q = query.toLowerCase();
  const rawList = dataReservasi[tanggalDipilih];
  
  const filtered = rawList.filter(r => 
    (r.nama && r.nama.toLowerCase().includes(q)) || 
    (r.tempat && r.tempat.toLowerCase().includes(q)) ||
    (r.nomorHp && r.nomorHp.includes(q)) ||
    (r.menus && r.menus.some(m => m.name.toLowerCase().includes(q))) ||
    (r.menu && r.menu.toLowerCase().includes(q))
  );
  updateReservationList(filtered);
}

function handleAutoOpen() {
    const urlParams = new URLSearchParams(window.location.search);
    const shouldOpen = urlParams.get('autoOpen');
    
    if (shouldOpen && !hasAutoOpened) {
        const paramDate = urlParams.get('date');
        const paramSearch = urlParams.get('search');
        
        if (paramDate) {
            const d = new Date(paramDate);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                const day = d.getDate();
                pilihTanggal(day);
                if(paramSearch) {
                    const searchInput = document.getElementById('detailSearchInput');
                    if(searchInput) {
                        searchInput.value = paramSearch;
                        filterReservations(paramSearch);
                    }
                }
                hasAutoOpened = true; 
                showToast("Membuka data reservasi...");
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }
}


/**
 * 16. TAMPILKAN FORM TAMBAH (RESET UI & SET TANGGAL)
 */
function showAddForm() {
    const form = document.getElementById('reservation-form');
    if (!form) return;

    // Reset Form & Error Messages
    form.reset();
    document.querySelectorAll('.err-msg').forEach(el => el.textContent = '');
    document.querySelectorAll('.glass-input').forEach(el => el.style.borderColor = '');
    
    // --- LOGIKA BARU: Set Nilai Tanggal di Input ---
    const dateInput = document.getElementById('inputDate');
    
    if (tanggalDipilih) {
        // Jika user sedang membuka tanggal tertentu di kalender, gunakan itu
        dateInput.value = `${currentYear}-${tanggalDipilih}`;
    } else {
        // Jika tidak, default ke Hari Ini
        const now = new Date();
        // Adjust timezone offset agar tidak mundur hari (untuk Asia/Jakarta)
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().split('T')[0];
    }

    // Populate Dropdown Lokasi & Reset Kapasitas
    const tempatSelect = form.querySelector('#tempat');
    populateLocationDropdown(tempatSelect);
    updateCapacityInfo('reservation-form');
    
    // Reset Container Menu
    const menuContainer = document.getElementById('selected-menus-container');
    menuContainer.innerHTML = '';
    
    // Tambahkan 1 baris menu kosong default
    addMenuSelectionRow('reservation-form');
    
    // Tampilkan Popup
    document.getElementById('addFormPopup').style.display = 'block';
    overlay.style.display = 'block';
}


/**
 * 17. TAMPILKAN FORM EDIT (INJECT HTML DINAMIS)
 */
function editReservasi(id) {
  // Cari data di cache
  let res = null;
  for (const dateKey in dataReservasi) {
      const found = dataReservasi[dateKey].find(r => r.id === id);
      if (found) { res = found; break; }
  }

  if (!res) { 
      showToast("Data tidak ditemukan di cache (mungkin sudah dihapus).", "error"); 
      return; 
  }
  
  const formContainer = document.getElementById('editFormPopup');
  
  // Inject HTML Form Edit
  formContainer.innerHTML = `
    <div class="popup-header" style="padding: 20px 25px; background: linear-gradient(135deg, var(--text-main), #475569); color: white; display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0;"><i class="fas fa-edit"></i> Edit Data</h3>
        <button class="close-popup-btn" onclick="closePopup('editFormPopup')" style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;">&times;</button>
    </div>
    <form id="edit-reservation-form" style="padding:25px;">
      <input type="hidden" id="editReservationId" value="${res.id}" />
      
      <div class="form-group">
          <label>Tanggal</label>
          <input type="date" id="editDate" class="glass-input" value="${res.date}" readonly style="background:#f1f5f9; color:#64748b; cursor:not-allowed;" />
          <small style="color:#94a3b8; font-size:0.8rem;">*Tanggal tidak bisa diubah saat edit (Hapus & Buat baru jika perlu).</small>
      </div>

      <div class="form-group">
          <label>Nama Pemesan</label>
          <input type="text" id="nama" class="glass-input" value="${escapeHtml(res.nama || '')}" required />
          <span class="err-msg" id="nama-error"></span>
      </div>
      
      <div class="form-row">
          <div class="form-group">
              <label>No. HP</label>
              <input type="tel" id="nomorHp" class="glass-input" value="${res.nomorHp || ''}" />
              <span class="err-msg" id="nomorHp-error"></span>
          </div>
          <div class="form-group">
              <label>Jam</label>
              <input type="time" id="jam" class="glass-input" value="${res.jam || ''}" required />
              <span class="err-msg" id="jam-error"></span>
          </div>
      </div>
      
      <div class="form-row">
          <div class="form-group">
              <label>Jml Org</label>
              <input type="number" id="jumlah" class="glass-input" value="${res.jumlah || ''}" min="1" required />
              <span class="err-msg" id="jumlah-error"></span>
          </div>
          <div class="form-group">
              <label>Tempat</label>
              <select id="tempat" class="glass-input" required onchange="updateCapacityInfo('edit-reservation-form')"></select>
              <small id="capacity-info" style="color:var(--primary); font-size:0.8rem; font-weight:600;"></small>
              <span class="err-msg" id="tempat-error"></span>
          </div>
      </div>
      
      <div style="background:rgba(255,255,255,0.5); padding:15px; border-radius:12px; border:1px dashed var(--accent); margin-bottom:15px;">
          <div class="form-row">
              <div class="form-group">
                <label>Nominal DP</label>
                <input type="number" id="dp" class="glass-input" value="${res.dp || 0}" min="0" />
              </div>
              <div class="form-group">
                <label>Via Pembayaran</label>
                <select id="tipeDp" class="glass-input">
                    <option value="">- Tanpa DP -</option>
                    <option value="Cash">Cash</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Transfer BCA">Transfer BCA</option>
                    <option value="Transfer Mandiri">Transfer Mandiri</option>
                    <option value="Transfer BRI">Transfer BRI</option>
                </select>
              </div>
          </div>
      </div>
      
      <div class="form-group">
          <label>Menu Pesanan <span class="err-msg" id="menus-error"></span></label>
          <div id="selected-menus-container"></div>
          <button type="button" class="btn-dashed" onclick="addMenuSelectionRow('edit-reservation-form')" style="width:100%; border:2px dashed #ccc; background:transparent; padding:8px; border-radius:8px; cursor:pointer;">
            + Tambah Menu
          </button>
      </div>
      
      <div class="form-group">
          <label>Catatan</label>
          <textarea id="tambahan" class="glass-input" rows="2">${escapeHtml(res.tambahan || '')}</textarea>
      </div>
      
      <div class="popup-foot" style="text-align:right; margin-top:20px; padding-top:15px; border-top:1px solid rgba(0,0,0,0.1);">
        <button type="button" class="btn-primary-gradient" onclick="simpanPerubahanReservasi()">Simpan Perubahan</button>
      </div>
    </form>`;
  
  const editFormEl = document.getElementById('edit-reservation-form');
  
  // Set Nilai Awal Dropdown
  const tipeDpSelect = editFormEl.querySelector('#tipeDp');
  if(tipeDpSelect) tipeDpSelect.value = res.tipeDp || '';
  
  const tempatSelect = editFormEl.querySelector('#tempat');
  populateLocationDropdown(tempatSelect, res.tempat);
  updateCapacityInfo('edit-reservation-form');
  
  // Populate Menu
  const menuContainer = editFormEl.querySelector('#selected-menus-container');
  menuContainer.innerHTML = ''; 

  if (Array.isArray(res.menus) && res.menus.length > 0) {
    res.menus.forEach(item => {
        addMenuSelectionRow('edit-reservation-form', item.name, item.quantity);
    });
  } else if (res.menu) {
    addMenuSelectionRow('edit-reservation-form', res.menu, 1);
  } else {
    addMenuSelectionRow('edit-reservation-form');
  }
  
  formContainer.style.display = 'block'; 
  overlay.style.display = 'block';
}


/**
 * 18. OPERASI DATABASE: CRUD
 */
async function simpanReservasi() {
  const formData = await validateAndGetFormData('reservation-form');
  if (!formData) return;
  
  const dateInput = document.getElementById('inputDate').value;
  if (!dateInput) { 
      showToast("Tanggal wajib diisi!", "error");
      return; 
  }
  
  showLoader();
  try {
    const payload = { 
        ...formData, 
        date: dateInput, 
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        thankYouSent: false
    };

    await db.collection('reservations').add(payload);
    showToast("Reservasi berhasil disimpan!", "success");
    closePopup('addFormPopup'); 
  } catch (e) { 
    console.error("Save Error:", e);
    showToast("Gagal menyimpan data.", "error"); 
  } finally { hideLoader(); }
}

async function simpanPerubahanReservasi() {
  const id = document.getElementById('editReservationId').value;
  if (!id) return;

  const formData = await validateAndGetFormData('edit-reservation-form');
  if (!formData) return;
  
  showLoader();
  try {
    await db.collection('reservations').doc(id).update(formData);
    showToast("Perubahan berhasil disimpan.", "success");
    closePopup('editFormPopup');
  } catch (e) { 
    console.error("Update Error:", e);
    showToast("Gagal mengupdate data.", "error"); 
  } finally { hideLoader(); }
}

async function hapusReservasi(id) {
  const result = await Swal.fire({
      title: 'Hapus Data?',
      text: "Data reservasi ini akan dihapus permanen.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#94a3b8',
      confirmButtonText: 'Ya, Hapus'
  });

  if (result.isConfirmed) {
      showLoader();
      try { 
          await db.collection('reservations').doc(id).delete(); 
          showToast("Data telah dihapus.", "success"); 
          closePopup('editFormPopup'); 
      } catch (e) { 
          console.error("Delete Error:", e);
          showToast("Gagal menghapus data.", "error"); 
      } finally { hideLoader(); }
  }
}


/**
 * 19. VALIDASI FORM & HELPER
 */
async function validateAndGetFormData(formId) {
    const form = document.getElementById(formId);
    let isValid = true;
    
    const setError = (elementId, message) => { 
        const errEl = form.querySelector(`#${elementId}-error`);
        if(errEl) errEl.textContent = message; 
        const inputEl = form.querySelector(`#${elementId}`);
        if(inputEl) inputEl.style.borderColor = 'var(--danger)';
        isValid = false; 
    };

    form.querySelectorAll('.err-msg').forEach(el => el.textContent = '');
    form.querySelectorAll('.glass-input').forEach(el => el.style.borderColor = '');

    const nama = form.querySelector('#nama').value.trim();
    if(!nama) setError('nama', 'Wajib diisi');

    const hpInput = form.querySelector('#nomorHp');
    const nomorHp = cleanPhoneNumber(hpInput.value);
    if(hpInput.value.trim() !== '' && !isValidPhone(nomorHp)) setError('nomorHp', 'Min 10 digit');

    const jam = form.querySelector('#jam').value;
    if(!jam) setError('jam', 'Wajib diisi');

    const jumlah = parseInt(form.querySelector('#jumlah').value);
    const tempat = form.querySelector('#tempat').value;

    if(isNaN(jumlah) || jumlah < 1) setError('jumlah', 'Min 1 orang');
    
    if(!tempat) {
        setError('tempat', 'Pilih tempat');
    } else {
        const locationKey = Object.keys(locationsData).find(k => locationsData[k].name === tempat);
        if(locationKey) {
            const cap = locationsData[locationKey].capacity;
            if (jumlah > cap) {
                setError('jumlah', `Max: ${cap} org`);
                showToast(`Kapasitas ${tempat} hanya ${cap} orang.`, 'error');
            }
        }
    }

    const menus = [];
    const menuRows = form.querySelectorAll('.menu-selection-row');
    const selectedItems = new Set();
    menuRows.forEach(row => {
        const mName = row.querySelector('select').value;
        const mQty = parseInt(row.querySelector('input').value);
        if(mName && !isNaN(mQty) && mQty > 0) {
            if(selectedItems.has(mName)) {
                setError('menus', 'Menu ganda. Gabungkan baris.');
            } else {
                selectedItems.add(mName);
                menus.push({ name: mName, quantity: mQty });
            }
        }
    });

    if(!isValid) return null;

    return {
        nama, nomorHp, jam, jumlah, tempat, menus, 
        dp: parseInt(form.querySelector('#dp').value) || 0,
        tipeDp: form.querySelector('#tipeDp').value,
        tambahan: form.querySelector('#tambahan').value.trim()
    };
}

function addMenuSelectionRow(formId, defaultName='', defaultQty=1) {
  const container = document.querySelector(`#${formId} #selected-menus-container`);
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'menu-selection-row';
  div.style.display = 'flex';
  div.style.gap = '10px';
  div.style.marginBottom = '10px';
  
  const optionsHtml = Object.keys(detailMenu).sort().map(name => {
      const price = menuPrices[name] ? ` (Rp ${formatRupiah(menuPrices[name])})` : '';
      const selected = name === defaultName ? 'selected' : '';
      return `<option value="${name}" ${selected}>${escapeHtml(name)}${price}</option>`;
  }).join('');

  div.innerHTML = `
    <select class="glass-input" style="flex:2;">
        <option value="">-- Pilih Menu --</option>
        ${optionsHtml}
    </select>
    <input type="number" class="glass-input" style="flex:1; text-align:center;" value="${defaultQty}" min="1" placeholder="Qty">
    <button type="button" class="btn-del" onclick="this.parentElement.remove()" title="Hapus baris"><i class="fas fa-trash"></i></button>`;
  container.appendChild(div);
}

function populateLocationDropdown(selectElement, defaultValue='') {
    if(!selectElement) return;
    selectElement.innerHTML = '<option value="">-- Pilih Lokasi --</option>';
    const sortedLocs = Object.values(locationsData).sort((a,b) => a.name.localeCompare(b.name));
    sortedLocs.forEach(loc => {
        const selected = loc.name === defaultValue ? 'selected' : '';
        selectElement.insertAdjacentHTML('beforeend', `<option value="${loc.name}" ${selected}>${escapeHtml(loc.name)} (Kap: ${loc.capacity})</option>`);
    });
}

function updateCapacityInfo(formId) {
    const form = document.getElementById(formId);
    const val = form.querySelector('#tempat').value;
    const infoSpan = form.querySelector('#capacity-info');
    const locKey = Object.keys(locationsData).find(k => locationsData[k].name === val);
    if (locKey) {
        infoSpan.innerHTML = `<i class="fas fa-info-circle"></i> Max: <b>${locationsData[locKey].capacity} orang</b>`;
    } else {
        infoSpan.textContent = '';
    }
}

/**
 * 20. MANAJEMEN DATA MASTER (MENU & LOKASI)
 */
function showMenuManagement() {
    const popup = document.getElementById('menuManagementPopup');
    popup.innerHTML = `
      <div class="popup-header" style="padding: 20px; background: var(--primary); color: white; display: flex; justify-content: space-between;">
          <h3 style="margin:0;"><i class="fas fa-utensils"></i> Kelola Menu & Harga</h3>
          <button class="close-popup-btn" onclick="closePopup('menuManagementPopup')" style="background:none; border:none; color:white; font-size:1.5rem;">&times;</button>
      </div>
      <div class="popup-content" style="padding:20px;">
          <div style="background:rgba(255,255,255,0.5); padding:15px; border-radius:12px; margin-bottom:20px; border:1px solid rgba(0,0,0,0.05);">
              <h4 style="margin-top:0; color:var(--text-main); margin-bottom:10px;">Tambah Menu Baru</h4>
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:10px;">
                 <input type="text" id="newMenuName" class="glass-input" placeholder="Nama Menu (Cth: Paket G)">
                 <input type="number" id="newMenuPrice" class="glass-input" placeholder="Harga (Rp)">
              </div>
              <textarea id="newMenuDetails" class="glass-input" placeholder="Rincian isi menu..." style="min-height:80px;"></textarea>
              <button class="btn-primary-gradient full-width" onclick="addNewMenu()" style="margin-top:10px;"><i class="fas fa-plus-circle"></i> Simpan Menu</button>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="margin:0;">Daftar Menu Aktif</h4>
            <small style="color:#666;">Total: ${Object.keys(detailMenu).length}</small>
          </div>
          <div id="manage-menu-list" style="max-height:300px; overflow-y:auto; border:1px solid rgba(0,0,0,0.05); border-radius:12px; background:white;"></div>
      </div>`;
    renderManageMenuList();
    popup.style.display = 'block'; overlay.style.display = 'block';
}

function renderManageMenuList() {
    const listEl = document.getElementById('manage-menu-list');
    if(!listEl) return;
    listEl.innerHTML = Object.keys(detailMenu).sort().map(name => {
        const price = menuPrices[name] ? parseInt(menuPrices[name]) : 0;
        return `<div class="menu-item" style="padding:12px 15px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
            <div style="flex:1;"><div style="font-weight:600; color:var(--text-main);">${escapeHtml(name)}</div><div style="font-size:0.85rem; color:var(--success); font-weight:600;">Rp ${formatRupiah(price)}</div><div style="font-size:0.8rem; color:#888;">${escapeHtml(detailMenu[name].join(', '))}</div></div>
            <button class="btn-del" onclick="deleteMenu('${escapeHtml(name)}')" title="Hapus Menu"><i class="fas fa-trash"></i></button>
        </div>`;
    }).join('');
}

async function addNewMenu() {
    const name = document.getElementById('newMenuName').value.trim();
    const price = parseInt(document.getElementById('newMenuPrice').value);
    const details = document.getElementById('newMenuDetails').value.split(',').map(s => s.trim()).filter(Boolean);
    if(!name) return showToast("Nama menu wajib diisi", "error");
    if(detailMenu[name]) return showToast("Menu sudah ada", "error");
    showLoader();
    try {
        await db.collection('menus').doc(name).set({ details, price: isNaN(price) ? 0 : price });
        showToast("Menu ditambahkan", "success");
        await loadMenus(); renderManageMenuList();
        document.getElementById('newMenuName').value = '';
        document.getElementById('newMenuPrice').value = '';
        document.getElementById('newMenuDetails').value = '';
    } catch(e) { showToast("Gagal menambah menu", "error"); } finally { hideLoader(); }
}

async function deleteMenu(name) {
    if(!confirm(`Hapus menu "${name}"?`)) return;
    showLoader();
    try {
        await db.collection('menus').doc(name).delete();
        showToast("Menu dihapus", "success");
        await loadMenus(); renderManageMenuList();
    } catch(e) { showToast("Gagal hapus", "error"); } finally { hideLoader(); }
}

function showLocationManagement() {
    const popup = document.getElementById('locationManagementPopup');
    popup.innerHTML = `
      <div class="popup-header" style="padding: 20px; background: var(--primary); color: white; display: flex; justify-content: space-between;">
          <h3 style="margin:0;"><i class="fas fa-map-marker-alt"></i> Kelola Tempat</h3>
          <button class="close-popup-btn" onclick="closePopup('locationManagementPopup')" style="background:none; border:none; color:white; font-size:1.5rem;">&times;</button>
      </div>
      <div class="popup-content" style="padding:20px;">
          <div style="background:rgba(255,255,255,0.5); padding:15px; border-radius:12px; margin-bottom:20px; border:1px solid rgba(0,0,0,0.05);">
              <h4 style="margin-top:0; color:var(--text-main); margin-bottom:10px;">Tambah Tempat Baru</h4>
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
                 <input type="text" id="newLocName" class="glass-input" placeholder="Nama Tempat">
                 <input type="number" id="newLocCap" class="glass-input" placeholder="Kapasitas">
              </div>
              <button class="btn-primary-gradient full-width" onclick="addNewLocation()" style="margin-top:10px;"><i class="fas fa-plus-circle"></i> Tambah Tempat</button>
          </div>
          <h4 style="margin:0 0 10px 0;">Daftar Tempat</h4>
          <div id="manage-loc-list" style="max-height:300px; overflow-y:auto; border:1px solid rgba(0,0,0,0.05); border-radius:12px; background:white;"></div>
      </div>`;
    renderManageLocList();
    popup.style.display = 'block'; overlay.style.display = 'block';
}

function renderManageLocList() {
    const listEl = document.getElementById('manage-loc-list');
    if(!listEl) return;
    listEl.innerHTML = Object.entries(locationsData).sort(([,a], [,b]) => a.name.localeCompare(b.name)).map(([docId, data]) => `
        <div class="menu-item" style="padding:12px 15px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
            <div style="flex:1;"><div style="font-weight:600; color:var(--text-main);">${escapeHtml(data.name)}</div><small style="color:#666;">Kapasitas Max: ${data.capacity} orang</small></div>
            <button class="btn-del" onclick="deleteLocation('${docId}')"><i class="fas fa-trash"></i></button>
        </div>`
    ).join('');
}

async function addNewLocation() {
    const name = document.getElementById('newLocName').value.trim();
    const cap = parseInt(document.getElementById('newLocCap').value);
    if(!name || isNaN(cap) || cap < 1) return showToast("Data tidak valid", "error");
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if(locationsData[id]) return showToast("Lokasi sudah ada", "error");
    showLoader();
    try {
        await db.collection('locations').doc(id).set({ name, capacity: cap });
        showToast("Lokasi ditambahkan", "success");
        await loadLocations(); renderManageLocList();
        document.getElementById('newLocName').value = '';
        document.getElementById('newLocCap').value = '';
    } catch(e) { showToast("Gagal tambah lokasi", "error"); } finally { hideLoader(); }
}

async function deleteLocation(docId) {
    if(!confirm("Hapus lokasi ini?")) return;
    showLoader();
    try {
        await db.collection('locations').doc(docId).delete();
        showToast("Lokasi dihapus", "success");
        await loadLocations(); renderManageLocList();
    } catch(e) { showToast("Gagal hapus", "error"); } finally { hideLoader(); }
}
// ============================================================================
// FILE: app.js
// BAGIAN 4: BROADCAST, TOOLS, PRINT SYSTEM, ANALISIS, WA LOGIC & UTILITIES
// ============================================================================

/**
 * 24. SISTEM BROADCAST WHATSAPP
 */
function showBroadcastMain() { 
    const savedMsg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if (!savedMsg) {
        showBroadcastSettings(); 
    } else {
        showBroadcastList();
    }
}

function showBroadcastSettings() {
    closePopup('broadcastListPopup');
    const popup = document.getElementById('broadcastSettingsPopup');
    document.getElementById('broadcastMessage').value = localStorage.getItem(BROADCAST_MESSAGE_KEY) || '';
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function saveBroadcastMessage() {
    const msg = document.getElementById('broadcastMessage').value;
    if(!msg.trim()) return showToast("Pesan kosong", "error");
    
    localStorage.setItem(BROADCAST_MESSAGE_KEY, msg);
    promoMessageCache = msg;
    
    showToast("Template tersimpan", "success");
    closePopup('broadcastSettingsPopup');
    showBroadcastList();
}

async function showBroadcastList() {
    const msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if(!msg) return showToast("Atur pesan dulu", "error");

    showLoader();
    try {
        // Ambil 500 reservasi terakhir untuk mendapatkan kontak
        const snap = await db.collection('reservations').orderBy('createdAt','desc').limit(500).get();
        const map = new Map();
        
        snap.forEach(d => {
            const data = d.data();
            if(data.nomorHp && isValidPhone(data.nomorHp)) {
                const clean = cleanPhoneNumber(data.nomorHp);
                if(!map.has(clean)) {
                    map.set(clean, { phone: clean, name: data.nama });
                }
            }
        });
        
        allCustomersCache = Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name));
        
        const popup = document.getElementById('broadcastListPopup');
        popup.innerHTML = `
            <div class="popup-header" style="padding: 20px; background:var(--primary); color:white; display:flex; justify-content:space-between;">
                <h3 style="margin:0;"><i class="fas fa-bullhorn"></i> Kirim Broadcast (${allCustomersCache.length})</h3>
                <button class="close-popup-btn" onclick="closePopup('broadcastListPopup')" style="background:none; border:none; color:white; font-size:1.5rem;">&times;</button>
            </div>
            <div class="popup-content" style="padding:20px;">
                <input type="text" id="broadcastSearch" class="glass-input" placeholder="Cari kontak..." oninput="filterBroadcastCustomers(this.value)" style="margin-bottom:15px;">
                <div id="broadcast-customer-list" style="max-height:400px; overflow-y:auto; border:1px solid #eee; border-radius:12px;"></div>
                <div style="margin-top:15px; text-align:right;">
                    <button class="btn-icon" style="background:var(--text-muted); color:white; width:auto; padding:8px 15px;" onclick="showBroadcastSettings()">Edit Pesan</button>
                </div>
            </div>`;
        
        renderBroadcastList(allCustomersCache);
        popup.style.display = 'block'; 
        overlay.style.display = 'block';
    } catch(e) { 
        console.error(e); 
    } finally { 
        hideLoader(); 
    }
}

function renderBroadcastList(arr) {
    const container = document.getElementById('broadcast-customer-list');
    if(!container) return;
    
    if(arr.length === 0) { 
        container.innerHTML = '<p style="padding:20px; text-align:center;">Kosong.</p>'; 
        return; 
    }

    container.innerHTML = arr.map(c => `
        <div class="menu-item" style="padding:10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9;">
            <div style="flex:1;">
                <div style="font-weight:600;">${escapeHtml(c.name)}</div>
                <small class="text-muted">${c.phone}</small>
            </div>
            <button class="btn-icon whatsapp" onclick="sendPromo('${c.phone}', '${escapeHtml(c.name)}', this)"><i class="fab fa-whatsapp"></i></button>
        </div>
    `).join('');
}

function filterBroadcastCustomers(q) {
    const query = q.toLowerCase();
    const filtered = allCustomersCache.filter(c => c.name.toLowerCase().includes(query) || c.phone.includes(query));
    renderBroadcastList(filtered);
}

function sendPromo(hp, nm, btnEl) {
    let msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    msg = msg.replace(/kak/gi, `Kak *${nm}*`); 
    
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
    
    if(btnEl) { 
        btnEl.disabled = true; 
        btnEl.style.opacity = 0.5; 
    }
}


/**
 * 25. TOOLS: EXPORT DATA (JSON)
 */
function showExportDataPopup() {
    if(Object.keys(dataReservasi).length === 0) return showToast("Data kosong", "error");
    
    const payload = { 
        ver: "6.0", 
        date: new Date().toISOString(), 
        data: dataReservasi, 
        master: locationsData 
    };
    
    const str = JSON.stringify(payload, null, 2);
    document.getElementById('export-data-output').value = str;
    document.getElementById('exportDataPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function copyExportCode() {
    const el = document.getElementById('export-data-output');
    el.select(); 
    document.execCommand('copy');
    showToast("Tersalin ke clipboard!");
}


/**
 * 26. PRINT SYSTEM ADVANCED (FINAL: SORTING FIX & DETAIL MENU)
 */
function printData() {
    if(!tanggalDipilih) return showToast("Pilih tanggal dulu di Kalender!", "error");
    
    document.getElementById('printOptionsPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function executePrint() {
    const list = dataReservasi[tanggalDipilih] || [];
    if(list.length === 0) return showToast("Data kosong pada tanggal ini", "error");

    try {
        const formatEl = document.querySelector('input[name="printFormat"]:checked');
        const format = formatEl ? formatEl.value : 'cards';
        
        // --- LOGIKA SORTING (Fixed Mapping) ---
        const rawSortBy = document.getElementById('print-sort-by').value;
        let sortBy = 'jam'; 
        
        if (rawSortBy === 'name') sortBy = 'nama';
        else if (rawSortBy === 'location') sortBy = 'tempat';
        else if (rawSortBy === 'time') sortBy = 'jam';
        // --------------------------------------

        const showMenu = document.getElementById('print-detail-menu').checked;
        const showKontak = document.getElementById('print-kontak').checked;
        const showDp = document.getElementById('print-dp').checked;
        const showNote = document.getElementById('print-tambahan').checked;

        const sortedList = [...list].sort((a,b) => {
            const valA = (a[sortBy] || '').toString().toLowerCase();
            const valB = (b[sortBy] || '').toString().toLowerCase();
            return valA.localeCompare(valB);
        });

        let contentHtml = '';
        
        if (format === 'table') {
            // --- MODE TABEL ---
            const rows = sortedList.map((r, i) => {
                let menuStr = '-';
                if(showMenu) {
                    if(r.menus && Array.isArray(r.menus) && r.menus.length > 0) {
                        menuStr = r.menus.map(m => {
                            // Detail menu inline
                            let details = '';
                            if(detailMenu[m.name] && detailMenu[m.name].length > 0) {
                                details = `<br><span style="color:#666; font-size:0.8em;">(${detailMenu[m.name].join(', ')})</span>`;
                            }
                            return `${m.quantity}x ${escapeHtml(m.name)}${details}`;
                        }).join('<br>');
                    } else if(r.menu) {
                        menuStr = escapeHtml(r.menu);
                    }
                }
                
                return `<tr>
                    <td style="text-align:center;">${i+1}</td>
                    <td style="text-align:center;">${escapeHtml(r.jam)}</td>
                    <td><b>${escapeHtml(r.nama)}</b>${showKontak ? `<br><small>${escapeHtml(r.nomorHp||'-')}</small>` : ''}</td>
                    <td style="text-align:center;">${r.jumlah}</td>
                    <td>${escapeHtml(r.tempat)}</td>
                    ${showMenu ? `<td><div style="font-size:0.85rem;">${menuStr}</div></td>` : ''}
                    ${showDp ? `<td>${r.dp > 0 ? formatRupiah(r.dp) : 'Belum'}</td>` : ''}
                    ${showNote ? `<td><span style="font-style:italic;">${escapeHtml(r.tambahan||'-')}</span></td>` : ''}
                </tr>`;
            }).join('');

            contentHtml = `
            <table class="print-table">
                <thead>
                    <tr>
                        <th width="5%">No</th>
                        <th width="10%">Jam</th>
                        <th width="20%">Nama</th>
                        <th width="5%">Pax</th>
                        <th width="15%">Tempat</th>
                        ${showMenu ? '<th>Menu</th>' : ''}
                        ${showDp ? '<th width="10%">DP</th>' : ''}
                        ${showNote ? '<th>Catatan</th>' : ''}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
            
        } else {
            // --- MODE KARTU (VISUAL - EQUAL HEIGHT & DETAIL MENU) ---
            contentHtml = `<div class="print-grid">`;
            
            sortedList.forEach((r, i) => {
                let menuHtml = '';
                if (showMenu) {
                    if(r.menus && Array.isArray(r.menus) && r.menus.length > 0) {
                        const items = r.menus.map(m => {
                            // --- LOGIKA TAMPILKAN ISI PAKET ---
                            let detailHtml = '';
                            if(detailMenu[m.name] && detailMenu[m.name].length > 0) {
                                detailHtml = `<div style="font-size:10px; color:#555; margin-left:15px; margin-top:2px;">- ${detailMenu[m.name].join(', ')}</div>`;
                            }
                            // ----------------------------------
                            return `<div style="margin-bottom:4px;"><b>${m.quantity}x</b> ${escapeHtml(m.name)}${detailHtml}</div>`;
                        }).join('');
                        menuHtml = `<div class="print-menu-box">${items}</div>`;
                    } else if(r.menu) {
                        menuHtml = `<div class="print-menu-box">${escapeHtml(r.menu)}</div>`;
                    }
                }

                const dpLabel = r.dp > 0 ? `DP: Rp ${formatRupiah(r.dp)}` : 'BELUM DP';
                const metaRow = `
                    <div class="pc-meta-row">
                        <span>👥 ${r.jumlah} Org</span>
                        <span>📍 ${escapeHtml(r.tempat)}</span>
                    </div>`;

                contentHtml += `
                <div class="print-card">
                    <div>
                        <div class="pc-head">
                            <span class="pc-num">#${i+1}</span>
                            <span class="pc-time">${escapeHtml(r.jam)}</span>
                        </div>
                        <div class="pc-body">
                            <div class="pc-name">${escapeHtml(r.nama)}</div>
                            ${showKontak && r.nomorHp ? `<div class="pc-meta">📞 ${escapeHtml(r.nomorHp)}</div>` : ''}
                            ${metaRow}
                            ${menuHtml}
                        </div>
                    </div>
                    <div>
                         ${showDp ? `<div class="pc-dp">${dpLabel}</div>` : ''}
                         ${showNote && r.tambahan ? `<div class="pc-note">Note: ${escapeHtml(r.tambahan)}</div>` : ''}
                    </div>
                </div>`;
            });
            
            contentHtml += `</div>`;
        }

        const win = window.open('', '_blank');
        if (!win) return showToast("Pop-up diblokir browser. Izinkan pop-up.", "error");
        
        win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Laporan Reservasi - ${tanggalDipilih}</title>
                <style>
                    body { font-family: 'Segoe UI', Helvetica, sans-serif; padding: 20px; color: #000; -webkit-print-color-adjust: exact; }
                    h2 { text-align: center; margin-bottom: 5px; text-transform: uppercase; font-size: 18px; }
                    p.sub { text-align: center; color: #555; margin-top: 0; margin-bottom: 30px; font-size: 13px; border-bottom: 2px solid #000; padding-bottom: 15px; }
                    
                    /* TABLE STYLES */
                    .print-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
                    .print-table th, .print-table td { border: 1px solid #444; padding: 6px 8px; vertical-align: top; }
                    .print-table th { background: #eee; font-weight: bold; }
                    
                    /* CARD STYLES (EQUAL HEIGHT) */
                    .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; align-items: stretch; }
                    .print-card { 
                        border: 1px solid #000; padding: 12px; break-inside: avoid; border-radius: 6px; 
                        display: flex; flex-direction: column; justify-content: space-between; 
                        height: 100%; box-sizing: border-box;
                    }
                    
                    .pc-head { display: flex; justify-content: space-between; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 8px; font-weight: bold; font-size: 14px; }
                    .pc-num { background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
                    .pc-name { font-size: 16px; font-weight: 800; margin-bottom: 4px; text-transform: capitalize; }
                    .pc-meta { font-size: 11px; color: #333; margin-bottom: 4px; }
                    .pc-meta-row { display: flex; gap: 12px; font-weight: 600; font-size: 12px; margin-bottom: 6px; }
                    .print-menu-box { background: #f2f2f2; padding: 6px; border: 1px dashed #999; font-size: 11px; margin: 6px 0; line-height: 1.4; }
                    
                    .pc-dp { font-weight: bold; font-size: 11px; margin-top: 10px; text-align: right; border-top: 1px solid #eee; padding-top: 5px; }
                    .pc-note { font-style: italic; font-size: 10px; margin-top: 5px; background: #fffec8; padding: 3px; }
                    
                    @media print {
                        @page { margin: 1cm; size: auto; }
                        body { margin: 0; }
                        .print-grid { grid-template-columns: 1fr 1fr; } 
                    }
                </style>
            </head>
            <body>
                <h2>Laporan Harian Dolan Sawah</h2>
                <p class="sub">Tanggal: ${tanggalDipilih} ${monthNames[currentMonth]} ${currentYear} | Total: ${sortedList.length} Reservasi</p>
                ${contentHtml}
            </body>
            </html>
        `);
        
        win.document.close();
        
        setTimeout(() => {
            win.focus();
            win.print();
        }, 500);

        closePopup('printOptionsPopup');

    } catch (err) {
        console.error("Print Error:", err);
        showToast("Kesalahan data saat cetak.", "error");
    }
}


/**
 * 27. ANALISIS DATA (CHARTS)
 */
let chartInstance = null;
let chartHours = null;
let chartMenu = null;

function initAnalysisFilters() {
    const yearSel = document.getElementById('anl-year-ui');
    const monthSel = document.getElementById('anl-month-ui');
    
    if(yearSel && yearSel.options.length === 0) {
        const currentY = new Date().getFullYear();
        yearSel.innerHTML = '';
        for(let y = currentY; y >= 2024; y--) {
            yearSel.innerHTML += `<option value="${y}">${y}</option>`;
        }
        
        monthSel.innerHTML = '<option value="all">Semua Bulan</option>';
        monthNames.forEach((m, idx) => {
            monthSel.innerHTML += `<option value="${idx}">${m}</option>`;
        });
    }
}

async function runUIAnalysis() {
    const chartCanvas = document.getElementById('mainChart');
    if(!chartCanvas) return;

    if(!allReservationsCache) {
        showLoader();
        try {
            const snap = await db.collection('reservations').get();
            allReservationsCache = snap.docs.map(d => d.data());
        } catch(e) { hideLoader(); return; }
        hideLoader();
    }
    
    const yearSel = document.getElementById('anl-year-ui');
    const monthSel = document.getElementById('anl-month-ui');
    const selectedYear = parseInt(yearSel.value);
    const selectedMonth = monthSel.value === 'all' ? 'all' : parseInt(monthSel.value);

    const filteredData = allReservationsCache.filter(r => {
        if (!r.date) return false;
        const d = new Date(r.date);
        const matchYear = d.getFullYear() === selectedYear;
        const matchMonth = selectedMonth === 'all' ? true : d.getMonth() === selectedMonth;
        return matchYear && matchMonth;
    });

    // Chart Data Processing
    let labels = [], dataPoints = [];
    if (selectedMonth === 'all') {
        labels = monthNames.map(m => m.substr(0,3));
        dataPoints = Array(12).fill(0);
        filteredData.forEach(r => {
            const d = new Date(r.date);
            dataPoints[d.getMonth()]++;
        });
    } else {
        const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        labels = Array.from({length: daysInMonth}, (_, i) => (i+1).toString());
        dataPoints = Array(daysInMonth).fill(0);
        filteredData.forEach(r => {
            const d = new Date(r.date);
            dataPoints[d.getDate() - 1]++;
        });
    }

    const hoursCounts = {};
    const menuCounts = {};
    const customerStats = {};
    
    filteredData.forEach(r => {
        if(r.jam) {
            const h = r.jam.split(':')[0];
            hoursCounts[h] = (hoursCounts[h] || 0) + 1;
        }
        if (r.menus && Array.isArray(r.menus)) {
            r.menus.forEach(m => { menuCounts[m.name] = (menuCounts[m.name] || 0) + m.quantity; });
        }
        const name = r.nama ? r.nama.trim() : 'Tanpa Nama';
        customerStats[name] = (customerStats[name] || 0) + 1;
    });

    const sortedHours = Object.keys(hoursCounts).sort();
    const hoursData = sortedHours.map(h => hoursCounts[h]);
    const topMenus = Object.entries(menuCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topCustomers = Object.entries(customerStats).sort((a,b) => b[1] - a[1]).slice(0, 10);

    // Render Charts
    const ctx = chartCanvas.getContext('2d');
    if(chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels, 
            datasets: [{
                label: `Reservasi`,
                data: dataPoints,
                borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 2, fill: true, tension: 0.3
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });

    const ctxHours = document.getElementById('hoursChart').getContext('2d');
    if(chartHours) chartHours.destroy();
    chartHours = new Chart(ctxHours, {
        type: 'bar',
        data: { labels: Object.keys(hoursCounts).sort().map(h=>`${h}:00`), datasets: [{ label: 'Jml Transaksi', data: Object.keys(hoursCounts).sort().map(h=>hoursCounts[h]), backgroundColor: '#3b82f6', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const ctxMenu = document.getElementById('menuChart').getContext('2d');
    if(chartMenu) chartMenu.destroy();
    chartMenu = new Chart(ctxMenu, {
        type: 'doughnut',
        data: { labels: topMenus.map(i=>i[0]), datasets: [{ data: topMenus.map(i=>i[1]), backgroundColor: ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    // Render Table
    const tableBody = document.getElementById('top-customer-table');
    if(tableBody) {
        tableBody.innerHTML = Object.entries(customerStats).sort((a,b)=>b[1]-a[1]).slice(0,10).map((c,i)=>`<tr style="border-bottom:1px solid #eee;"><td style="padding:8px; font-weight:600;">${i+1}. ${escapeHtml(c[0])}</td><td style="padding:8px; text-align:center;"><span class="pill" style="background:#f3f4f6;">${c[1]}x</span></td></tr>`).join('');
    }
    
    // Insights
    const totalRevenue = filteredData.reduce((acc, curr) => acc + (parseInt(curr.dp)||0), 0);
    const totalGuest = filteredData.reduce((acc, curr) => acc + (parseInt(curr.jumlah)||0), 0);
    
    document.getElementById('quick-insights').innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:15px;">
            <div class="glass-panel" style="padding:15px; text-align:center; border-left:4px solid #10b981;"><small>Total Reservasi</small><h3 style="margin:5px 0;">${filteredData.length}</h3></div>
            <div class="glass-panel" style="padding:15px; text-align:center; border-left:4px solid #3b82f6;"><small>Total Tamu</small><h3 style="margin:5px 0;">${totalGuest}</h3></div>
            <div class="glass-panel" style="padding:15px; text-align:center; border-left:4px solid #f59e0b;"><small>Total DP Masuk</small><h3 style="margin:5px 0;">Rp ${formatRupiah(totalRevenue)}</h3></div>
        </div>`;
        
    showToast("Analisis Data Diperbarui");
}


/**
 * 28. SETTINGS, BACKGROUND & HELPERS
 */
document.addEventListener('DOMContentLoaded', () => applySavedBackground());

function saveCustomBackground() {
    const url = document.getElementById('bgUrlInput').value.trim();
    if (!url) return showToast("URL kosong", "error");
    localStorage.setItem(BG_STORAGE_KEY, url);
    applySavedBackground(); 
    showToast("Background diganti", "success");
}

function resetBackground() {
    localStorage.removeItem(BG_STORAGE_KEY);
    applySavedBackground(); 
    showToast("Reset default");
}

function setBgFromPreset(el) {
    let style = el.style.backgroundImage;
    let url = style.slice(4, -1).replace(/"/g, "");
    localStorage.setItem(BG_STORAGE_KEY, url);
    applySavedBackground(); 
    showToast("Tema diterapkan");
}

function applySavedBackground() {
    const saved = localStorage.getItem(BG_STORAGE_KEY);
    const root = document.documentElement;
    if (saved) root.style.setProperty('--bg-image', `url('${saved}')`);
    else root.style.setProperty('--bg-image', "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=2232&auto=format&fit=crop')");
}

function setupReliableNotificationChecker() {
    if (notificationInterval) clearInterval(notificationInterval);
    runNotificationCheck();
    notificationInterval = setInterval(runNotificationCheck, 300000);
}

async function runNotificationCheck() {
    if(Object.keys(dataReservasi).length === 0) return;
    const now = new Date();
    let count = 0, html = '';

    for(const k in dataReservasi) {
        dataReservasi[k].forEach(r => {
            if(!r.thankYouSent && r.nomorHp) {
                const dt = new Date(`${currentYear}-${k}T${r.jam}`);
                if(!isNaN(dt.getTime()) && now > new Date(dt.getTime() + (2*3600000))) {
                    count++;
                    html += `<li class="notification-item"><div><b>${escapeHtml(r.nama)}</b></div><button class="btn-icon info" style="width:100%; margin-top:5px;" onclick="sendThankYouMessage('${r.id}','${escapeHtml(r.nama)}','${r.nomorHp}')">Kirim Ucapan</button></li>`;
                }
            }
        });
    }
    const badge = document.getElementById('notification-badge');
    const badgeMobile = document.getElementById('notification-badge-mobile');
    
    if(badge) { badge.textContent = count; badge.style.display = count>0?'flex':'none'; }
    if(badgeMobile) { badgeMobile.style.display = count>0?'block':'none'; }
    
    document.getElementById('notification-list-ul').innerHTML = html || '<li style="padding:15px; text-align:center; color:#999;">Tidak ada pengingat.</li>';
}

function sendThankYouMessage(id, nm, hp) {
    const msg = `Halo Kak *${nm}* 👋,\n\nTerima kasih banyak sudah berkunjung ke *Dolan Sawah* hari ini. 🙏\n\nJika berkenan, kami sangat menghargai masukan atau review Kakak. Ditunggu kedatangannya kembali! ✨`;
    window.open(`https://wa.me/${cleanPhoneNumber(hp)}?text=${encodeURIComponent(msg)}`, '_blank');
    db.collection('reservations').doc(id).update({ thankYouSent: true });
    
    const btn = document.getElementById(`thank-btn-${id}`);
    if(btn) { btn.disabled=true; btn.style.opacity=0.5; }
}

// --- FUNGSI HELPER WA YANG HILANG SEBELUMNYA ---
function formatMenuForWA(menus) {
    if (!menus || !Array.isArray(menus) || menus.length === 0) return "  - (Belum ada menu)";
    
    return menus.map(m => {
        let itemStr = `  - *${m.quantity}x ${m.name}*`;
        if (detailMenu[m.name] && detailMenu[m.name].length > 0) {
            const subItems = detailMenu[m.name].map(d => `      • ${d}`).join('\n');
            itemStr += `\n${subItems}`;
        }
        return itemStr;
    }).join('\n');
}

function contactPersonal(id) {
    let r = null;
    for (const k in dataReservasi) {
        const found = dataReservasi[k].find(x => x.id === id);
        if (found) { r = found; break; }
    }
    if (!r) return showToast("Data tidak ditemukan", "error");
    if (!r.nomorHp) return showToast("Tidak ada nomor HP", "error");

    const menuText = formatMenuForWA(r.menus);
    const dpStatusText = r.dp > 0 
        ? `Rp ${formatRupiah(r.dp)} (via ${r.tipeDp || 'Transfer'}) (Sudah diterima)`
        : `Belum ada DP`;

    const msg = `Halo Kak *${r.nama}* 👋,\n\n` +
                `Kami dari *Dolan Sawah* ingin mengkonfirmasi reservasi:\n\n` +
                `🗓️ *Tanggal:* ${r.date}\n` +
                `⏰ *Jam:* ${r.jam}\n` +
                `📍 *Tempat:* ${r.tempat}\n` +
                `👥 *Jumlah:* ${r.jumlah} orang\n\n` +
                `🍽️ *Pesanan Menu:*\n${menuText}\n\n` +
                `💰 *DP:* ${dpStatusText}\n\n` +
                `Mohon balas pesan ini untuk konfirmasi. Terima kasih! 😊`;

    window.open(`https://wa.me/${cleanPhoneNumber(r.nomorHp)}?text=${encodeURIComponent(msg)}`, '_blank');
}

function shareViaWhatsApp(type) {
    if (type === 'day') {
        if (!tanggalDipilih) return showToast("Pilih tanggal dulu!", "error");
        
        const list = dataReservasi[tanggalDipilih] || [];
        if (list.length === 0) return showToast("Data kosong pada tanggal ini", "error");
        
        let msg = `*📋 LAPORAN HARIAN DOLAN SAWAH*\n` +
                  `*Tanggal:* ${tanggalDipilih} ${monthNames[currentMonth]} ${currentYear}\n` +
                  `=========================\n\n`;
        
        list.sort((a,b) => (a.jam||'').localeCompare(b.jam||''));

        list.forEach((r, i) => {
            const dpText = r.dp > 0 ? `*LUNAS DP*` : `*BELUM DP*`;
            msg += `*${i+1}. ${r.nama}* (${r.jam})\n`;
            msg += `   Pax: ${r.jumlah} | Lok: ${r.tempat}\n`;
            msg += `   Status: ${dpText}\n\n`;
        });
        
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    }
}

// --- UTILITIES DASAR (LENGKAP) ---
function formatRupiah(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '0';
    return Number(amount).toLocaleString('id-ID');
}

function cleanPhoneNumber(phone) { 
    if(!phone) return '';
    return phone.toString().replace(/[^0-9]/g, ''); 
}

function isValidPhone(phone) { 
    const cleaned = cleanPhoneNumber(phone);
    return /^[0-9]{10,14}$/.test(cleaned); 
}

function escapeHtml(text) {
  if (!text) return text;
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

function showToast(message, type = 'success') {
    let icon = type === 'error' ? '<i class="fas fa-exclamation-circle"></i>' : '<i class="fas fa-check-circle"></i>';
    if(type === 'info') icon = '<i class="fas fa-info-circle"></i>';
    
    toast.innerHTML = `${icon} &nbsp; ${message}`;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => { toast.style.opacity = 1; }, 10);
    setTimeout(() => { 
        toast.style.opacity = 0;
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3500);
}

function showLoader() { if(loadingOverlay) loadingOverlay.style.display = 'flex'; }
function hideLoader() { if(loadingOverlay) loadingOverlay.style.display = 'none'; }

function closePopup(popupId) {
    const popup = document.getElementById(popupId);
    if(popup) popup.style.display = 'none';
    if(overlay) overlay.style.display = 'none';
}

function forceSync() { 
    showLoader(); 
    setTimeout(() => location.reload(), 800); 
}

function toggleNotificationDropdown(e) { 
    e.stopPropagation(); 
    const d = document.getElementById('notification-dropdown'); 
    d.style.display = d.style.display === 'block' ? 'none' : 'block'; 
}

window.addEventListener('click', () => { 
    const d = document.getElementById('notification-dropdown'); 
    if(d) d.style.display = 'none'; 
});

console.log("Dolan Sawah App Loaded: Ultimate Edition - Final V3 (Full Code).");
