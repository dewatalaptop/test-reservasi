// ============================================================================
// FILE: app.js
// BAGIAN 1: KONFIGURASI, STATE, OTENTIKASI & UTILITIES
// ============================================================================

/**
 * 1. KONFIGURASI FIREBASE
 * Koneksi ke database backend.
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
let dataReservasi = {};       // Menyimpan data kalender (Key: "MM-DD", Value: Array Reservasi)
let allReservationsList = []; // Array flat semua reservasi bulan ini (untuk statistik dashboard & search)
let requestsCache = [];       // Menyimpan data inbox permintaan yang belum diapprove
let allReservationsCache = null; // Cache berat untuk analisis tahunan (lazy load)

// --- Cache Data Master ---
let detailMenu = {};          // Key: Nama Menu, Value: Array Detail (misal: ["Pedas", "Manis"])
let menuPrices = {};          // Key: Nama Menu, Value: Harga (Number)
let locationsData = {};       // Key: ID Dokumen, Value: Object {name, capacity}

// --- State Navigasi & Kalender ---
let tanggalDipilih = '';      // Format "MM-DD" saat user klik tanggal
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// --- Listener Realtime (Disimpan untuk cleanup saat logout) ---
let unsubscribeReservations = null;
let unsubscribeRequests = null;

// --- State Fitur Tambahan ---
let hasAutoOpened = false;       // Mencegah auto-popup berulang saat deep link
let notificationInterval = null; // Interval cek pengingat "Say Thanks"
let promoMessageCache = null;    // Template pesan broadcast
let allCustomersCache = [];      // Data unik customer untuk broadcast

const BROADCAST_MESSAGE_KEY = 'dolanSawahBroadcastMessage'; // LocalStorage Key


/**
 * 3. REFERENSI DOM GLOBAL
 * Cache elemen UI yang sering diakses.
 */
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');
const overlay = document.getElementById('overlay');


/**
 * 4. SISTEM OTENTIKASI (AUTH)
 * Menangani logika Login, Logout, dan Transisi UI.
 */
auth.onAuthStateChanged(user => {
    const loginContainer = document.getElementById('login-container');
    const appLayout = document.getElementById('app-layout');
    
    if (user) {
        // --- USER LOGIN ---
        console.log("Auth: User terhubung (" + user.email + ")");
        
        // Transisi Tampilan
        if(loginContainer) loginContainer.style.display = 'none';
        if(appLayout) {
            appLayout.style.display = 'block';
            // Efek Fade In halus
            appLayout.style.opacity = 0;
            setTimeout(() => { 
                appLayout.style.transition = 'opacity 0.5s'; 
                appLayout.style.opacity = 1; 
            }, 50);
        }
        
        // Update Tanggal di Header
        updateHeaderDate();
        
        // Mulai Load Data Aplikasi
        initializeApp(); 
        
    } else {
        // --- USER LOGOUT ---
        console.log("Auth: User logout");
        
        if(loginContainer) loginContainer.style.display = 'flex';
        if(appLayout) appLayout.style.display = 'none';
        
        // Bersihkan data dan listener untuk keamanan memori
        cleanupApp();
    }
});

async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('login-error');
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  // Validasi Input
  if (!email || !password) { 
      errorEl.textContent = 'Email dan password wajib diisi.'; 
      errorEl.style.display = 'block'; 
      return; 
  }
  
  showLoader();
  
  try { 
      await auth.signInWithEmailAndPassword(email, password); 
      // Sukses: onAuthStateChanged akan menangani sisanya
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
        title: 'Logout?',
        text: "Anda akan keluar dari dashboard admin.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
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
    
    // Reset Variable
    dataReservasi = {};
    requestsCache = [];
    allReservationsList = [];
}


/**
 * 5. NAVIGASI UI (SIDEBAR & TABS)
 * Mengatur perpindahan halaman dashboard tanpa reload (SPA Feeling).
 */
function switchTab(tabId) {
    // 1. Sembunyikan semua konten tab
    document.querySelectorAll('.content-section').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none'; // Paksa display none untuk layout clean
    });

    // 2. Tampilkan tab yang dipilih
    const target = document.getElementById('tab-' + tabId);
    if (target) {
        target.style.display = 'block';
        setTimeout(() => target.classList.add('active'), 10); // Trigger animasi CSS
    }
    
    // 3. Update status Active di Sidebar Menu
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    // Cari elemen nav-item yang memiliki onclick ke tabId ini
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if(item.getAttribute('onclick').includes(tabId)) {
            item.classList.add('active');
        }
    });

    // 4. Update Judul Halaman
    const titles = {
        'dashboard': 'Dashboard Overview',
        'inbox': 'Inbox Permintaan',
        'calendar': 'Kalender Reservasi',
        'data': 'Manajemen Data Master',
        'broadcast': 'Broadcast Promosi',
        'analysis': 'Analisis Bisnis'
    };
    const titleEl = document.getElementById('page-title');
    if(titleEl) titleEl.innerText = titles[tabId] || 'Dashboard';

    // 5. UX Mobile: Tutup sidebar otomatis setelah klik menu
    if(window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if(sidebar && sidebar.classList.contains('open')) toggleSidebar();
    }

    // 6. Trigger Khusus (Lazy Load Chart)
    if(tabId === 'analysis' && typeof runUIAnalysis === 'function') {
        runUIAnalysis();
    }
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const btn = document.getElementById('mobile-toggle');
    sb.classList.toggle('open');
    
    // Ubah ikon toggle
    btn.innerHTML = sb.classList.contains('open') 
        ? '<i class="fas fa-times"></i>' 
        : '<i class="fas fa-bars"></i>';
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
 * 6. FUNGSI UTILITIES & HELPERS
 * Fungsi pendukung yang digunakan di seluruh aplikasi.
 */

// Format Rupiah (Rp 10.000)
function formatRupiah(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '0';
    return Number(amount).toLocaleString('id-ID');
}

// Bersihkan No HP (0812-345 -> 0812345)
function cleanPhoneNumber(phone) { 
    if(!phone) return '';
    return phone.toString().replace(/[^0-9]/g, ''); 
}

// Validasi Format HP (10-14 digit)
function isValidPhone(phone) { 
    const cleaned = cleanPhoneNumber(phone);
    return /^[0-9]{10,14}$/.test(cleaned); 
}

// Keamanan: Escape HTML untuk mencegah XSS
function escapeHtml(text) {
  if (!text) return text;
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

// UI: Toast Notification
function showToast(message, type = 'success') {
    toast.innerHTML = type === 'error' 
        ? `<i class="fas fa-exclamation-circle"></i> ${message}`
        : `<i class="fas fa-check-circle"></i> ${message}`;
    
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    
    // Animasi Masuk
    setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = 1; }, 10);

    // Hilang Otomatis
    setTimeout(() => { 
        toast.style.transform = 'translateX(-50%) translateY(20px)'; 
        toast.style.opacity = 0;
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3500);
}

// UI: Loading Spinner
function showLoader() { if(loadingOverlay) loadingOverlay.style.display = 'flex'; }
function hideLoader() { if(loadingOverlay) loadingOverlay.style.display = 'none'; }

// UI: Tutup Popup
function closePopup(popupId) {
    const popup = document.getElementById(popupId);
    if(popup) popup.style.display = 'none';
    if(overlay) overlay.style.display = 'none';
}

// Helper: Deteksi klik di luar sidebar (Mobile)
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('mobile-toggle');
    if(window.innerWidth < 768 && sidebar && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
            toggleSidebar();
        }
    }
});
// ============================================================================
// FILE: app.js
// BAGIAN 2: DATA INITIALIZATION & INBOX SYSTEM (RICH FEATURES)
// ============================================================================

/**
 * 7. INISIALISASI APLIKASI
 * Fungsi sentral yang dipanggil setelah login berhasil.
 * Mengatur urutan loading data agar dependensi terpenuhi.
 */
async function initializeApp() { 
  showLoader();
  try {
    console.log("System: Memulai Inisialisasi...");

    // 1. Cek URL Parameter (Deep Linking Logic)
    // Berguna jika admin membuka link spesifik dari notifikasi WA
    const urlParams = new URLSearchParams(window.location.search);
    const paramDate = urlParams.get('date');

    if (paramDate) {
        const d = new Date(paramDate);
        if (!isNaN(d.getTime())) {
            currentMonth = d.getMonth();
            currentYear = d.getFullYear();
        }
    }

    // 2. Load Data Master (Parallel)
    // Kita WAJIB memuat Menu (untuk harga) dan Lokasi (untuk kapasitas) 
    // sebelum memuat data reservasi/inbox agar tidak ada error "undefined".
    await Promise.all([
        loadMenus(),     // Mengisi detailMenu dan menuPrices
        loadLocations()  // Mengisi locationsData
    ]);

    // 3. Setup Listeners Realtime (Data Transaksi)
    loadReservationsForCurrentMonth(); // Listener Kalender (Bagian 3)
    initInboxListener();               // Listener Inbox Request
    
    // 4. Setup Background Jobs
    setupReliableNotificationChecker(); // Cek pengingat "Say Thanks" (Bagian 5)

    console.log("System: Inisialisasi Selesai.");

  } catch (e) {
    console.error("Init Error:", e);
    showToast("Gagal memuat data aplikasi. Silakan refresh.", "error");
    hideLoader();
  }
}


/**
 * 8. LOAD DATA MASTER (MENU & LOKASI)
 * Mengambil data referensi untuk validasi dan UI.
 */
async function loadMenus() {
  try {
    const snapshot = await db.collection('menus').get();
    
    // Reset Global Cache
    detailMenu = {};
    menuPrices = {}; 
    
    // Siapkan HTML untuk tab "Data Master"
    const previewList = document.getElementById('preview-menu-list');
    let htmlContent = '';

    if (snapshot.empty) {
        if(previewList) previewList.innerHTML = '<div class="text-center text-muted p-3">Belum ada data menu.</div>';
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        
        // Simpan ke Cache Global
        detailMenu[doc.id] = data.details || []; 
        menuPrices[doc.id] = data.price || 0;
        
        // Render Item List (Desain Modern)
        htmlContent += `
        <div class="menu-item">
            <div style="flex:1;">
                <div style="font-weight:600; color:var(--text-main);">${escapeHtml(doc.id)}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">
                    ${data.details && data.details.length ? data.details.join(', ') : '-'}
                </div>
            </div>
            <div style="font-weight:600; color:var(--success);">
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
            if(previewList) previewList.innerHTML = '<div class="text-center text-muted p-3">Belum ada lokasi.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Simpan ke Cache Global (Key = ID Dokumen)
            locationsData[doc.id] = {
                name: data.name,
                capacity: data.capacity
            };
            
            // Render Item List
            htmlContent += `
            <div class="menu-item">
                <div style="flex:1;">
                    <div style="font-weight:600; color:var(--text-main);">${escapeHtml(data.name)}</div>
                </div>
                <div class="pill pill-primary">
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


/**
 * 9. SISTEM INBOX PERMINTAAN (INTEGRASI WEB 2)
 * Menangani reservasi yang masuk dari form customer (Status: Pending).
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
            <p style="font-size:0.9rem;">Tidak ada permintaan reservasi baru saat ini.</p>
        </div>`;
        return;
    }

    // Render Cards
    container.innerHTML = requestsCache.map(r => {
        // Generate Rincian Menu & Harga
        let menuHtml = '<div style="color:#999; font-style:italic; font-size:0.85rem; padding:10px;">Tidak ada detail menu</div>';
        
        if(r.menus && Array.isArray(r.menus) && r.menus.length > 0) {
            const listItems = r.menus.map(m => {
                // Kalkulasi harga per item (menggunakan cache menuPrices)
                const unitPrice = menuPrices[m.name] || 0;
                const subtotal = unitPrice * m.quantity;
                
                return `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.03);">
                    <span><b>${m.quantity}x</b> ${escapeHtml(m.name)}</span>
                    <span style="color:#666;">Rp ${formatRupiah(subtotal)}</span>
                </div>`;
            }).join('');
            
            menuHtml = `<div style="padding:10px; background:rgba(255,255,255,0.5); border-radius:8px;">${listItems}</div>`;
        }

        // Label Sumber (Via Web / Manual)
        const viaBadge = r.via 
            ? `<span class="req-via" style="background:#e0f2fe; color:#0284c7;">${escapeHtml(r.via)}</span>` 
            : `<span class="req-via">Web</span>`;

        return `
        <div class="request-card glass-card">
            <div class="request-header">
                <div>
                    <span class="req-name">${escapeHtml(r.nama)}</span>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${r.nomorHp || '-'}</div>
                </div>
                ${viaBadge}
            </div>
            
            <div class="req-details">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div style="background:#f8fafc; padding:8px; border-radius:8px; text-align:center;">
                        <i class="far fa-calendar-alt" style="color:var(--primary);"></i>
                        <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(r.date)}</div>
                    </div>
                    <div style="background:#f8fafc; padding:8px; border-radius:8px; text-align:center;">
                        <i class="far fa-clock" style="color:var(--primary);"></i>
                        <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(r.jam)}</div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; padding:0 5px;">
                    <span><i class="fas fa-users" style="color:var(--primary);"></i> ${r.jumlah} Org</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${escapeHtml(r.tempat)}</span>
                </div>
            </div>
            
            <div class="req-menu-box" style="margin:15px 0;">
                <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:5px;">Rincian Pesanan</div>
                ${menuHtml}
            </div>
            
            ${r.tambahan ? `
            <div style="font-size:0.85rem; color:#d97706; background:#fffbeb; padding:10px; border-radius:8px; margin-bottom:15px; border-left:3px solid #f59e0b;">
                <i class="fas fa-sticky-note"></i> <b>Catatan:</b> ${escapeHtml(r.tambahan)}
            </div>` : ''}
            
            <div class="req-actions">
                <button class="btn-sm btn-whatsapp" onclick="prepareInboxChat('${r.id}')" title="Hubungi Pelanggan">
                    <i class="fab fa-whatsapp"></i> Chat
                </button>
                <button class="btn-sm btn-danger" onclick="rejectRequest('${r.id}')" title="Tolak">
                    <i class="fas fa-times"></i> Tolak
                </button>
                <button class="btn-sm btn-primary" onclick="approveRequest('${r.id}')" title="Approve">
                    <i class="fas fa-check"></i> Terima
                </button>
            </div>
        </div>`;
    }).join('');
}


/**
 * 10. FITUR CHAT WHATSAPP CERDAS
 * Menghitung total harga dan membuat template pesan konfirmasi otomatis.
 */
function prepareInboxChat(id) {
    const r = requestsCache.find(item => item.id === id);
    if (!r) { showToast("Data permintaan tidak ditemukan", "error"); return; }

    let totalFood = 0;
    let orderSummary = "";
    
    // Kalkulasi Total Harga berdasarkan Cache Harga
    if (r.menus && Array.isArray(r.menus)) {
        r.menus.forEach(m => {
            let unitPrice = menuPrices[m.name] || 0;
            let sub = unitPrice * m.quantity;
            totalFood += sub;
            orderSummary += `   • ${m.name} (${m.quantity}x) : Rp ${formatRupiah(sub)}\n`;
        });
    }
    
    // Kalkulasi DP (Contoh logika: 50% dari total)
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
 * 11. LOGIKA APPROVE REQUEST (BATCH TRANSACTION)
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
                <label style="font-weight:600; font-size:0.9rem;">Nominal DP Masuk (Rp)</label>
                <input id="swal-input-dp" type="number" class="swal2-input" placeholder="0" style="margin-top:5px;">
            </div>
            <div style="text-align:left;">
                <label style="font-weight:600; font-size:0.9rem;">Metode Pembayaran</label>
                <select id="swal-input-type" class="swal2-select" style="display:block; width:100%; margin-top:5px;">
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
        confirmButtonColor: 'var(--primary)',
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
 * 12. LOGIKA REJECT REQUEST
 * Menghapus permanen dengan konfirmasi aman.
 */
async function rejectRequest(id) {
    const result = await Swal.fire({
        title: 'Tolak Permintaan?',
        text: "Data ini akan dihapus permanen dari inbox.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
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
// ============================================================================
// FILE: app.js
// BAGIAN 3: SYSTEM KALENDER UTAMA, DETAIL VIEW & DASHBOARD STATS
// ============================================================================

/**
 * 13. LOAD RESERVASI BULANAN (CORE LISTENER)
 * Mengambil data reservasi range 1 bulan penuh secara realtime.
 * Data ini digunakan sekaligus untuk Kalender dan Statistik Dashboard.
 */
function loadReservationsForCurrentMonth() {
  // Matikan listener sebelumnya agar tidak menumpuk saat ganti bulan/tahun
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
        allReservationsList = []; // Flat list untuk statistik

        snapshot.forEach(doc => {
          const r = { id: doc.id, ...doc.data() };
          
          // Masukkan ke Flat List (untuk statistik dashboard & search global)
          allReservationsList.push(r);

          // Masukkan ke Grouping Tanggal (untuk render kalender)
          // Kita ambil substring "MM-DD" dari string "YYYY-MM-DD"
          const dateKey = r.date.substring(5); 
          
          if (!dataReservasi[dateKey]) {
              dataReservasi[dateKey] = [];
          }
          dataReservasi[dateKey].push(r);
        });
        
        // 1. Render Ulang Grid Kalender
        buatKalender();
        
        // 2. Update Widget & List di Halaman Dashboard
        updateDashboardWidgets(allReservationsList);

        // 3. Cek Auto Open (Deep Link dari WA, jika ada parameter di URL)
        handleAutoOpen();

        // 4. Jika user sedang membuka detail tanggal tertentu, refresh list-nya secara realtime
        // (Agar jika ada data baru masuk di tanggal yg sedang dibuka, langsung muncul tanpa refresh)
        if (tanggalDipilih && !hasAutoOpened) {
            const reservations = dataReservasi[tanggalDipilih] || [];
            updateReservationList(reservations);
        }
        
        hideLoader();
      }, 
      err => { 
          console.error("Reservation Listener Error:", err);
          showToast("Gagal memuat data kalender. Periksa koneksi.", "error");
          hideLoader(); 
      }
    );
}


/**
 * 14. UPDATE DASHBOARD WIDGETS
 * Menghitung statistik dan menampilkan "Reservasi Terbaru" di tab Dashboard.
 */
function updateDashboardWidgets(allData) {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // --- Widget 1: Tamu Hari Ini ---
    // Hitung jumlah reservasi yang tanggalnya hari ini
    const todayCount = allData.filter(r => r.date === todayStr).length;
    const statToday = document.getElementById('stat-today-count');
    if(statToday) statToday.textContent = todayCount;

    // --- Widget 2: Omzet DP Bulan Ini ---
    // Menjumlahkan field 'dp' dari semua reservasi yang termuat (bulan ini)
    const totalDp = allData.reduce((acc, curr) => acc + (parseInt(curr.dp) || 0), 0);
    const statRev = document.getElementById('stat-revenue-month');
    if(statRev) statRev.textContent = 'Rp ' + formatRupiah(totalDp);

    // --- Widget List: Reservasi Terbaru (5 Terakhir) ---
    const recentListContainer = document.getElementById('dashboard-recent-list');
    if (recentListContainer) {
        // Sort berdasarkan waktu input (createdAt) descending
        // Handle null safety jika ada data lama tanpa createdAt
        const sortedRecent = [...allData].sort((a,b) => {
            const timeA = a.createdAt ? a.createdAt.seconds : 0;
            const timeB = b.createdAt ? b.createdAt.seconds : 0;
            return timeB - timeA;
        }).slice(0, 5); // Ambil 5 teratas

        if (sortedRecent.length === 0) {
            recentListContainer.innerHTML = '<p class="text-center text-muted" style="padding:20px;">Belum ada reservasi bulan ini.</p>';
        } else {
            recentListContainer.innerHTML = sortedRecent.map(r => `
                <div class="reservation-list-item">
                    <div style="flex:1;">
                        <div style="font-weight:600; color:var(--text-main);">${escapeHtml(r.nama)}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
                            <i class="far fa-calendar"></i> ${r.date} &bull; <i class="far fa-clock"></i> ${r.jam}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span class="pill pill-primary" style="font-size:0.8rem;">${r.jumlah} Org</span>
                        <div style="font-size:0.75rem; color:#888; margin-top:2px;">${escapeHtml(r.tempat)}</div>
                    </div>
                </div>
            `).join('');
        }
    }
}


/**
 * 15. RENDER GRID KALENDER
 * Membuat kotak-kotak tanggal sesuai bulan yang dipilih.
 * Logika Grid: Minggu (0) sampai Sabtu (6).
 */
function buatKalender() {
  const calendarEl = document.getElementById('calendar');
  const monthYearEl = document.getElementById('monthYear');
  
  if(!calendarEl || !monthYearEl) return;

  calendarEl.innerHTML = ''; 
  monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Logika Hari: Mencari hari apa tanggal 1 dimulai
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Minggu
  
  // Total hari dalam bulan ini
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate(); 
  
  // Render Filler (Kotak kosong transparan sebelum tanggal 1)
  for (let i = 0; i < firstDayIndex; i++) { 
      calendarEl.insertAdjacentHTML('beforeend', `<div class="calendar-day disabled" style="cursor:default; background:transparent; border:none; box-shadow:none;"></div>`); 
  }
  
  // Render Tanggal 1 s/d Akhir
  for (let i = 1; i <= daysInMonth; i++) {
    // Key format: "MM-DD"
    const dateKey = `${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    // Cek Status Hari Ini
    const isToday = new Date().toDateString() === new Date(currentYear, currentMonth, i).toDateString() ? 'today' : '';
    
    // Cek Status Terpilih
    const isSelected = dateKey === tanggalDipilih ? 'selected' : '';
    
    // Hitung Jumlah Reservasi
    const dailyData = dataReservasi[dateKey] || [];
    const countHTML = dailyData.length > 0 
        ? `<span class="reservation-count">${dailyData.length} Res</span>` 
        : '';
    
    // Generate HTML Kotak Tanggal
    calendarEl.insertAdjacentHTML('beforeend', `
      <div class="calendar-day ${isToday} ${isSelected}" onclick="pilihTanggal(${i})">
        <span class="day-number">${i}</span>
        ${countHTML}
      </div>`);
  }
}


/**
 * 16. INTERAKSI TANGGAL (DETAIL VIEW)
 * Saat user klik tanggal di kalender, tampilkan detail di bawahnya.
 */
function pilihTanggal(day) {
  // Set global state
  tanggalDipilih = `${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Refresh highlight di kalender (agar tanggal yg dipilih berwarna hijau/aktif)
  buatKalender(); 
  
  // Ambil data spesifik tanggal ini dari cache
  const reservations = dataReservasi[tanggalDipilih] || [];
  
  // Update Judul Section Detail
  const viewTitle = document.getElementById('reservation-view-title');
  if(viewTitle) {
      viewTitle.innerHTML = `<i class="far fa-calendar-check"></i> Reservasi: ${day} ${monthNames[currentMonth]} ${currentYear}`;
  }
  
  // Reset Search Bar Detail
  const searchInput = document.getElementById('detailSearchInput');
  if(searchInput) searchInput.value = ''; 
  
  // Render List Detail
  updateReservationList(reservations); 
  
  // Tampilkan Container Detail & Scroll ke sana dengan mulus
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) {
      viewContainer.style.display = 'block';
      viewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Tutup Detail View (Tombol X atau Navigasi)
function kembaliKeKalender() {
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) viewContainer.style.display = 'none';
  
  tanggalDipilih = ''; // Reset pilihan
  buatKalender();      // Hapus highlight
}


/**
 * 17. RENDER LIST DETAIL RESERVASI (KARTU DETAIL)
 * Menampilkan kartu detail untuk setiap reservasi di tanggal yang dipilih.
 * Termasuk logika tombol "Say Thanks", indikator DP, dan rincian menu.
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
            <button class="btn-sm btn-primary" onclick="showAddForm()" style="margin-top:10px;">
                <i class="fas fa-plus"></i> Tambah Baru
            </button>
        </div>`; 
        return;
    }
    
    // Urutkan berdasarkan Jam (Pagi ke Malam)
    const sortedRes = [...reservations].sort((a,b) => (a.jam || '').localeCompare(b.jam || ''));
    
    container.innerHTML = sortedRes.map(r => {
        // --- LOGIKA RENDER MENU ---
        // Mendukung format baru (Array Object) dan format lama (String)
        let menuItemsHtml = "<small style='color:#ccc; font-style:italic;'>Tidak ada menu</small>";
        
        if (Array.isArray(r.menus) && r.menus.length > 0) {
            // Format Baru: Tampilkan list rapi
            menuItemsHtml = r.menus.map(item => {
                // Ambil detail menu dari master data (jika ada)
                const details = detailMenu[item.name] || [];
                const detailStr = details.length > 0 
                    ? `<div style="font-size:0.75rem; color:#888; margin-left:18px;">- ${details.join(', ')}</div>` 
                    : '';
                return `<div style="margin-bottom:4px;">
                            <b>${item.quantity}x</b> ${escapeHtml(item.name)}
                            ${detailStr}
                        </div>`;
            }).join('');
        } else if (r.menu) { 
            // Format Lama: String tunggal
            menuItemsHtml = `<div>${escapeHtml(r.menu)}</div>`;
        }

        // --- LOGIKA BADGE DP ---
        const dpInfo = r.dp > 0 
            ? `<span class="pill" style="background:#dcfce7; color:#166534; font-size:0.75rem; border:1px solid #bbf7d0;">
                <i class="fas fa-check"></i> DP: Rp${formatRupiah(r.dp)} (${r.tipeDp || '?'})
               </span>` 
            : `<span class="pill" style="background:#fee2e2; color:#991b1b; font-size:0.75rem; border:1px solid #fecaca;">
                <i class="fas fa-exclamation-circle"></i> Tanpa DP
               </span>`;
        
        // --- LOGIKA TOMBOL 'SAY THANKS' ---
        // Tombol berubah status jika ucapan sudah dikirim
        let thanksBtn = '';
        if(r.nomorHp) {
            if (r.thankYouSent) {
                thanksBtn = `<button class="btn-sm btn-secondary-outlined" disabled style="opacity:0.6; cursor:default; border-color:#ccc; color:#888;">
                                <i class="fas fa-check-double"></i> Thanks Sent
                             </button>`;
            } else {
                thanksBtn = `<button class="btn-sm btn-info" id="thank-btn-${r.id}" onclick="sendThankYouMessage('${r.id}', '${escapeHtml(r.nama)}', '${r.nomorHp}')">
                                <i class="fas fa-gift"></i> Say Thanks
                             </button>`;
            }
        }

        // --- RENDER KARTU HTML ---
        return `
        <div class="reservation-item glass-card" style="margin:0; padding:20px;">
            <div style="border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:5px;">
                    <h4 style="margin:0; color:var(--primary-dark); font-size:1.1rem;">${escapeHtml(r.nama)}</h4>
                    ${dpInfo}
                </div>
                <div style="font-size:0.9rem; color:#555; display:flex; gap:12px; flex-wrap:wrap;">
                    <span><i class="fas fa-clock" style="color:var(--primary);"></i> ${r.jam}</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${escapeHtml(r.tempat)}</span>
                    <span><i class="fas fa-users" style="color:var(--primary);"></i> <b>${r.jumlah}</b> Org</span>
                </div>
                ${r.nomorHp ? `<div style="font-size:0.85rem; color:#666; margin-top:5px;"><i class="fas fa-phone"></i> ${r.nomorHp}</div>` : ''}
            </div>
            
            <div class="menu-detail">
                <div style="display:flex; align-items:center; gap:5px; color:var(--accent); font-weight:600; margin-bottom:5px; font-size:0.85rem;">
                    <i class="fas fa-utensils"></i> RINCIAN PESANAN:
                </div>
                <div style="padding-left:5px;">${menuItemsHtml}</div>
            </div>
            
            ${r.tambahan ? `<div style="font-size:0.85rem; color:#d97706; margin-top:8px; background:#fffbeb; padding:8px; border-radius:6px; border:1px dashed #fcd34d;"><i class="fas fa-comment-dots"></i> <b>Catatan:</b> ${escapeHtml(r.tambahan)}</div>` : ''}
            
            <div style="display:flex; gap:8px; margin-top:15px; flex-wrap:wrap; border-top:1px solid rgba(0,0,0,0.05); padding-top:12px;">
                ${r.nomorHp ? `<button class="btn-sm btn-whatsapp" onclick="contactViaWhatsApp('${r.id}')"><i class="fab fa-whatsapp"></i> Chat</button>` : ''}
                ${thanksBtn}
                <div style="flex:1;"></div> <button class="btn-sm btn-secondary-outlined" onclick="editReservasi('${r.id}')" title="Edit Data"><i class="fas fa-edit"></i></button>
                <button class="btn-sm btn-danger-outlined" onclick="hapusReservasi('${r.id}')" title="Hapus Data"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}


/**
 * 18. NAVIGASI BULAN & SEARCH
 * Fungsi helper untuk navigasi kalender.
 */
function navigateMonth(direction) {
    currentMonth += direction;
    
    // Handle pergantian tahun
    if (currentMonth < 0) { 
        currentMonth = 11; 
        currentYear--; 
    }
    if (currentMonth > 11) { 
        currentMonth = 0; 
        currentYear++; 
    }
    
    // Refresh View
    kembaliKeKalender(); // Tutup detail view
    loadReservationsForCurrentMonth(); // Load data bulan baru
}

// Shortcuts Navigasi
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

// Search Filter (Pencarian Lokal di Detail View)
function filterReservations(query) {
  if (!tanggalDipilih || !dataReservasi[tanggalDipilih]) return;
  
  const q = query.toLowerCase();
  const rawList = dataReservasi[tanggalDipilih];
  
  // Filter berdasarkan Nama, Tempat, HP, Menu
  const filtered = rawList.filter(r => 
    (r.nama && r.nama.toLowerCase().includes(q)) || 
    (r.tempat && r.tempat.toLowerCase().includes(q)) ||
    (r.nomorHp && r.nomorHp.includes(q)) ||
    (r.menus && r.menus.some(m => m.name.toLowerCase().includes(q))) || // Cek array menu
    (r.menu && r.menu.toLowerCase().includes(q)) // Cek legacy menu string
  );
  
  updateReservationList(filtered);
}

// Deep Link Auto Open (Membuka tanggal otomatis jika ada parameter URL)
function handleAutoOpen() {
    const urlParams = new URLSearchParams(window.location.search);
    const shouldOpen = urlParams.get('autoOpen');
    
    if (shouldOpen && !hasAutoOpened) {
        const paramDate = urlParams.get('date');
        const paramSearch = urlParams.get('search');
        
        if (paramDate) {
            const d = new Date(paramDate);
            // Pastikan kita sudah load bulan yang benar
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                const day = d.getDate();
                pilihTanggal(day); // Buka Detail View
                
                if(paramSearch) {
                    const searchInput = document.getElementById('detailSearchInput');
                    if(searchInput) {
                        searchInput.value = paramSearch;
                        filterReservations(paramSearch);
                    }
                }
                
                hasAutoOpened = true; // Tandai selesai agar tidak popup terus
                showToast("Membuka data reservasi...");
                
                // Bersihkan URL agar bersih (optional)
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 4: MANAJEMEN CRUD RESERVASI (MANUAL & VALIDASI)
// ============================================================================

/**
 * 19. TAMPILKAN FORM TAMBAH (RESET UI)
 * Menyiapkan popup formulir untuk input data baru.
 */
function showAddForm() {
    const form = document.getElementById('reservation-form');
    if (!form) return;

    // Reset Form & Error Messages
    form.reset();
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('input-error'));
    
    // Validasi UI: Pastikan tanggal sudah dipilih di kalender
    // Jika belum (misal dari tombol Quick Action), default ke hari ini
    if (!tanggalDipilih) {
        const now = new Date();
        tanggalDipilih = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    // Populate Dropdown Lokasi (Dari Data Master yang sudah diload di Bagian 2)
    const tempatSelect = form.querySelector('#tempat');
    populateLocationDropdown(tempatSelect);
    
    // Reset Info Kapasitas
    updateCapacityInfo('reservation-form');
    
    // Reset Container Menu (Hapus sisa input sebelumnya)
    const menuContainer = document.getElementById('selected-menus-container');
    menuContainer.innerHTML = '';
    
    // Tambahkan 1 baris menu kosong sebagai default
    addMenuSelectionRow('reservation-form');
    
    // Tampilkan Popup
    document.getElementById('addFormPopup').style.display = 'block';
    overlay.style.display = 'block';
}


/**
 * 20. TAMPILKAN FORM EDIT (INJECT HTML)
 * Mengambil data reservasi yang ada, mengisi form, dan menampilkannya.
 */
function editReservasi(id) {
  // 1. Cari data reservasi di cache lokal (dataReservasi)
  let res = null;
  // Loop semua tanggal untuk menemukan ID unik ini
  for (const dateKey in dataReservasi) {
      const found = dataReservasi[dateKey].find(r => r.id === id);
      if (found) { 
          res = found; 
          break; 
      }
  }

  if (!res) { 
      showToast("Data reservasi tidak ditemukan di cache.", "error"); 
      return; 
  }
  
  // 2. Siapkan Container Popup Edit
  // Kita inject HTML Form secara dinamis agar terpisah dari form Tambah
  const formContainer = document.getElementById('editFormPopup');
  
  formContainer.innerHTML = `
    <div class="popup-header" style="background: linear-gradient(135deg, var(--accent), #b45309);">
        <h3><i class="fas fa-edit"></i> Edit Data</h3>
        <button class="close-popup-btn" onclick="closePopup('editFormPopup')">&times;</button>
    </div>
    <form id="edit-reservation-form" style="padding:25px;">
      <input type="hidden" id="editReservationId" value="${res.id}" />
      
      <div class="form-group">
          <label>Nama Pemesan</label>
          <input type="text" id="nama" class="form-input" value="${escapeHtml(res.nama || '')}" required />
          <span class="error-message" id="nama-error"></span>
      </div>
      
      <div class="form-row">
          <div class="form-group">
              <label>No. HP</label>
              <input type="tel" id="nomorHp" class="form-input" value="${res.nomorHp || ''}" />
              <span class="error-message" id="nomorHp-error"></span>
          </div>
          <div class="form-group">
              <label>Jam</label>
              <input type="time" id="jam" class="form-input" value="${res.jam || ''}" required />
              <span class="error-message" id="jam-error"></span>
          </div>
      </div>
      
      <div class="form-row">
          <div class="form-group">
              <label>Jml Org</label>
              <input type="number" id="jumlah" class="form-input" value="${res.jumlah || ''}" min="1" required />
              <span class="error-message" id="jumlah-error"></span>
          </div>
          <div class="form-group">
              <label>Tempat</label>
              <select id="tempat" class="form-input" required onchange="updateCapacityInfo('edit-reservation-form')"></select>
              <span id="capacity-info" class="info-text"></span>
              <span class="error-message" id="tempat-error"></span>
          </div>
      </div>
      
      <div class="form-section-highlight">
          <div class="form-row">
              <div class="form-group">
                <label>Nominal DP</label>
                <input type="number" id="dp" class="form-input" value="${res.dp || 0}" min="0" />
              </div>
              <div class="form-group">
                <label>Via</label>
                <select id="tipeDp" class="form-input">
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
          <label>Menu <span class="error-message" id="menus-error"></span></label>
          <div id="selected-menus-container"></div>
          <button type="button" class="btn-dashed" onclick="addMenuSelectionRow('edit-reservation-form')">
            <i class="fas fa-plus"></i> Tambah Menu
          </button>
      </div>
      
      <div class="form-group">
          <label>Catatan</label>
          <textarea id="tambahan" class="form-input" rows="2">${escapeHtml(res.tambahan || '')}</textarea>
      </div>
      
      <div class="popup-footer">
        <button type="button" class="btn-primary-gradient" onclick="simpanPerubahanReservasi()">Simpan Perubahan</button>
      </div>
    </form>`;
  
  const editFormEl = document.getElementById('edit-reservation-form');
  
  // 3. Set Nilai Awal Dropdown
  const tipeDpSelect = editFormEl.querySelector('#tipeDp');
  if(tipeDpSelect) tipeDpSelect.value = res.tipeDp || '';
  
  const tempatSelect = editFormEl.querySelector('#tempat');
  populateLocationDropdown(tempatSelect, res.tempat);
  updateCapacityInfo('edit-reservation-form');
  
  // 4. Populate Menu (Support Legacy & New Format)
  const menuContainer = editFormEl.querySelector('#selected-menus-container');
  menuContainer.innerHTML = ''; // Bersihkan

  if (Array.isArray(res.menus) && res.menus.length > 0) {
    // Format Baru: Array Object
    res.menus.forEach(item => {
        addMenuSelectionRow('edit-reservation-form', item.name, item.quantity);
    });
  } else if (res.menu) {
    // Format Lama: String tunggal
    addMenuSelectionRow('edit-reservation-form', res.menu, 1);
  } else {
    // Kosong: Buat 1 baris default
    addMenuSelectionRow('edit-reservation-form');
  }
  
  // 5. Tampilkan
  formContainer.style.display = 'block'; 
  overlay.style.display = 'block';
}


/**
 * 21. OPERASI DATABASE: TAMBAH (CREATE)
 */
async function simpanReservasi() {
  // 1. Validasi Form
  const formData = await validateAndGetFormData('reservation-form');
  if (!formData) return; // Stop jika tidak valid
  
  // 2. Cek Tanggal
  if (!tanggalDipilih) { 
      showToast("Pilih tanggal di kalender dulu!", "error");
      return; 
  }
  
  showLoader();
  try {
    // 3. Simpan ke Firestore
    const payload = { 
        ...formData, 
        date: `${currentYear}-${tanggalDipilih}`, 
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        thankYouSent: false
    };

    await db.collection('reservations').add(payload);
    
    showToast("Reservasi berhasil disimpan!", "success");
    closePopup('addFormPopup'); 
    
  } catch (e) { 
    console.error("Save Error:", e);
    showToast("Gagal menyimpan data.", "error"); 
  } finally { 
    hideLoader(); 
  }
}


/**
 * 22. OPERASI DATABASE: EDIT (UPDATE)
 */
async function simpanPerubahanReservasi() {
  const id = document.getElementById('editReservationId').value;
  if (!id) return;

  const formData = await validateAndGetFormData('edit-reservation-form');
  if (!formData) return;
  
  showLoader();
  try {
    // Update data (tanpa mengubah tanggal & createdAt)
    await db.collection('reservations').doc(id).update(formData);
    
    showToast("Perubahan berhasil disimpan.", "success");
    closePopup('editFormPopup');
    
  } catch (e) { 
    console.error("Update Error:", e);
    showToast("Gagal mengupdate data.", "error"); 
  } finally { 
    hideLoader(); 
  }
}


/**
 * 23. OPERASI DATABASE: HAPUS (DELETE)
 */
async function hapusReservasi(id) {
  // Gunakan SweetAlert untuk konfirmasi yang lebih elegan
  const result = await Swal.fire({
      title: 'Hapus Data?',
      text: "Data reservasi ini akan dihapus permanen.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Ya, Hapus'
  });

  if (result.isConfirmed) {
      showLoader();
      try { 
          await db.collection('reservations').doc(id).delete(); 
          showToast("Data telah dihapus.", "success"); 
          closePopup('editFormPopup'); // Tutup popup edit jika sedang terbuka
      } catch (e) { 
          console.error("Delete Error:", e);
          showToast("Gagal menghapus data.", "error"); 
      } finally { 
          hideLoader(); 
      }
  }
}


/**
 * 24. ENGINE VALIDASI FORM (JANTUNG INPUT)
 * Mengambil data dari form, membersihkan input, dan memvalidasi aturan bisnis.
 */
async function validateAndGetFormData(formId) {
    const form = document.getElementById(formId);
    let isValid = true;
    
    // Helper: Set pesan error di UI
    const setError = (elementId, message) => { 
        const errEl = form.querySelector(`#${elementId}-error`);
        if(errEl) errEl.textContent = message; 
        
        // Highlight input border
        const inputEl = form.querySelector(`#${elementId}`);
        if(inputEl) inputEl.classList.add('input-error'); // Class error style (border red)
        
        isValid = false; 
    };

    // Reset error styles
    form.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    form.querySelectorAll('.form-input').forEach(el => el.classList.remove('input-error'));

    // --- 1. Validasi Nama ---
    const namaInput = form.querySelector('#nama');
    const nama = namaInput.value.trim();
    if(!nama) setError('nama', 'Nama wajib diisi');

    // --- 2. Validasi Nomor HP ---
    const hpInput = form.querySelector('#nomorHp');
    const nomorHp = cleanPhoneNumber(hpInput.value);
    // Jika diisi, harus valid (10-14 digit). Boleh kosong jika user walk-in.
    if(hpInput.value.trim() !== '' && !isValidPhone(nomorHp)) {
        setError('nomorHp', 'Min 10 digit angka');
    }

    // --- 3. Validasi Jam ---
    const jamInput = form.querySelector('#jam');
    const jam = jamInput.value;
    if(!jam) setError('jam', 'Wajib diisi');

    // --- 4. Validasi Jumlah & Kapasitas Tempat ---
    const jumlahInput = form.querySelector('#jumlah');
    const jumlah = parseInt(jumlahInput.value);
    const tempatInput = form.querySelector('#tempat');
    const tempat = tempatInput.value;

    if(isNaN(jumlah) || jumlah < 1) {
        setError('jumlah', 'Min 1 orang');
    }
    
    if(!tempat) {
        setError('tempat', 'Pilih lokasi');
    } else {
        // Cek Kapasitas (Fitur Penting!)
        const locationKey = Object.keys(locationsData).find(k => locationsData[k].name === tempat);
        
        if(locationKey) {
            const cap = locationsData[locationKey].capacity;
            if (jumlah > cap) {
                // Tampilkan error jika over capacity
                setError('jumlah', `Over capacity! (Max ${cap})`);
                showToast(`Lokasi ${tempat} hanya muat ${cap} orang.`, 'error');
            }
        }
    }

    // --- 5. Validasi & Ekstraksi Menu ---
    const menus = [];
    const menuRows = form.querySelectorAll('.menu-selection-row');
    const selectedItems = new Set(); // Set untuk cek duplikat

    menuRows.forEach(row => {
        const select = row.querySelector('select');
        const qtyInput = row.querySelector('input');
        
        const mName = select.value;
        const mQty = parseInt(qtyInput.value);
        
        // Ambil hanya jika nama menu valid dan qty > 0
        if(mName && !isNaN(mQty) && mQty > 0) {
            if(selectedItems.has(mName)) {
                setError('menus', 'Menu ganda terdeteksi. Gabungkan qty.');
            } else {
                selectedItems.add(mName);
                menus.push({ name: mName, quantity: mQty });
            }
        }
    });

    // --- HASIL ---
    if(!isValid) {
        // Efek getar pada form jika error (opsional UI polish)
        form.classList.add('shake-anim');
        setTimeout(() => form.classList.remove('shake-anim'), 500);
        return null;
    }

    // Return Object Bersih
    return {
        nama: nama,
        nomorHp: nomorHp, // Format bersih (angka saja)
        jam: jam,
        jumlah: jumlah,
        tempat: tempat,
        menus: menus, // Array [{name, quantity}]
        dp: parseInt(form.querySelector('#dp').value) || 0,
        tipeDp: form.querySelector('#tipeDp').value,
        tambahan: form.querySelector('#tambahan').value.trim()
    };
}


/**
 * 25. HELPER FORM UI
 * Fungsi DOM Manipulation untuk form dinamis.
 */

// Menambah Baris Input Menu
function addMenuSelectionRow(formId, defaultName='', defaultQty=1) {
  const container = document.querySelector(`#${formId} #selected-menus-container`);
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'menu-selection-row';
  
  // Build Dropdown Options dari Master Data
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
    <button type="button" class="btn-del" onclick="this.parentElement.remove()" title="Hapus baris">
        <i class="fas fa-trash"></i>
    </button>
  `;
  
  container.appendChild(div);
}

// Populate Dropdown Lokasi dengan Kapasitas
function populateLocationDropdown(selectElement, defaultValue='') {
    if(!selectElement) return;
    
    selectElement.innerHTML = '<option value="">-- Pilih Lokasi --</option>';
    
    const sortedLocs = Object.values(locationsData).sort((a,b) => a.name.localeCompare(b.name));
    
    sortedLocs.forEach(loc => {
        const selected = loc.name === defaultValue ? 'selected' : '';
        const option = `<option value="${loc.name}" ${selected}>${escapeHtml(loc.name)} (Kap: ${loc.capacity})</option>`;
        selectElement.insertAdjacentHTML('beforeend', option);
    });
}

// Update Info Kapasitas Realtime
function updateCapacityInfo(formId) {
    const form = document.getElementById(formId);
    const select = form.querySelector('#tempat');
    const infoSpan = form.querySelector('#capacity-info');
    
    const val = select.value;
    if(!val) {
        infoSpan.textContent = '';
        return;
    }
    
    const locKey = Object.keys(locationsData).find(k => locationsData[k].name === val);
    if (locKey) {
        const cap = locationsData[locKey].capacity;
        infoSpan.innerHTML = `<i class="fas fa-info-circle"></i> Max: <b>${cap} orang</b>`;
        infoSpan.style.color = 'var(--primary)';
        infoSpan.style.fontSize = '0.8rem';
    } else {
        infoSpan.textContent = '';
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 5: MASTER DATA, BROADCAST, ANALISIS, & TOOLS (FINAL)
// ============================================================================

/**
 * 26. MANAJEMEN DATA MASTER: MENU (CRUD)
 * Menangani Popup untuk menambah atau menghapus menu makanan.
 */
function showMenuManagement() {
    const popup = document.getElementById('menuManagementPopup');
    
    // Inject HTML UI ke dalam Popup
    popup.innerHTML = `
      <div class="popup-header">
          <h3><i class="fas fa-utensils"></i> Kelola Menu & Harga</h3>
          <button class="close-popup-btn" onclick="closePopup('menuManagementPopup')">&times;</button>
      </div>
      <div class="popup-content">
          <div style="background:#f8fafc; padding:15px; border-radius:10px; margin-bottom:20px; border:1px solid #e2e8f0;">
              <h4 style="margin-top:0; color:var(--primary-dark); margin-bottom:10px;">Tambah Menu Baru</h4>
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:10px;">
                 <input type="text" id="newMenuName" class="form-input" placeholder="Nama Menu (Cth: Nasi Goreng)">
                 <input type="number" id="newMenuPrice" class="form-input" placeholder="Harga (Rp)">
              </div>
              <textarea id="newMenuDetails" class="form-input" placeholder="Detail/Varian (pisahkan koma). Cth: Pedas, Sedang" style="min-height:60px;"></textarea>
              <button class="btn-primary-gradient full-width" onclick="addNewMenu()" style="margin-top:10px;">
                 <i class="fas fa-plus-circle"></i> Simpan Menu
              </button>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h4 style="margin:0;">Daftar Menu Aktif</h4>
            <small style="color:#666;">Total: ${Object.keys(detailMenu).length}</small>
          </div>

          <div id="manage-menu-list" style="max-height:300px; overflow-y:auto; border:1px solid #eee; border-radius:8px; background:white;"></div>
      </div>`;
    
    // Render List
    renderManageMenuList();
    
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function renderManageMenuList() {
    const listEl = document.getElementById('manage-menu-list');
    if(!listEl) return;

    listEl.innerHTML = Object.keys(detailMenu).sort().map(name => {
        const price = menuPrices[name] ? parseInt(menuPrices[name]) : 0;
        const details = detailMenu[name].join(', ');
        
        return `
        <div class="menu-item">
            <div style="flex:1;">
                <div style="font-weight:600; color:var(--text-main);">${escapeHtml(name)}</div>
                <div style="font-size:0.85rem; color:var(--success); font-weight:500;">Rp ${formatRupiah(price)}</div>
                <div style="font-size:0.8rem; color:#888;">${escapeHtml(details)}</div>
            </div>
            <button class="btn-sm btn-danger-outlined" onclick="deleteMenu('${escapeHtml(name)}')" title="Hapus Menu">
                <i class="fas fa-trash"></i>
            </button>
        </div>`;
    }).join('');
}

async function addNewMenu() {
    const name = document.getElementById('newMenuName').value.trim();
    const price = parseInt(document.getElementById('newMenuPrice').value);
    const detailsRaw = document.getElementById('newMenuDetails').value;
    
    if(!name) return showToast("Nama menu wajib diisi", "error");
    
    // Validasi Duplikat
    if(detailMenu[name]) return showToast("Menu dengan nama ini sudah ada", "error");

    const details = detailsRaw.split(',').map(s => s.trim()).filter(Boolean);
    
    showLoader();
    try {
        await db.collection('menus').doc(name).set({ 
            details: details, 
            price: isNaN(price) ? 0 : price 
        });
        
        showToast("Menu berhasil ditambahkan", "success");
        await loadMenus(); // Refresh Global Cache
        renderManageMenuList(); // Refresh UI Popup
        
        // Reset Input
        document.getElementById('newMenuName').value = '';
        document.getElementById('newMenuPrice').value = '';
        document.getElementById('newMenuDetails').value = '';
        
    } catch(e) { 
        console.error(e);
        showToast("Gagal menambah menu", "error"); 
    } finally { 
        hideLoader(); 
    }
}

async function deleteMenu(name) {
    if(!confirm(`Yakin ingin menghapus menu "${name}"?`)) return;
    
    showLoader();
    try {
        await db.collection('menus').doc(name).delete();
        showToast("Menu dihapus", "success");
        await loadMenus();
        renderManageMenuList();
    } catch(e) { 
        showToast("Gagal menghapus menu", "error"); 
    } finally { 
        hideLoader(); 
    }
}


/**
 * 27. MANAJEMEN DATA MASTER: LOKASI (CRUD)
 * Menangani Popup untuk menambah atau menghapus tempat/meja.
 */
function showLocationManagement() {
    const popup = document.getElementById('locationManagementPopup');
    
    popup.innerHTML = `
      <div class="popup-header">
          <h3><i class="fas fa-map-marker-alt"></i> Kelola Tempat</h3>
          <button class="close-popup-btn" onclick="closePopup('locationManagementPopup')">&times;</button>
      </div>
      <div class="popup-content">
          <div style="background:#f8fafc; padding:15px; border-radius:10px; margin-bottom:20px; border:1px solid #e2e8f0;">
              <h4 style="margin-top:0; color:var(--primary-dark); margin-bottom:10px;">Tambah Tempat Baru</h4>
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
                 <input type="text" id="newLocName" class="form-input" placeholder="Nama Tempat (Cth: Gazebo 1)">
                 <input type="number" id="newLocCap" class="form-input" placeholder="Kapasitas (Org)">
              </div>
              <button class="btn-primary-gradient full-width" onclick="addNewLocation()" style="margin-top:10px;">
                 <i class="fas fa-plus-circle"></i> Tambah Tempat
              </button>
          </div>

          <h4 style="margin:0 0 10px 0;">Daftar Tempat</h4>
          <div id="manage-loc-list" style="max-height:300px; overflow-y:auto; border:1px solid #eee; border-radius:8px; background:white;"></div>
      </div>`;
      
    renderManageLocList();
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function renderManageLocList() {
    const listEl = document.getElementById('manage-loc-list');
    if(!listEl) return;

    // Kita butuh ID dokumen untuk menghapus, jadi kita iterate entries dari locationsData
    // Format locationsData: { "docId": {name: "...", capacity: 10} }
    listEl.innerHTML = Object.entries(locationsData)
        .sort(([,a], [,b]) => a.name.localeCompare(b.name))
        .map(([docId, data]) => `
        <div class="menu-item">
            <div style="flex:1;">
                <div style="font-weight:600; color:var(--text-main);">${escapeHtml(data.name)}</div>
                <small style="color:#666;">Kapasitas Max: ${data.capacity} orang</small>
            </div>
            <button class="btn-sm btn-danger-outlined" onclick="deleteLocation('${docId}')" title="Hapus Tempat">
                <i class="fas fa-trash"></i>
            </button>
        </div>`
    ).join('');
}

async function addNewLocation() {
    const name = document.getElementById('newLocName').value.trim();
    const cap = parseInt(document.getElementById('newLocCap').value);
    
    if(!name || isNaN(cap) || cap < 1) return showToast("Nama dan kapasitas valid wajib diisi", "error");
    
    // Generate ID aman (lowercase, tanpa spasi)
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    showLoader();
    try {
        // Cek apakah ID sudah ada di cache lokal
        if(locationsData[id]) {
            showToast("ID Lokasi ini sudah ada, gunakan nama lain", "error");
            hideLoader();
            return;
        }

        await db.collection('locations').doc(id).set({ name, capacity: cap });
        
        showToast("Lokasi berhasil ditambahkan", "success");
        await loadLocations();
        renderManageLocList();
        
        // Reset
        document.getElementById('newLocName').value = '';
        document.getElementById('newLocCap').value = '';
        
    } catch(e) { 
        console.error(e);
        showToast("Gagal menambah lokasi", "error"); 
    } finally { 
        hideLoader(); 
    }
}

async function deleteLocation(docId) {
    if(!confirm("Menghapus lokasi ini mungkin mempengaruhi data reservasi lama. Lanjutkan?")) return;
    
    showLoader();
    try {
        await db.collection('locations').doc(docId).delete();
        showToast("Lokasi dihapus", "success");
        await loadLocations();
        renderManageLocList();
    } catch(e) { 
        showToast("Gagal menghapus lokasi", "error"); 
    } finally { 
        hideLoader(); 
    }
}


/**
 * 28. SISTEM BROADCAST WHATSAPP
 * Fitur canggih untuk mengambil database pelanggan dan mengirim pesan promo.
 */
function showBroadcastMain() { 
    // Logic: Jika belum ada pesan tersimpan, minta atur pesan dulu
    const savedMsg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if (!savedMsg) {
        showBroadcastSettings();
    } else {
        // Langsung tampilkan list pelanggan
        showBroadcastList();
    }
}

function showBroadcastSettings() {
    closePopup('broadcastListPopup'); // Tutup list jika terbuka
    
    const popup = document.getElementById('broadcastSettingsPopup');
    const txtArea = document.getElementById('broadcastMessage');
    
    // Load pesan lama
    txtArea.value = localStorage.getItem(BROADCAST_MESSAGE_KEY) || '';
    
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function saveBroadcastMessage() {
    const msg = document.getElementById('broadcastMessage').value;
    if(!msg.trim()) return showToast("Pesan tidak boleh kosong", "error");
    
    localStorage.setItem(BROADCAST_MESSAGE_KEY, msg);
    promoMessageCache = msg;
    
    showToast("Template pesan tersimpan", "success");
    closePopup('broadcastSettingsPopup');
    
    // Lanjut ke list broadcast
    showBroadcastList();
}

async function showBroadcastList() {
    const msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if(!msg) return showToast("Template pesan belum diatur", "error");

    showLoader();
    try {
        // Ambil 500 reservasi terakhir (Query Berat)
        // Kita batasi 500 agar tidak overload browser, asumsi pelanggan aktif ada di 500 terakhir
        const snap = await db.collection('reservations').orderBy('createdAt','desc').limit(500).get();
        const map = new Map();
        
        snap.forEach(d => {
            const data = d.data();
            if(data.nomorHp && isValidPhone(data.nomorHp)) {
                const clean = cleanPhoneNumber(data.nomorHp);
                // Gunakan Map untuk Deduplikasi (Hanya simpan 1 nomor unik)
                if(!map.has(clean)) {
                    map.set(clean, { phone: clean, name: data.nama });
                }
            }
        });
        
        // Convert Map to Array & Sort by Name
        allCustomersCache = Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name));
        
        // Tampilkan Popup
        const popup = document.getElementById('broadcastListPopup');
        popup.innerHTML = `
            <div class="popup-header">
                <h3><i class="fas fa-bullhorn"></i> Kirim Broadcast (${allCustomersCache.length} Kontak)</h3>
                <button class="close-popup-btn" onclick="closePopup('broadcastListPopup')">&times;</button>
            </div>
            <div class="popup-content">
                <input type="text" id="broadcastSearch" class="form-input" placeholder="Cari nama atau nomor HP..." oninput="filterBroadcastCustomers(this.value)" style="margin-bottom:15px;">
                <div id="broadcast-customer-list" style="max-height:400px; overflow-y:auto; border:1px solid #eee; border-radius:8px;"></div>
                <div style="margin-top:15px; text-align:right;">
                    <button class="btn-secondary-outlined" onclick="showBroadcastSettings()">Ubah Pesan</button>
                </div>
            </div>
        `;
        
        renderBroadcastList(allCustomersCache);
        
        popup.style.display = 'block'; 
        overlay.style.display = 'block';
        
    } catch(e) { 
        console.error(e);
        showToast("Gagal memuat database pelanggan", "error"); 
    } finally { 
        hideLoader(); 
    }
}

function renderBroadcastList(arr) {
    const container = document.getElementById('broadcast-customer-list');
    if(!container) return;
    
    if(arr.length === 0) {
        container.innerHTML = '<p class="text-center text-muted" style="padding:20px;">Tidak ada kontak yang cocok.</p>';
        return;
    }

    // Virtual rendering simple (render semua string HTML lalu inject)
    container.innerHTML = arr.map(c => `
        <div class="menu-item">
            <div style="flex:1;">
                <div style="font-weight:600;">${escapeHtml(c.name)}</div>
                <small class="text-muted">${c.phone}</small>
            </div>
            <button class="btn-sm btn-whatsapp" onclick="sendPromo('${c.phone}', '${escapeHtml(c.name)}', this)">
                <i class="fab fa-whatsapp"></i> Kirim
            </button>
        </div>
    `).join('');
}

function filterBroadcastCustomers(query) {
    const q = query.toLowerCase();
    const filtered = allCustomersCache.filter(c => 
        c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
    renderBroadcastList(filtered);
}

function sendPromo(hp, nm, btnEl) {
    let msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if(!msg) return showToast("Template pesan hilang. Atur ulang.", "error");
    
    // Ganti variable 'kak' dengan nama pelanggan (Case Insensitive Global)
    msg = msg.replace(/kak/gi, `Kak *${nm}*`); 
    
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
    
    // Feedback Visual
    if(btnEl) {
        btnEl.classList.remove('btn-whatsapp');
        btnEl.classList.add('btn-secondary-outlined');
        btnEl.innerHTML = '<i class="fas fa-check"></i> Terkirim';
        btnEl.disabled = true;
    }
}


/**
 * 29. EXPORT & PRINT
 * Fitur backup data dan cetak laporan fisik.
 */

// Export Data to Base64 String
function showExportDataPopup() {
    if(Object.keys(dataReservasi).length === 0) return showToast("Tidak ada data reservasi untuk diekspor.", "error");
    
    // Buat struktur JSON lengkap
    const payload = {
        version: "v6.0",
        dateExported: new Date().toISOString(),
        reservations: dataReservasi,
        masterLocations: locationsData
    };
    
    // Encode ke Base64 agar mudah disalin
    const str = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    
    document.getElementById('export-data-output').value = str;
    document.getElementById('exportDataPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function copyExportCode() {
    const el = document.getElementById('export-data-output');
    el.select();
    document.execCommand('copy'); // Fallback copy
    
    // Modern API copy (jika support)
    if (navigator.clipboard) {
        navigator.clipboard.writeText(el.value);
    }
    
    showToast("Kode berhasil disalin ke clipboard!", "success");
}

// Print Laporan
function printData() {
    if(!tanggalDipilih) return showToast("Pilih tanggal dulu di kalender", "error");
    document.getElementById('printOptionsPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function executePrint() {
    const list = dataReservasi[tanggalDipilih] || [];
    if(list.length === 0) return showToast("Data kosong pada tanggal ini", "error");
    
    // Ambil Opsi Checkbox
    const showMenu = document.getElementById('print-detail-menu').checked;
    const showKontak = document.getElementById('print-kontak').checked;
    const showDp = document.getElementById('print-dp').checked;
    const showNote = document.getElementById('print-tambahan').checked;
    
    // Generate Tabel HTML
    let htmlRows = list.sort((a,b)=>a.jam.localeCompare(b.jam)).map((r, i) => {
        let menuStr = '-';
        if(showMenu) {
            if(r.menus && r.menus.length > 0) menuStr = r.menus.map(m=>`${m.quantity}x ${m.name}`).join('<br>');
            else if(r.menu) menuStr = r.menu;
        }
        
        return `
        <tr>
            <td>${i+1}</td>
            <td>${r.jam}</td>
            <td><b>${r.nama}</b>${showKontak ? `<br><small>${r.nomorHp || '-'}</small>` : ''}</td>
            <td>${r.jumlah}</td>
            <td>${r.tempat}</td>
            ${showMenu ? `<td style="font-size:0.85em;">${menuStr}</td>` : ''}
            ${showDp ? `<td>${r.dp > 0 ? formatRupiah(r.dp) : '0'}</td>` : ''}
            ${showNote ? `<td style="font-size:0.85em;">${r.tambahan || '-'}</td>` : ''}
        </tr>`;
    }).join('');

    const headers = `
        <th>#</th><th>Jam</th><th>Nama</th><th>Pax</th><th>Tempat</th>
        ${showMenu ? '<th>Menu</th>' : ''}
        ${showDp ? '<th>DP (Rp)</th>' : ''}
        ${showNote ? '<th>Catatan</th>' : ''}
    `;

    // Buka Window Baru
    const win = window.open('', '', 'width=900,height=600');
    win.document.write(`
        <html>
        <head>
            <title>Laporan Reservasi - ${tanggalDipilih}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; color: #333; }
                h2 { color: #059669; margin-bottom: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
                th { background: #f0fdf4; text-align: left; padding: 8px; border: 1px solid #ddd; }
                td { padding: 8px; border: 1px solid #ddd; vertical-align: top; }
                .footer { margin-top: 30px; font-size: 10px; color: #666; text-align: right; }
            </style>
        </head>
        <body>
            <h2>Dolan Sawah - Laporan Harian</h2>
            <p><strong>Tanggal:</strong> ${tanggalDipilih} | <strong>Total Tamu:</strong> ${list.length} Grup</p>
            <table>
                <thead><tr>${headers}</tr></thead>
                <tbody>${htmlRows}</tbody>
            </table>
            <div class="footer">Dicetak pada: ${new Date().toLocaleString()}</div>
            <script>window.print();</script>
        </body>
        </html>
    `);
    win.document.close();
    closePopup('printOptionsPopup');
}


/**
 * 30. ANALISIS GRAFIK (CHART.JS)
 * Visualisasi data performa reservasi menggunakan Chart.js.
 */
let chartInstance = null;

async function runUIAnalysis() {
    // 1. Populate Dropdown Tahun jika kosong
    const sel = document.getElementById('anl-year-ui');
    if(sel && sel.options.length === 0) {
        const y = new Date().getFullYear();
        sel.innerHTML = `<option value="${y}">${y}</option><option value="${y-1}">${y-1}</option>`;
    }
    
    const chartCanvas = document.getElementById('mainChart');
    if(!chartCanvas) return;

    // 2. Fetch All Data (Lazy Load - Heavy)
    // Hanya fetch jika cache kosong
    if(!allReservationsCache) {
        showLoader();
        try {
            const snap = await db.collection('reservations').get();
            allReservationsCache = snap.docs.map(d => d.data());
        } catch(e) { 
            console.error(e); 
            showToast("Gagal memuat data analisis", "error");
            hideLoader(); 
            return; 
        }
        hideLoader();
    }
    
    // 3. Filter & Proses Data
    const year = parseInt(sel ? sel.value : new Date().getFullYear());
    const monthlyCounts = Array(12).fill(0);
    
    allReservationsCache.forEach(r => {
        // Parse date string YYYY-MM-DD
        if(r.date) {
            const d = new Date(r.date);
            if(d.getFullYear() === year) {
                monthlyCounts[d.getMonth()]++;
            }
        }
    });
    
    // 4. Render Chart
    const ctx = chartCanvas.getContext('2d');
    if(chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: monthNames.map(m => m.substr(0, 3)), // Jan, Feb, Mar...
            datasets: [{
                label: `Total Reservasi ${year}`,
                data: monthlyCounts,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderColor: '#10b981', // Brand Color
                borderWidth: 2,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#059669',
                fill: true,
                tension: 0.4 // Garis melengkung halus
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false } }
            }
        }
    });
    
    // 5. Update Quick Insights Text
    const total = monthlyCounts.reduce((a,b)=>a+b,0);
    const avg = (total/12).toFixed(1);
    const max = Math.max(...monthlyCounts);
    
    const insightDiv = document.getElementById('quick-insights');
    if(insightDiv) {
        insightDiv.innerHTML = `
            <div class="stat-card glass-card" style="padding:15px; flex-direction:column; align-items:flex-start;">
                <small class="text-muted">Total Tahun ${year}</small>
                <h3 style="margin:0; color:var(--primary);">${total}</h3>
            </div>
            <div class="stat-card glass-card" style="padding:15px; flex-direction:column; align-items:flex-start;">
                <small class="text-muted">Rata-rata/Bulan</small>
                <h3 style="margin:0; color:var(--info);">${avg}</h3>
            </div>
            <div class="stat-card glass-card" style="padding:15px; flex-direction:column; align-items:flex-start;">
                <small class="text-muted">Bulan Tertinggi</small>
                <h3 style="margin:0; color:var(--accent);">${max}</h3>
            </div>
        `;
    }
}

// Popup Analisis Detail (Placeholder logic)
function showAnalysis() {
    const popup = document.getElementById('analysisPopup');
    popup.innerHTML = `
        <div class="popup-header">
            <h3>Analisis Detail</h3>
            <button class="close-popup-btn" onclick="closePopup('analysisPopup')">&times;</button>
        </div>
        <div class="popup-content">
            <p>Fitur analisis mendalam seperti "Top 5 Menu Terlaris" atau "Top Pelanggan" dapat ditambahkan di sini menggunakan data dari <code>allReservationsCache</code>.</p>
            <button class="btn-primary-gradient" onclick="runUIAnalysis(); closePopup('analysisPopup');">Refresh Grafik Utama</button>
        </div>
    `;
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}


/**
 * 31. BACKGROUND SERVICE: NOTIFIKASI
 * Mengecek reservasi yang sudah lewat waktunya untuk diingatkan mengirim ucapan terima kasih.
 */
function setupReliableNotificationChecker() {
    if (notificationInterval) clearInterval(notificationInterval);
    
    // Cek awal
    runNotificationCheck(); 
    
    // Cek setiap 5 menit
    notificationInterval = setInterval(runNotificationCheck, 300000); 
}

async function runNotificationCheck() {
    // Hanya jalan jika data reservasi sudah terload di memori
    if(Object.keys(dataReservasi).length === 0) return;

    const now = new Date();
    let pendingCount = 0;
    const listHtml = [];

    // Iterasi semua tanggal yang ada di cache (biasanya bulan ini)
    for(const dateKey in dataReservasi) {
        dataReservasi[dateKey].forEach(r => {
            // Syarat: Ada nomor HP, Belum dikirim ucapan
            if(!r.thankYouSent && r.nomorHp) {
                const resDateTime = new Date(`${currentYear}-${dateKey}T${r.jam}`);
                
                // Jika waktu reservasi valid dan sudah lewat 2 jam
                if(!isNaN(resDateTime.getTime()) && now > new Date(resDateTime.getTime() + (2*60*60*1000))) {
                    pendingCount++;
                    listHtml.push(`
                        <li class="notification-item">
                            <div style="font-weight:600;">${escapeHtml(r.nama)}</div>
                            <small class="text-muted">${dateKey} jam ${r.jam}</small>
                            <button class="btn-sm btn-whatsapp full-width" style="margin-top:5px;" onclick="sendThankYouMessage('${r.id}', '${escapeHtml(r.nama)}', '${r.nomorHp}')">
                                Kirim Ucapan
                            </button>
                        </li>
                    `);
                }
            }
        });
    }

    // Update UI Badge & Dropdown
    const badge = document.getElementById('notification-badge');
    const ul = document.getElementById('notification-list-ul');
    
    if(badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'flex' : 'none';
    }
    
    if(ul) {
        ul.innerHTML = listHtml.length > 0 ? listHtml.join('') : '<li style="padding:15px; color:#999; text-align:center;">Tidak ada pengingat baru.</li>';
    }
}

function sendThankYouMessage(id, nm, hp) {
    const msg = `Halo Kak *${nm}* 👋,\n\nTerima kasih banyak sudah berkunjung ke *Dolan Sawah* hari ini. 🙏\nSemoga hidangan dan pelayanannya memuaskan ya.\n\nJika berkenan, kami sangat menghargai masukan atau review Kakak agar kami bisa terus berkembang. Ditunggu kedatangannya kembali! ✨`;
    
    window.open(`https://wa.me/${cleanPhoneNumber(hp)}?text=${encodeURIComponent(msg)}`, '_blank');
    
    // Update DB agar tidak muncul lagi
    db.collection('reservations').doc(id).update({ thankYouSent: true });
    
    // Update UI lokal
    const btn = document.getElementById(`thank-btn-${id}`);
    if(btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-check"></i> Sent';
        btn.classList.remove('btn-info');
        btn.classList.add('btn-secondary-outlined');
    }
}

// Utilities Akhir
function forceSync() {
    showLoader();
    setTimeout(() => location.reload(), 800); // Reload halaman
}

function toggleNotificationDropdown(e) {
    e.stopPropagation();
    const d = document.getElementById('notification-dropdown');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}

// Global Click Listener untuk menutup dropdown notifikasi
window.addEventListener('click', () => {
    const d = document.getElementById('notification-dropdown');
    if(d) d.style.display = 'none';
});

// Penutup Console
console.log("Dolan Sawah App Loaded: Luxury Version.");
