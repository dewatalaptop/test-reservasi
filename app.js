// ============================================================================
// FILE: app.js
// BAGIAN 1: CONFIG, STATE, AUTH, & CORE UTILITIES
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

// Inisialisasi Firebase (Pengecekan ganda agar tidak error jika script dimuat 2x)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // Gunakan instance yang sudah ada
}

const db = firebase.firestore();
const auth = firebase.auth();

// Mengaktifkan persistensi session (agar tidak perlu login ulang saat refresh)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch((error) => {
        console.error("Gagal mengaktifkan persistensi auth:", error);
    });


/**
 * 2. VARIABEL GLOBAL (STATE MANAGEMENT)
 * Semua variabel ini menampung data aplikasi agar tidak perlu reload berulang kali.
 */

// Konstanta Nama Bulan (Bahasa Indonesia)
const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// --- Cache Data Utama ---
let dataReservasi = {};      // Menyimpan data reservasi yang sudah dikelompokkan per tanggal (Key: "MM-DD")
let allReservationsList = []; // Array flat semua reservasi bulan ini (untuk statistik & search)
let requestsCache = [];      // Menyimpan data permintaan dari Inbox (Pending)
let allReservationsCache = null; // Cache berat untuk analisis tahunan (dimuat hanya saat perlu)

// --- Cache Data Master ---
let detailMenu = {};         // Menyimpan detail setiap menu (contoh: "Pedas, Tanpa Sayur")
let menuPrices = {};         // Menyimpan harga setiap menu (Key: Nama Menu, Value: Harga Integer)
let locationsData = {};      // Menyimpan data lokasi & kapasitas (Key: ID Dokumen)

// --- Variabel Navigasi & Kalender ---
let tanggalDipilih = '';     // Format "MM-DD" saat user mengklik tanggal di kalender
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// --- Listener Realtime (Unsubscribe functions) ---
// Kita simpan function ini agar bisa dimatikan (off) saat logout untuk mencegah memory leak
let unsubscribeReservations = null;
let unsubscribeRequests = null;
let unsubscribeMenus = null;
let unsubscribeLocations = null;

// --- Variabel Logika Fitur Khusus ---
let hasAutoOpened = false;       // Flag untuk fitur Deep Linking (agar tidak popup terus menerus)
let notificationInterval = null; // Interval untuk pengecekan notifikasi "Say Thanks"
let lastNotificationCheck = 0;   // Timestamp terakhir pengecekan notifikasi
let promoMessageCache = null;    // Menyimpan template pesan broadcast
let allCustomersCache = [];      // Menyimpan daftar unik customer untuk broadcast

const BROADCAST_MESSAGE_KEY = 'dolanSawahBroadcastMessage'; // Key LocalStorage

// --- Referensi Elemen DOM Global ---
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');
const overlay = document.getElementById('overlay');


/**
 * 3. SISTEM OTENTIKASI (LOGIN & LOGOUT)
 * Mengatur tampilan berdasarkan status login user.
 */
auth.onAuthStateChanged(user => {
    const loginContainer = document.getElementById('login-container');
    const appLayout = document.getElementById('app-layout');
    
    if (user) {
        // --- KONDISI: USER LOGIN ---
        console.log("User terautentikasi:", user.email);
        
        // Animasi transisi UI
        if(loginContainer) loginContainer.style.display = 'none';
        if(appLayout) {
            appLayout.style.display = 'block';
            appLayout.style.opacity = 0;
            setTimeout(() => { appLayout.style.opacity = 1; }, 50); // Fade in effect
        }
        
        // Set info tanggal di header
        updateHeaderDate();
        
        // MULAI APLIKASI (Load Data)
        initializeApp(); 
        
    } else {
        // --- KONDISI: USER LOGOUT ---
        console.log("User belum login / logout");
        
        if(loginContainer) loginContainer.style.display = 'flex';
        if(appLayout) appLayout.style.display = 'none';
        
        // Bersihkan listener realtime untuk keamanan & performa
        cleanupListeners();
    }
});

// Fungsi Login
async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('login-error');
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  // Validasi Input Dasar
  if (!email || !password) { 
      errorEl.textContent = 'Email dan password wajib diisi.'; 
      errorEl.style.display = 'block'; 
      return; 
  }
  
  showLoader(); // Tampilkan spinner loading
  
  try { 
      await auth.signInWithEmailAndPassword(email, password); 
      // Jika sukses, onAuthStateChanged akan otomatis berjalan.
      // Kita hanya perlu mereset form.
      emailInput.value = '';
      passwordInput.value = '';
      errorEl.style.display = 'none';
  } catch (err) { 
      console.error("Login Error:", err);
      let msg = 'Email atau password salah.';
      if(err.code === 'auth/invalid-email') msg = 'Format email tidak valid.';
      if(err.code === 'auth/user-not-found') msg = 'User tidak ditemukan.';
      if(err.code === 'auth/wrong-password') msg = 'Password salah.';
      if(err.code === 'auth/too-many-requests') msg = 'Terlalu banyak percobaan gagal. Coba lagi nanti.';
      
      errorEl.textContent = msg; 
      errorEl.style.display = 'block'; 
  } finally { 
      hideLoader(); // Sembunyikan spinner
  }
}

// Fungsi Logout
function handleLogout() { 
    // Konfirmasi menggunakan native confirm atau bisa diganti SweetAlert nanti
    if (confirm("Apakah Anda yakin ingin keluar dari Dashboard Admin?")) {
        showLoader();
        auth.signOut().then(() => {
            showToast("Berhasil logout", "success");
            hideLoader();
        }).catch(err => {
            console.error("Logout Error:", err);
            hideLoader();
        });
    }
}

// Membersihkan semua listener saat logout
function cleanupListeners() {
    if (notificationInterval) clearInterval(notificationInterval);
    if (unsubscribeReservations) unsubscribeReservations();
    if (unsubscribeRequests) unsubscribeRequests();
    if (unsubscribeMenus) unsubscribeMenus();
    if (unsubscribeLocations) unsubscribeLocations();
    
    // Reset Data Cache
    dataReservasi = {};
    requestsCache = [];
}


/**
 * 4. NAVIGASI DASHBOARD (SIDEBAR & TABS)
 * Mengatur perpindahan antar halaman tanpa reload (SPA feel).
 */
function switchTab(tabId) {
    // 1. Sembunyikan semua konten section
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none'; // Pastikan display none agar tidak mengganggu layout
    });

    // 2. Tampilkan section yang dipilih
    const selectedSection = document.getElementById('tab-' + tabId);
    if (selectedSection) {
        selectedSection.style.display = 'block';
        // Sedikit delay untuk animasi fade-in CSS
        setTimeout(() => selectedSection.classList.add('active'), 10);
    } else {
        console.error(`Tab dengan ID tab-${tabId} tidak ditemukan.`);
        return;
    }
    
    // 3. Update status Active di Sidebar
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    // Cari nav-item yang memanggil fungsi ini
    // Kita cari berdasarkan atribut onclick karena elemennya statis
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const onClickAttr = item.getAttribute('onclick');
        if(onClickAttr && onClickAttr.includes(`'${tabId}'`)) {
            item.classList.add('active');
        }
    });

    // 4. Update Judul Halaman di Header
    const titles = {
        'dashboard': 'Dashboard Overview',
        'inbox': 'Inbox Permintaan & Reservasi',
        'calendar': 'Kalender Utama',
        'data': 'Manajemen Data Master',
        'broadcast': 'Broadcast & Promosi',
        'analysis': 'Analisis & Statistik Bisnis'
    };
    const pageTitleEl = document.getElementById('page-title');
    if(pageTitleEl) pageTitleEl.textContent = titles[tabId] || 'Dashboard';

    // 5. Khusus Mobile: Tutup sidebar otomatis setelah klik menu
    if(window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if(sidebar && sidebar.classList.contains('open')) {
            toggleSidebar();
        }
    }

    // 6. Trigger Khusus (Lazy Load)
    // Jika tab Analisis dibuka, jalankan render chart agar animasi berjalan
    if(tabId === 'analysis') {
        if(typeof runUIAnalysis === 'function') runUIAnalysis();
    }
}

// Toggle Sidebar untuk Mobile
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('mobile-toggle');
    
    sb.classList.toggle('open');
    
    // Ganti ikon toggle
    if (sb.classList.contains('open')) {
        toggleBtn.innerHTML = '<i class="fas fa-times"></i>'; // Ikon Close
    } else {
        toggleBtn.innerHTML = '<i class="fas fa-bars"></i>';  // Ikon Burger
    }
}

// Update Tanggal di Header
function updateHeaderDate() {
    const el = document.getElementById('current-date-display');
    if(el) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        el.textContent = new Date().toLocaleDateString('id-ID', options);
    }
}


/**
 * 5. UTILITY & HELPER FUNCTIONS
 * Fungsi-fungsi kecil yang sering digunakan di seluruh aplikasi.
 */

// Helper: Format Rupiah (Rp 10.000)
function formatRupiah(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '0';
    return Number(amount).toLocaleString('id-ID');
}

// Helper: Bersihkan Nomor HP (0812-345 -> 0812345)
function cleanPhoneNumber(phone) { 
    if(!phone) return '';
    return phone.toString().replace(/[^0-9]/g, ''); 
}

// Helper: Validasi Nomor HP (Minimal 10, Maksimal 14 digit angka)
function isValidPhone(phone) { 
    const cleaned = cleanPhoneNumber(phone);
    return /^[0-9]{10,14}$/.test(cleaned); 
}

// Helper: Tampilkan Toast Notification
function showToast(message, type = 'success') {
    // type: 'success', 'error', 'info'
    toast.textContent = message; 
    
    // Reset class list dan set class baru
    toast.className = 'toast'; 
    toast.classList.add(type);
    
    toast.style.display = 'block';
    
    // Animasi masuk
    setTimeout(() => { toast.style.opacity = 1; }, 10);

    // Hilangkan setelah 3 detik
    setTimeout(() => { 
        toast.style.opacity = 0;
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3000);
}

// Helper: Loading Spinner Control
function showLoader() { 
    if(loadingOverlay) loadingOverlay.style.display = 'flex'; 
}
function hideLoader() { 
    if(loadingOverlay) loadingOverlay.style.display = 'none'; 
}

// Helper: Tutup Popup Modal
function closePopup(popupId) {
    const popup = document.getElementById(popupId);
    if(popup) popup.style.display = 'none';
    if(overlay) overlay.style.display = 'none';
}

// Helper: Mencegah XSS sederhana (Escape HTML)
function escapeHtml(text) {
  if (!text) return text;
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}
// ============================================================================
// FILE: app.js
// BAGIAN 2: DATA INITIALIZATION & INBOX SYSTEM
// ============================================================================

/**
 * 6. INISIALISASI APLIKASI
 * Fungsi utama yang dipanggil setelah login berhasil.
 */
async function initializeApp() { 
  showLoader();
  try {
    // 1. Cek URL Parameter (Fitur Deep Linking)
    // Berguna jika admin membuka link dari notifikasi WA untuk langsung ke tanggal tertentu
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
    // Kita memuat Menu dan Lokasi DULUAN agar saat load reservasi, data referensi sudah ada
    console.log("Memuat data master...");
    await Promise.all([
        loadMenus(),     // Mengisi detailMenu dan menuPrices
        loadLocations()  // Mengisi locationsData
    ]);

    // 3. Setup Listeners Realtime
    // Listener ini akan terus berjalan di background
    loadReservationsForCurrentMonth(); // Listener Kalender (Ada di Bagian 3)
    initInboxListener();               // Listener Inbox Permintaan
    
    // 4. Setup Notifikasi Checker
    setupReliableNotificationChecker(); // (Ada di Bagian 5)

    console.log("Inisialisasi selesai.");

  } catch (e) {
    console.error("Init Error:", e);
    showToast("Gagal memuat data aplikasi. Coba refresh.", "error");
    hideLoader();
  }
}


/**
 * 7. LOAD DATA MASTER (MENU & LOKASI)
 * Data ini jarang berubah, tapi krusial untuk validasi dan perhitungan harga.
 */
async function loadMenus() {
  try {
    // Kita gunakan .get() sekali jalan. Jika butuh realtime, ganti ke onSnapshot.
    const snapshot = await db.collection('menus').get();
    
    // Reset Global Variables
    detailMenu = {};
    menuPrices = {}; 
    
    const previewList = document.getElementById('preview-menu-list');
    let htmlContent = '';

    if (snapshot.empty) {
        if(previewList) previewList.innerHTML = '<p class="text-muted">Belum ada menu.</p>';
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        
        // Simpan ke Cache Global
        detailMenu[doc.id] = data.details || []; 
        menuPrices[doc.id] = data.price || 0;
        
        // Render Preview List di Tab Data Master (agar tidak perlu refresh DOM terpisah)
        htmlContent += `
        <div class="menu-item">
            <span>
                <b>${escapeHtml(doc.id)}</b> 
                <span style="color:var(--success); font-size:0.85rem; margin-left:5px;">
                    (Rp ${formatRupiah(data.price)})
                </span>
            </span>
        </div>`;
    });

    if(previewList) previewList.innerHTML = htmlContent;
    console.log(`Menu dimuat: ${Object.keys(menuPrices).length} items`);

  } catch (e) { 
    console.error("Error Load Menu:", e);
    showToast("Gagal memuat data menu", "error");
  }
}

async function loadLocations() {
    try {
        const snapshot = await db.collection('locations').get();
        
        // Reset Global Variable
        locationsData = {};
        
        const previewList = document.getElementById('preview-location-list');
        let htmlContent = '';

        if (snapshot.empty) {
            if(previewList) previewList.innerHTML = '<p class="text-muted">Belum ada lokasi.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Simpan ke Cache Global (Key ID Dokumen diperlukan untuk update/delete nanti)
            locationsData[doc.id] = {
                name: data.name,
                capacity: data.capacity
            };
            
            // Render Preview List
            htmlContent += `
            <div class="menu-item">
                <span>
                    <b>${escapeHtml(data.name)}</b> 
                    <small style="color:var(--text-muted);">
                        (Kapasitas: ${data.capacity} org)
                    </small>
                </span>
            </div>`;
        });

        if(previewList) previewList.innerHTML = htmlContent;
        console.log(`Lokasi dimuat: ${Object.keys(locationsData).length} tempat`);

    } catch (e) { 
        console.error("Error Load Locations:", e);
        showToast("Gagal memuat data lokasi", "error");
    }
}


/**
 * 8. SISTEM INBOX PERMINTAAN (Integrasi Website 2)
 * Menangani reservasi yang masuk dari form customer (Pending Approval).
 */
function initInboxListener() {
    // Matikan listener lama jika ada (mencegah duplikasi saat logout-login)
    if (unsubscribeRequests) unsubscribeRequests();
    
    // Listener Realtime untuk koleksi 'reservation_requests'
    console.log("Mengaktifkan listener Inbox...");
    
    unsubscribeRequests = db.collection('reservation_requests')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            // Update Cache
            requestsCache = snapshot.docs.map(d => ({
                id: d.id, 
                ...d.data()
            }));
            
            // Render UI
            renderInboxUI();
            
            // Update Statistik Dashboard (Badge Notifikasi)
            updateInboxBadgeCount();
            
        }, err => {
            console.error("Inbox Listener Error:", err);
            // Jangan showToast error di sini agar tidak spamming jika koneksi putus nyambung
        });
}

function updateInboxBadgeCount() {
    const count = requestsCache.length;
    
    // Update Badge di Sidebar
    const badge = document.getElementById('sidebar-badge');
    if (badge) {
        if(count > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = count > 99 ? '99+' : count;
        } else {
            badge.style.display = 'none';
        }
    }
    
    // Update Widget di Dashboard Utama
    const statPending = document.getElementById('stat-pending-count');
    if (statPending) statPending.textContent = count;
}

function renderInboxUI() {
    const container = document.getElementById('inbox-container');
    if (!container) return; // Guard clause jika elemen tidak ada di DOM

    // State Kosong
    if (requestsCache.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:50px 20px; color:#999; background:white; border-radius:12px; border:1px dashed #ddd;">
            <i class="fas fa-inbox fa-3x" style="opacity:0.3; margin-bottom:15px; display:block;"></i>
            <h4 style="margin:0; color:#555;">Inbox Kosong</h4>
            <p style="margin-top:5px; font-size:0.9rem;">Belum ada permintaan reservasi baru.</p>
        </div>`;
        return;
    }

    // Render Cards
    container.innerHTML = requestsCache.map(r => {
        // Logika Generate HTML List Menu
        let menuHtml = '<span style="color:#999; font-style:italic; font-size:0.85rem;">Tidak ada detail menu</span>';
        
        if(r.menus && Array.isArray(r.menus) && r.menus.length > 0) {
            menuHtml = r.menus.map(m => {
                // Hitung estimasi harga per item
                const unitPrice = menuPrices[m.name] || 0;
                const subtotal = unitPrice * m.quantity;
                
                return `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; border-bottom:1px solid #f0f0f0; padding:4px 0;">
                    <span><b>${m.quantity}x</b> ${escapeHtml(m.name)}</span>
                    <span style="color:#666;">Rp ${formatRupiah(subtotal)}</span>
                </div>`;
            }).join('');
        }

        // Penanganan field 'via' (dari web atau manual)
        const sourceLabel = r.via ? `<span class="req-via">${escapeHtml(r.via)}</span>` : '<span class="req-via">Web</span>';

        return `
        <div class="request-card">
            <div class="request-header">
                <span class="req-name">${escapeHtml(r.nama)}</span>
                ${sourceLabel}
            </div>
            
            <div class="req-details">
                <div style="margin-bottom:4px;">
                    <i class="fas fa-calendar-alt" style="color:var(--primary); width:20px; text-align:center;"></i> 
                    <b>${escapeHtml(r.date)}</b> &nbsp; 
                    <i class="fas fa-clock" style="color:var(--primary); width:20px; text-align:center;"></i> 
                    <b>${escapeHtml(r.jam)}</b>
                </div>
                <div>
                    <i class="fas fa-users" style="color:var(--primary); width:20px; text-align:center;"></i> 
                    ${r.jumlah} Orang &nbsp; 
                    <i class="fas fa-map-marker-alt" style="color:var(--primary); width:20px; text-align:center;"></i> 
                    ${escapeHtml(r.tempat)}
                </div>
            </div>
            
            <div class="req-menu-box">
                <div style="margin-bottom:5px; font-weight:600; color:#555; font-size:0.8rem;">Pesanan:</div>
                ${menuHtml}
            </div>
            
            ${r.tambahan ? `
            <div style="font-size:0.85rem; color:#d97706; background:#fffbeb; padding:8px; border-radius:4px; margin-bottom:15px; border-left:3px solid #f59e0b;">
                <i class="fas fa-sticky-note"></i> <b>Catatan:</b> ${escapeHtml(r.tambahan)}
            </div>` : ''}
            
            <div class="req-actions">
                <button class="btn-whatsapp" onclick="prepareInboxChat('${r.id}')" title="Hubungi via WA">
                    <i class="fab fa-whatsapp"></i> Chat
                </button>
                <button class="btn-danger" onclick="rejectRequest('${r.id}')" title="Tolak Permintaan">
                    <i class="fas fa-times"></i> Tolak
                </button>
                <button class="btn-success" onclick="approveRequest('${r.id}')" title="Terima & Masukkan Kalender">
                    <i class="fas fa-check"></i> Terima
                </button>
            </div>
        </div>`;
    }).join('');
}

// --- FUNGSI AKSI INBOX ---

/**
 * Membuka WhatsApp dengan pesan template berisi rincian pesanan dan total harga.
 * Menggunakan data `menuPrices` yang sudah diload di awal.
 */
function prepareInboxChat(id) {
    const r = requestsCache.find(item => item.id === id);
    if (!r) { showToast("Data permintaan tidak ditemukan", "error"); return; }

    let totalFood = 0;
    let orderSummary = "";
    
    // Kalkulasi Total Harga
    if (r.menus && Array.isArray(r.menus)) {
        r.menus.forEach(m => {
            let unitPrice = menuPrices[m.name] || 0;
            let sub = unitPrice * m.quantity;
            totalFood += sub;
            orderSummary += `- ${m.name} (${m.quantity}x) : Rp ${formatRupiah(sub)}\n`;
        });
    }
    
    // Logika DP (Misal 50% atau sesuai kebijakan)
    let grandTotal = totalFood; 
    let dp = grandTotal > 0 ? grandTotal * 0.5 : 0; 

    // Template Pesan
    let msg = `Halo Kak *${r.nama}* 👋,\n\n` +
        `Terima kasih telah melakukan permintaan reservasi di *Dolan Sawah*.\n` +
        `Berikut kami konfirmasi detail pesanan Kakak:\n\n` +
        `🗓 Tanggal: ${r.date}\n` +
        `⏰ Jam: ${r.jam}\n` +
        `👥 Jumlah: ${r.jumlah} Orang\n` +
        `📍 Tempat: ${r.tempat}\n\n` +
        `*Rincian Menu:*\n${orderSummary || '- Tidak ada menu khusus\n'}\n` +
        `----------------------------------\n` +
        `*Total Estimasi: Rp ${formatRupiah(grandTotal)}*\n` +
        `----------------------------------\n\n` +
        `Untuk mengamankan slot reservasi ini, mohon kesediaannya melakukan pembayaran *DP sebesar Rp ${formatRupiah(dp)}*.\n\n` +
        `Pembayaran bisa ditransfer ke:\n` +
        `💳 BCA: 0123456789 (Dolan Sawah)\n\n` +
        `Mohon kirimkan bukti transfer jika sudah ya Kak. Terima kasih! 🙏`;

    // Validasi Nomor HP
    if (!r.nomorHp) {
        showToast("Nomor HP pemesan tidak tersedia", "error");
        return;
    }

    window.open(`https://wa.me/${cleanPhoneNumber(r.nomorHp)}?text=${encodeURIComponent(msg)}`, '_blank');
}

/**
 * Menyetujui Permintaan:
 * 1. Meminta input Nominal DP & Metode Bayar (via SweetAlert).
 * 2. Memindahkan data dari 'reservation_requests' ke 'reservations'.
 * 3. Menghapus data di 'reservation_requests'.
 */
async function approveRequest(id) {
    const req = requestsCache.find(r => r.id === id);
    if(!req) return;

    // Tampilkan Dialog Input DP
    const { value: formValues } = await Swal.fire({
        title: `Approve: ${req.nama}`,
        html: `
            <div style="text-align:left; font-size:0.9rem; color:#666; margin-bottom:5px;">Nominal DP Masuk (Rp):</div>
            <input id="swal-input-dp" type="number" class="swal2-input" placeholder="Contoh: 50000" style="margin-top:0;">
            
            <div style="text-align:left; font-size:0.9rem; color:#666; margin-bottom:5px; margin-top:15px;">Metode Pembayaran DP:</div>
            <select id="swal-input-type" class="swal2-select" style="display:block; width:100%; margin-top:0;">
                <option value="Transfer BCA">Transfer BCA</option>
                <option value="Transfer Mandiri">Transfer Mandiri</option>
                <option value="Transfer BRI">Transfer BRI</option>
                <option value="QRIS">QRIS</option>
                <option value="Cash">Cash</option>
                <option value="Lainnya">Lainnya</option>
            </select>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-check"></i> Simpan & Approve',
        confirmButtonColor: 'var(--success)',
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
            // Persiapkan Data Baru
            const newData = { 
                ...req, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp(), 
                dp: parseInt(formValues.dp) || 0, 
                tipeDp: formValues.tipeDp 
            };
            
            // Bersihkan properti yang tidak diperlukan di koleksi utama
            delete newData.id;     // ID lama akan diganti ID baru otomatis
            delete newData.via;    // Opsional, bisa dihapus
            delete newData.status; // Status tidak lagi 'pending'

            // Transactional (Batch) Operation agar atomik (sukses semua atau gagal semua)
            const batch = db.batch();
            
            // 1. Tambah ke reservations
            const newResRef = db.collection('reservations').doc(); // Auto ID
            batch.set(newResRef, newData);
            
            // 2. Hapus dari requests
            const oldReqRef = db.collection('reservation_requests').doc(id);
            batch.delete(oldReqRef);
            
            await batch.commit();
            
            showToast('Permintaan disetujui & masuk kalender', 'success');
            
            // Opsional: Buka tab kalender di tanggal reservasi tsb
            // switchTab('calendar');
            // setTimeout(() => {
            //     // Logic untuk jump to date bisa ditambahkan di sini
            // }, 500);

        } catch (e) { 
            console.error("Approve Error:", e);
            showToast('Terjadi kesalahan saat menyetujui permintaan', 'error');
        } finally {
            hideLoader();
        }
    }
}

/**
 * Menolak Permintaan:
 * Menghapus data permanen dari database.
 */
async function rejectRequest(id) {
    // Konfirmasi Ganda
    const result = await Swal.fire({
        title: 'Tolak Permintaan?',
        text: "Data permintaan ini akan dihapus permanen.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Ya, Tolak & Hapus'
    });

    if (result.isConfirmed) {
        showLoader();
        try {
            await db.collection('reservation_requests').doc(id).delete();
            Swal.fire(
                'Dihapus!',
                'Permintaan telah ditolak.',
                'success'
            );
        } catch(e) { 
            console.error("Reject Error:", e);
            showToast('Gagal menghapus data', 'error'); 
        } finally { 
            hideLoader(); 
        }
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 3: SYSTEM KALENDER UTAMA & DASHBOARD STATS
// ============================================================================

/**
 * 9. LOAD RESERVASI (KALENDER & DASHBOARD)
 * Mengambil data reservasi range 1 bulan penuh secara realtime.
 */
function loadReservationsForCurrentMonth() {
  // Matikan listener sebelumnya agar tidak menumpuk saat ganti bulan
  if (unsubscribeReservations) unsubscribeReservations();
  
  showLoader();

  // Tentukan range tanggal (Tanggal 1 s/d Akhir Bulan)
  const monthStr = String(currentMonth + 1).padStart(2, '0');
  const startDate = `${currentYear}-${monthStr}-01`;
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const endDate = `${currentYear}-${monthStr}-${lastDay}`;
  
  console.log(`Memuat reservasi: ${startDate} s/d ${endDate}`);

  unsubscribeReservations = db.collection('reservations')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .onSnapshot( snapshot => {
        // Reset Cache Lokal
        dataReservasi = {};      // Grouping per tanggal
        allReservationsList = []; // Flat list untuk dashboard

        snapshot.forEach(doc => {
          const r = { id: doc.id, ...doc.data() };
          
          // Masukkan ke Flat List (untuk statistik dashboard)
          allReservationsList.push(r);

          // Masukkan ke Grouping Tanggal (untuk kalender)
          // Format Date di database: YYYY-MM-DD
          // Kita ambil substring "MM-DD" sebagai key
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

        // 3. Cek Auto Open (Deep Link dari WA)
        handleAutoOpen();

        // 4. Jika user sedang membuka detail tanggal tertentu, refresh list-nya
        // (Agar jika ada data baru masuk di tanggal yg sedang dibuka, langsung muncul)
        if (tanggalDipilih && !hasAutoOpened) {
            const reservations = dataReservasi[tanggalDipilih] || [];
            updateReservationList(reservations);
        }
        
        hideLoader();
      }, 
      err => { 
          console.error("Reservation Listener Error:", err);
          showToast("Gagal memuat data kalender", "error");
          hideLoader(); 
      }
    );
}


/**
 * 10. UPDATE DASHBOARD WIDGETS
 * Menghitung statistik dan menampilkan "Reservasi Terbaru" di tab Dashboard.
 */
function updateDashboardWidgets(allData) {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // --- Widget 1: Reservasi Hari Ini ---
    const todayCount = allData.filter(r => r.date === todayStr).length;
    const statToday = document.getElementById('stat-today-count');
    if(statToday) statToday.textContent = todayCount;

    // --- Widget 2: Request Pending ---
    // (Sudah dihandle di Bagian 2 via updateInboxBadgeCount, tapi kita pastikan aman)
    const statPending = document.getElementById('stat-pending-count');
    if(statPending) statPending.textContent = requestsCache.length;

    // --- Widget 3: Omzet DP Bulan Ini ---
    // Menjumlahkan field 'dp' dari semua reservasi bulan ini
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
        }).slice(0, 5); // Ambil 5 teratas

        if (sortedRecent.length === 0) {
            recentListContainer.innerHTML = '<p class="text-center text-muted" style="padding:20px;">Belum ada reservasi bulan ini.</p>';
        } else {
            recentListContainer.innerHTML = sortedRecent.map(r => `
                <div class="reservation-list-item">
                    <div>
                        <div style="font-weight:600; color:var(--text-main);">${escapeHtml(r.nama)}</div>
                        <small class="text-muted" style="font-size:0.8rem;">
                            <i class="far fa-calendar"></i> ${r.date} &bull; <i class="far fa-clock"></i> ${r.jam}
                        </small>
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
 * 11. RENDER GRID KALENDER
 * Membuat kotak-kotak tanggal sesuai bulan yang dipilih.
 */
function buatKalender() {
  const calendarEl = document.getElementById('calendar');
  const monthYearEl = document.getElementById('monthYear');
  
  if(!calendarEl || !monthYearEl) return;

  calendarEl.innerHTML = ''; 
  monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Logika Hari
  const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // Hari apa tgl 1 dimulai (0=Minggu)
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate(); // Total hari bulan ini
  
  // Render Filler (Kotak kosong sebelum tanggal 1)
  for (let i = 0; i < firstDay; i++) { 
      calendarEl.insertAdjacentHTML('beforeend', `<div></div>`); 
  }
  
  // Render Tanggal 1 s/d Akhir
  for (let i = 1; i <= daysInMonth; i++) {
    const dateKey = `${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    // Cek Status
    const isToday = new Date().toDateString() === new Date(currentYear, currentMonth, i).toDateString() ? 'today' : '';
    const isSelected = dateKey === tanggalDipilih ? 'selected' : '';
    
    // Cek Data
    const dailyData = dataReservasi[dateKey] || [];
    const countHTML = dailyData.length > 0 
        ? `<div class="reservation-count">${dailyData.length} Res</div>` 
        : '';
    
    calendarEl.insertAdjacentHTML('beforeend', `
      <div class="calendar-day ${isToday} ${isSelected}" onclick="pilihTanggal(${i})">
        <span class="day-number">${i}</span>
        ${countHTML}
      </div>`);
  }
}


/**
 * 12. INTERAKSI TANGGAL (DETAIL VIEW)
 * Saat user klik tanggal di kalender.
 */
function pilihTanggal(day) {
  // Set global state
  tanggalDipilih = `${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Refresh highlight di kalender (agar tanggal yg dipilih berwarna hijau)
  buatKalender(); 
  
  // Ambil data spesifik tanggal ini
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
  
  // Tampilkan Container Detail & Scroll ke sana
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) {
      viewContainer.style.display = 'block';
      viewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Tutup Detail View
function kembaliKeKalender() {
  const viewContainer = document.getElementById('reservation-view-container');
  if(viewContainer) viewContainer.style.display = 'none';
  
  tanggalDipilih = ''; // Reset pilihan
  buatKalender();      // Hapus highlight
}


/**
 * 13. RENDER LIST DETAIL RESERVASI
 * Menampilkan kartu detail untuk setiap reservasi di tanggal yang dipilih.
 * Ini menggabungkan gaya modern dengan fitur lengkap (edit/delete/wa/thanks).
 */
function updateReservationList(reservations) {
    const container = document.getElementById('reservation-detail-list');
    if(!container) return;
    
    // Kondisi Kosong
    if (!reservations || reservations.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:30px; color:#999; background:#f9fafb; border-radius:8px;">
            <i class="far fa-calendar-times fa-2x" style="margin-bottom:10px; opacity:0.5;"></i>
            <p>Tidak ada reservasi untuk tanggal ini.</p>
            <button class="btn-sm btn-primary" onclick="showAddForm()" style="margin-top:10px;">
                <i class="fas fa-plus"></i> Tambah Baru
            </button>
        </div>`; 
        return;
    }
    
    // Urutkan berdasarkan Jam (Ascending)
    const sortedRes = [...reservations].sort((a,b) => (a.jam || '').localeCompare(b.jam || ''));
    
    container.innerHTML = sortedRes.map(r => {
        // --- LOGIKA RENDER MENU ---
        let menuItemsHtml = "<small style='color:#ccc; font-style:italic;'>Tidak ada menu</small>";
        
        if (Array.isArray(r.menus) && r.menus.length > 0) {
            // Format Baru (Array Object)
            menuItemsHtml = r.menus.map(item => {
                // Ambil detail menu dari master data
                const details = detailMenu[item.name] || [];
                const detailStr = details.length > 0 
                    ? `<div style="font-size:0.75rem; color:#888; margin-left:15px;">- ${details.join(', ')}</div>` 
                    : '';
                return `<div style="margin-bottom:3px;">
                            <b>${item.quantity}x</b> ${escapeHtml(item.name)}
                            ${detailStr}
                        </div>`;
            }).join('');
        } else if (r.menu) { 
            // Format Lama (String Legacy)
            const details = detailMenu[r.menu] || [];
            const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
            menuItemsHtml = `<div>${escapeHtml(r.menu)}${detailStr}</div>`;
        }

        // --- LOGIKA UI BADGE ---
        const dpInfo = r.dp > 0 
            ? `<span class="pill" style="background:#dcfce7; color:#166534; font-size:0.75rem;">
                <i class="fas fa-check"></i> DP: Rp${formatRupiah(r.dp)} (${r.tipeDp || '?'})
               </span>` 
            : `<span class="pill" style="background:#fee2e2; color:#991b1b; font-size:0.75rem;">
                <i class="fas fa-exclamation-circle"></i> Tanpa DP
               </span>`;
        
        // --- LOGIKA TOMBOL 'SAY THANKS' ---
        let thanksBtn = '';
        if(r.nomorHp) {
            if (r.thankYouSent) {
                thanksBtn = `<button class="btn-sm btn-success" disabled style="opacity:0.7; cursor:default;">
                                <i class="fas fa-check-double"></i> Thanks Sent
                             </button>`;
            } else {
                thanksBtn = `<button class="btn-sm btn-info" id="thank-btn-${r.id}" onclick="sendThankYouMessage('${r.id}', '${escapeHtml(r.nama)}', '${r.nomorHp}')">
                                <i class="fas fa-gift"></i> Say Thanks
                             </button>`;
            }
        }

        // --- RENDER KARTU ---
        return `
        <div class="reservation-item">
            <div style="border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <h4 style="margin:0; color:var(--primary-dark); font-size:1.1rem;">${escapeHtml(r.nama)}</h4>
                    ${dpInfo}
                </div>
                <div style="font-size:0.9rem; margin-top:5px; color:#555; display:flex; gap:10px; flex-wrap:wrap;">
                    <span><i class="fas fa-clock" style="color:var(--primary);"></i> ${r.jam}</span>
                    <span><i class="fas fa-map-marker-alt" style="color:var(--primary);"></i> ${escapeHtml(r.tempat)}</span>
                    <span><i class="fas fa-users" style="color:var(--primary);"></i> <b>${r.jumlah}</b> Org</span>
                </div>
                ${r.nomorHp ? `<div style="font-size:0.85rem; color:#666; margin-top:3px;"><i class="fas fa-phone"></i> ${r.nomorHp}</div>` : ''}
            </div>
            
            <div class="menu-detail">
                <div style="display:flex; align-items:center; gap:5px; color:var(--secondary); font-weight:600; margin-bottom:5px;">
                    <i class="fas fa-utensils"></i> Pesanan:
                </div>
                <div style="padding-left:5px;">${menuItemsHtml}</div>
            </div>
            
            ${r.tambahan ? `<div style="font-size:0.85rem; color:#d97706; margin-top:5px; background:#fffbeb; padding:5px; border-radius:4px;"><i class="fas fa-comment-dots"></i> ${escapeHtml(r.tambahan)}</div>` : ''}
            
            <div style="display:flex; gap:8px; margin-top:15px; flex-wrap:wrap; border-top:1px solid #eee; padding-top:10px;">
                ${r.nomorHp ? `<button class="btn-sm btn-whatsapp" onclick="contactViaWhatsApp('${r.id}')"><i class="fab fa-whatsapp"></i> WA</button>` : ''}
                ${thanksBtn}
                <div style="flex:1;"></div> <button class="btn-sm btn-secondary" onclick="editReservasi('${r.id}')" title="Edit Data"><i class="fas fa-edit"></i></button>
                <button class="btn-sm btn-danger" onclick="hapusReservasi('${r.id}')" title="Hapus Data"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}


/**
 * 14. NAVIGASI BULAN & SEARCH
 * Fungsi-fungsi pendukung interaksi di tab Kalender.
 */
function navigateMonth(direction) {
    currentMonth += direction;
    
    // Handle tahun baru
    if (currentMonth < 0) { 
        currentMonth = 11; 
        currentYear--; 
    }
    if (currentMonth > 11) { 
        currentMonth = 0; 
        currentYear++; 
    }
    
    // Refresh View
    kembaliKeKalender(); // Tutup detail view jika ada
    loadReservationsForCurrentMonth(); // Load data bulan baru
}

// Shortcuts
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

// Search Filter di Detail View
function filterReservations(query) {
  if (!tanggalDipilih || !dataReservasi[tanggalDipilih]) return;
  
  const q = query.toLowerCase();
  const rawList = dataReservasi[tanggalDipilih];
  
  const filtered = rawList.filter(r => 
    (r.nama && r.nama.toLowerCase().includes(q)) || 
    (r.tempat && r.tempat.toLowerCase().includes(q)) ||
    (r.nomorHp && r.nomorHp.includes(q)) ||
    (r.menus && r.menus.some(m => m.name.toLowerCase().includes(q))) || // Cek array menu
    (r.menu && r.menu.toLowerCase().includes(q)) // Cek legacy menu
  );
  
  updateReservationList(filtered);
}

// Deep Link Auto Open (Membuka tanggal otomatis dari parameter URL)
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
                
                hasAutoOpened = true; // Flag done
                showToast("Membuka reservasi otomatis");
                
                // Bersihkan URL agar bersih (optional)
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 4: MANAJEMEN CRUD RESERVASI (MANUAL)
// ============================================================================

/**
 * 15. TAMPILKAN FORM TAMBAH
 * Menyiapkan popup formulir untuk input data baru.
 */
function showAddForm() {
    const form = document.getElementById('reservation-form');
    if (!form) return;

    // Reset Form & Error Messages
    form.reset();
    document.querySelectorAll('#reservation-form .error-message').forEach(el => el.textContent = '');
    
    // Validasi UI: Pastikan tanggal sudah dipilih di kalender
    // (Kecuali jika input lewat tombol "Aksi Cepat" di dashboard, kita default ke hari ini)
    if (!tanggalDipilih) {
        // Jika belum pilih tanggal (misal dari Dashboard), set ke hari ini
        const now = new Date();
        tanggalDipilih = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // Opsional: Buka kalender di tanggal ini
        // pilihTanggal(now.getDate()); 
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
 * 16. TAMPILKAN FORM EDIT
 * Mengambil data reservasi yang ada, mengisi form, dan menampilkannya.
 */
function editReservasi(id) {
  // 1. Cari data reservasi di cache lokal (dataReservasi)
  // Kita cari di seluruh key tanggal karena id bersifat unik
  let res = null;
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
  
  // 2. Siapkan Container Popup Edit (Inject HTML Form secara dinamis agar bersih)
  const formContainer = document.getElementById('editFormPopup');
  
  formContainer.innerHTML = `
    <h3><i class="fas fa-edit"></i> Edit Reservasi</h3>
    <form id="edit-reservation-form">
      <input type="hidden" id="editReservationId" value="${res.id}" />
      
      <label>Nama Pelanggan: 
        <input type="text" id="nama" value="${escapeHtml(res.nama || '')}" required />
        <span class="error-message" id="nama-error"></span>
      </label>
      
      <label>Nomor HP: 
        <input type="tel" id="nomorHp" value="${res.nomorHp || ''}" placeholder="08..." />
        <span class="error-message" id="nomorHp-error"></span>
      </label>
      
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
          <div>
              <label>Jam: 
                <input type="time" id="jam" value="${res.jam || ''}" required />
                <span class="error-message" id="jam-error"></span>
              </label>
          </div>
          <div>
              <label>Jumlah Org: 
                <input type="number" id="jumlah" value="${res.jumlah || ''}" min="1" required />
                <span class="error-message" id="jumlah-error"></span>
              </label>
          </div>
      </div>
      
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
          <div>
            <label>Nominal DP: <input type="number" id="dp" value="${res.dp || 0}" min="0" /></label>
          </div>
          <div>
            <label>Metode DP: 
                <select id="tipeDp">
                    <option value="">- Tanpa DP -</option>
                    <option value="Cash">Cash</option>
                    <option value="QRIS">QRIS</option>
                    <option value="Transfer BCA">Transfer BCA</option>
                    <option value="Transfer Mandiri">Transfer Mandiri</option>
                    <option value="Transfer BRI">Transfer BRI</option>
                    <option value="Lainnya">Lainnya</option>
                </select>
            </label>
          </div>
      </div>
      
      <label>Tempat / Lokasi: 
        <select id="tempat" required onchange="updateCapacityInfo('edit-reservation-form')"></select>
        <span id="capacity-info" style="font-size:0.8rem; color:#666; display:block; margin-top:2px;"></span>
        <span class="error-message" id="tempat-error"></span>
      </label>
      
      <label>Paket Menu: <span class="error-message" id="menus-error"></span></label>
      <div id="selected-menus-container"></div>
      <button type="button" class="btn-sm btn-secondary" onclick="addMenuSelectionRow('edit-reservation-form')">
        <i class="fas fa-plus"></i> Tambah Menu
      </button>
      
      <label>Catatan Tambahan: <textarea id="tambahan">${escapeHtml(res.tambahan || '')}</textarea></label>
      
      <div class="popup-actions">
        <button type="button" class="btn-primary" onclick="simpanPerubahanReservasi()">
            <i class="fas fa-save"></i> Simpan Perubahan
        </button>
        <button type="button" class="btn-danger" onclick="closePopup('editFormPopup')">
            Batal
        </button>
      </div>
    </form>`;
  
  const editFormEl = document.getElementById('edit-reservation-form');
  
  // 3. Set Nilai Dropdown & Helper
  // Set Tipe DP
  const tipeDpSelect = editFormEl.querySelector('#tipeDp');
  if(tipeDpSelect) tipeDpSelect.value = res.tipeDp || '';
  
  // Set Lokasi & Populate
  const tempatSelect = editFormEl.querySelector('#tempat');
  populateLocationDropdown(tempatSelect, res.tempat);
  updateCapacityInfo('edit-reservation-form');
  
  // 4. Populate Menu (Legacy vs New Format)
  const menuContainer = editFormEl.querySelector('#selected-menus-container');
  menuContainer.innerHTML = ''; // Bersihkan

  if (Array.isArray(res.menus) && res.menus.length > 0) {
    // Jika format baru (Array Object), loop dan buat baris
    res.menus.forEach(item => {
        addMenuSelectionRow('edit-reservation-form', item.name, item.quantity);
    });
  } else if (res.menu) {
    // Jika format lama (String), coba masukkan ke baris pertama
    // Note: Jika nama menu di string lama tidak cocok dengan Data Master, dropdown mungkin kosong.
    addMenuSelectionRow('edit-reservation-form', res.menu, 1);
  } else {
    // Jika tidak ada menu, buat 1 baris kosong
    addMenuSelectionRow('edit-reservation-form');
  }
  
  // 5. Tampilkan
  formContainer.style.display = 'block'; 
  overlay.style.display = 'block';
}


/**
 * 17. OPERASI DATABASE: TAMBAH (CREATE)
 */
async function simpanReservasi() {
  // 1. Validasi Form
  const formData = await validateAndGetFormData('reservation-form');
  
  // 2. Cek Tanggal
  if (!formData) return; // Stop jika tidak valid
  if (!tanggalDipilih) { 
      showToast("Silakan pilih tanggal di kalender terlebih dahulu!", "error");
      return; 
  }
  
  showLoader();
  try {
    // 3. Kirim ke Firestore
    // Kita gunakan serverTimestamp untuk sorting yang akurat
    const payload = { 
        ...formData, 
        date: `${currentYear}-${tanggalDipilih}`, 
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        thankYouSent: false // Default status
    };

    await db.collection('reservations').add(payload);
    
    showToast("Reservasi berhasil disimpan!", "success");
    closePopup('addFormPopup'); 
    
    // Opsional: Refresh view jika diperlukan (Listener akan otomatis handle ini)

  } catch (e) { 
    console.error("Save Error:", e);
    showToast("Gagal menyimpan reservasi: " + e.message, "error"); 
  } finally { 
    hideLoader(); 
  }
}


/**
 * 18. OPERASI DATABASE: EDIT (UPDATE)
 */
async function simpanPerubahanReservasi() {
  // 1. Ambil ID Dokumen
  const id = document.getElementById('editReservationId').value;
  if (!id) return;

  // 2. Validasi Form
  const formData = await validateAndGetFormData('edit-reservation-form');
  if (!formData) return;
  
  showLoader();
  try {
    // 3. Update ke Firestore
    // Note: Kita tidak mengubah 'createdAt' agar urutan tidak berubah
    // Note: Kita tidak mengubah 'date' di sini (asumsi edit hanya ubah detail, bukan pindah tanggal)
    // Jika ingin fitur pindah tanggal, kita perlu logic tambahan untuk update field 'date'.
    
    await db.collection('reservations').doc(id).update(formData);
    
    showToast("Perubahan berhasil disimpan", "success");
    closePopup('editFormPopup');
    
  } catch (e) { 
    console.error("Update Error:", e);
    showToast("Gagal menyimpan perubahan", "error"); 
  } finally { 
    hideLoader(); 
  }
}


/**
 * 19. OPERASI DATABASE: HAPUS (DELETE)
 */
async function hapusReservasi(id) {
  // Konfirmasi Native Browser (Cepat & Aman)
  if (!confirm("Apakah Anda yakin ingin menghapus data reservasi ini secara permanen?")) return;
  
  showLoader();
  try { 
      await db.collection('reservations').doc(id).delete(); 
      showToast("Data reservasi telah dihapus", "success"); 
      // Popup edit otomatis tertutup jika terbuka karena ID hilang dari cache listener
      closePopup('editFormPopup');
  } catch (e) { 
      console.error("Delete Error:", e);
      showToast("Gagal menghapus data", "error"); 
  } finally { 
      hideLoader(); 
  }
}


/**
 * 20. VALIDASI FORM & DATA EXTRACTION
 * Fungsi sentral untuk mengambil data dari form, membersihkan input, dan validasi logika bisnis.
 */
async function validateAndGetFormData(formId) {
    const form = document.getElementById(formId);
    let isValid = true;
    
    // Helper function untuk set pesan error
    const setError = (elementId, message) => { 
        const errEl = form.querySelector(`#${elementId}-error`);
        if(errEl) errEl.textContent = message; 
        isValid = false; 
    };

    // --- 1. Validasi Nama ---
    const namaInput = form.querySelector('#nama');
    const nama = namaInput.value.trim();
    if(!nama) setError('nama', 'Nama pelanggan wajib diisi');

    // --- 2. Validasi Nomor HP ---
    const hpInput = form.querySelector('#nomorHp');
    const nomorHp = cleanPhoneNumber(hpInput.value);
    // Jika diisi, harus valid. Jika kosong, boleh (opsional, tergantung kebijakan)
    if(hpInput.value.trim() !== '' && !isValidPhone(nomorHp)) {
        setError('nomorHp', 'Nomor HP tidak valid (min 10 digit)');
    }

    // --- 3. Validasi Jam ---
    const jamInput = form.querySelector('#jam');
    const jam = jamInput.value;
    if(!jam) setError('jam', 'Jam wajib diisi');

    // --- 4. Validasi Jumlah & Kapasitas Tempat ---
    const jumlahInput = form.querySelector('#jumlah');
    const jumlah = parseInt(jumlahInput.value);
    const tempatInput = form.querySelector('#tempat');
    const tempat = tempatInput.value;

    if(isNaN(jumlah) || jumlah < 1) {
        setError('jumlah', 'Jumlah minimal 1 orang');
    }
    
    if(!tempat) {
        setError('tempat', 'Lokasi wajib dipilih');
    } else {
        // Cek Kapasitas Logis
        // Kita cari object lokasi di locationsData berdasarkan NAMA (karena value option adalah nama)
        // Idealnya value option adalah ID, tapi utk backward compatibility kita pakai nama dulu.
        const locationKey = Object.keys(locationsData).find(k => locationsData[k].name === tempat);
        
        if(locationKey) {
            const cap = locationsData[locationKey].capacity;
            if (jumlah > cap) {
                // Warning saja atau Error? Kita buat Error agar admin aware.
                setError('jumlah', `Melebihi kapasitas tempat (${cap} org)`);
            }
        }
    }

    // --- 5. Validasi & Ekstraksi Menu ---
    const menus = [];
    const menuRows = form.querySelectorAll('.menu-selection-row');
    const selectedItems = new Set(); // Untuk cek duplikat

    menuRows.forEach(row => {
        const select = row.querySelector('select');
        const qtyInput = row.querySelector('input');
        
        const mName = select.value;
        const mQty = parseInt(qtyInput.value);
        
        // Hanya ambil jika nama menu dipilih dan qty valid
        if(mName && !isNaN(mQty) && mQty > 0) {
            if(selectedItems.has(mName)) {
                // Jika duplikat, tandai error visual (opsional) atau skip/merge
                // Kita anggap error di container utama
                setError('menus', 'Ada menu yang dipilih ganda. Mohon gabungkan.');
            } else {
                selectedItems.add(mName);
                menus.push({ name: mName, quantity: mQty });
            }
        }
    });

    // Validasi: Minimal 1 menu harus dipilih? 
    // Tergantung kebijakan. Jika boleh reservasi tempat saja, hapus blok ini.
    // if(menus.length === 0) setError('menus', 'Pilih minimal 1 menu makanan/minuman');

    // --- RESULT ---
    if(!isValid) return null;

    // Kembalikan Object Bersih
    return {
        nama: nama,
        nomorHp: nomorHp, // Simpan format bersih (hanya angka)
        jam: jam,
        jumlah: jumlah,
        tempat: tempat,
        menus: menus, // Array of Objects
        dp: parseInt(form.querySelector('#dp').value) || 0,
        tipeDp: form.querySelector('#tipeDp').value,
        tambahan: form.querySelector('#tambahan').value.trim()
    };
}


/**
 * 21. HELPER FORM UI
 * Fungsi untuk memanipulasi elemen form secara dinamis.
 */

// Menambah Baris Input Menu
function addMenuSelectionRow(formId, defaultName='', defaultQty=1) {
  const container = document.querySelector(`#${formId} #selected-menus-container`);
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'menu-selection-row';
  
  // Buat opsi dropdown dari Master Data (detailMenu / menuPrices)
  // Kita urutkan alfabetis
  const optionsHtml = Object.keys(detailMenu).sort().map(name => {
      const price = menuPrices[name] ? ` (Rp ${formatRupiah(menuPrices[name])})` : '';
      const selected = name === defaultName ? 'selected' : '';
      return `<option value="${name}" ${selected}>${escapeHtml(name)}${price}</option>`;
  }).join('');

  div.innerHTML = `
    <select class="menu-select">
        <option value="">-- Pilih Menu --</option>
        ${optionsHtml}
    </select>
    <input type="number" class="quantity-input" value="${defaultQty}" min="1" placeholder="Qty">
    <button type="button" class="btn-danger" onclick="this.parentElement.remove()" title="Hapus baris ini">
        <i class="fas fa-trash"></i>
    </button>
  `;
  
  container.appendChild(div);
}

// Populate Dropdown Lokasi
function populateLocationDropdown(selectElement, defaultValue='') {
    if(!selectElement) return;
    
    // Kosongkan dulu
    selectElement.innerHTML = '<option value="">-- Pilih Tempat --</option>';
    
    // Sort lokasi berdasarkan nama
    const sortedLocs = Object.values(locationsData).sort((a,b) => a.name.localeCompare(b.name));
    
    sortedLocs.forEach(loc => {
        const selected = loc.name === defaultValue ? 'selected' : '';
        // Tampilkan Nama + Kapasitas di text dropdown
        const option = `<option value="${loc.name}" ${selected}>${escapeHtml(loc.name)} (Kap: ${loc.capacity})</option>`;
        selectElement.insertAdjacentHTML('beforeend', option);
    });
}

// Update Info Kapasitas Realtime saat dropdown berubah
function updateCapacityInfo(formId) {
    const form = document.getElementById(formId);
    const select = form.querySelector('#tempat');
    const infoSpan = form.querySelector('#capacity-info');
    
    const val = select.value;
    if(!val) {
        infoSpan.textContent = '';
        return;
    }
    
    // Cari data
    const locKey = Object.keys(locationsData).find(k => locationsData[k].name === val);
    if (locKey) {
        const cap = locationsData[locKey].capacity;
        infoSpan.innerHTML = `<i class="fas fa-info-circle"></i> Max Kapasitas: <b>${cap} orang</b>`;
        infoSpan.style.color = 'var(--info)';
    } else {
        infoSpan.textContent = '';
    }
}
// ============================================================================
// FILE: app.js
// BAGIAN 5: MASTER DATA, BROADCAST, TOOLS, ANALISIS & NOTIFIKASI
// ============================================================================

/**
 * 22. MANAJEMEN DATA MASTER: MENU
 * Menangani Popup CRUD untuk Menu Makanan/Minuman.
 */
function showMenuManagement() {
    const popup = document.getElementById('menuManagementPopup');
    
    // Render Struktur Popup
    popup.innerHTML = `
      <h3><i class="fas fa-book-open"></i> Kelola Menu & Harga</h3>
      
      <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #eee;">
          <h4 style="margin-top:0; color:var(--primary);">Tambah Menu Baru</h4>
          <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
             <input type="text" id="newMenuName" placeholder="Nama Menu (Cth: Nasi Goreng)">
             <input type="number" id="newMenuPrice" placeholder="Harga (Rp)">
          </div>
          <textarea id="newMenuDetails" placeholder="Detail/Varian (pisahkan koma). Cth: Pedas, Sedang, Tidak Pedas" style="margin-top:10px; min-height:60px;"></textarea>
          <button class="btn-primary" onclick="addNewMenu()" style="width:100%; margin-top:10px; justify-content:center;">
             <i class="fas fa-plus-circle"></i> Tambah Menu
          </button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h4 style="margin:0;">Daftar Menu Saat Ini</h4>
        <small class="text-muted">Total: ${Object.keys(detailMenu).length}</small>
      </div>

      <div id="manage-menu-list" style="max-height:300px; overflow-y:auto; border:1px solid #eee; border-radius:8px;"></div>
      
      <div class="popup-actions">
        <button class="btn-danger" onclick="closePopup('menuManagementPopup')">Tutup</button>
      </div>`;
    
    // Render List Menu
    renderManageMenuList();
    
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function renderManageMenuList() {
    const listEl = document.getElementById('manage-menu-list');
    if(!listEl) return;

    listEl.innerHTML = Object.keys(detailMenu).sort().map(name => {
        const price = menuPrices[name] ? parseInt(menuPrices[name]) : 0;
        return `
        <div class="menu-item" style="padding:10px 15px; border-bottom:1px solid #eee;">
            <div>
                <div style="font-weight:600;">${escapeHtml(name)}</div>
                <div style="font-size:0.85rem; color:var(--success);">Rp ${formatRupiah(price)}</div>
                <div style="font-size:0.8rem; color:#888;">${escapeHtml(detailMenu[name].join(', '))}</div>
            </div>
            <button class="btn-sm btn-danger" onclick="deleteMenu('${name}')" title="Hapus Menu">
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
    
    // Cek Duplikat
    if(detailMenu[name]) return showToast("Menu sudah ada", "error");

    const details = detailsRaw.split(',').map(s=>s.trim()).filter(Boolean);
    
    showLoader();
    try {
        await db.collection('menus').doc(name).set({ 
            details: details, 
            price: isNaN(price) ? 0 : price 
        });
        
        showToast("Menu berhasil ditambahkan");
        
        // Refresh Data & UI
        await loadMenus(); 
        renderManageMenuList();
        
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
        await loadMenus();
        renderManageMenuList();
        showToast("Menu dihapus");
    } catch(e) { showToast("Gagal menghapus", "error"); }
    finally { hideLoader(); }
}


/**
 * 23. MANAJEMEN DATA MASTER: LOKASI
 * Menangani Popup CRUD untuk Tempat/Lokasi.
 */
function showLocationManagement() {
    const popup = document.getElementById('locationManagementPopup');
    popup.innerHTML = `
      <h3><i class="fas fa-map-marker-alt"></i> Kelola Tempat</h3>
      
      <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #eee;">
          <h4 style="margin-top:0; color:var(--primary);">Tambah Tempat Baru</h4>
          <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
             <input type="text" id="newLocName" placeholder="Nama Tempat (Cth: Gazebo 1)">
             <input type="number" id="newLocCap" placeholder="Kapasitas (Org)">
          </div>
          <button class="btn-primary" onclick="addNewLocation()" style="width:100%; margin-top:10px; justify-content:center;">
             <i class="fas fa-plus-circle"></i> Tambah Tempat
          </button>
      </div>

      <h4 style="margin:0 0 10px 0;">Daftar Tempat</h4>
      <div id="manage-loc-list" style="max-height:300px; overflow-y:auto; border:1px solid #eee; border-radius:8px;"></div>
      
      <div class="popup-actions">
        <button class="btn-danger" onclick="closePopup('locationManagementPopup')">Tutup</button>
      </div>`;
      
    renderManageLocList();
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function renderManageLocList() {
    const listEl = document.getElementById('manage-loc-list');
    if(!listEl) return;

    // Mapping ID Document ke Data untuk tombol delete
    listEl.innerHTML = Object.entries(locationsData).map(([docId, data]) => `
        <div class="menu-item" style="padding:10px 15px; border-bottom:1px solid #eee;">
            <span>
                <b>${escapeHtml(data.name)}</b> <br>
                <small style="color:#666;">Kapasitas: ${data.capacity} orang</small>
            </span>
            <button class="btn-sm btn-danger" onclick="deleteLocation('${docId}')" title="Hapus Tempat">
                <i class="fas fa-trash"></i>
            </button>
        </div>`
    ).join('');
}

async function addNewLocation() {
    const name = document.getElementById('newLocName').value.trim();
    const cap = parseInt(document.getElementById('newLocCap').value);
    
    if(!name || isNaN(cap) || cap < 1) return showToast("Data tidak valid", "error");
    
    // Create Safe ID (lowercase, no space)
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    showLoader();
    try {
        await db.collection('locations').doc(id).set({ name, capacity: cap });
        showToast("Lokasi ditambahkan");
        await loadLocations();
        renderManageLocList();
        
        document.getElementById('newLocName').value = '';
        document.getElementById('newLocCap').value = '';
    } catch(e) { 
        console.error(e);
        showToast("Gagal tambah lokasi", "error"); 
    } finally { hideLoader(); }
}

async function deleteLocation(docId) {
    if(!confirm("Hapus lokasi ini?")) return;
    showLoader();
    try {
        await db.collection('locations').doc(docId).delete();
        await loadLocations();
        renderManageLocList();
        showToast("Lokasi dihapus");
    } catch(e) { showToast("Gagal hapus", "error"); }
    finally { hideLoader(); }
}


/**
 * 24. SISTEM BROADCAST WHATSAPP
 * Mengambil semua nomor unik dari database reservasi untuk promosi massal.
 */
function showBroadcastMain() { 
    document.getElementById('broadcastMainPopup').style.display = 'block'; 
    overlay.style.display = 'block'; 
}

function showBroadcastSettings() {
    closePopup('broadcastMainPopup');
    // Ambil pesan tersimpan dari LocalStorage
    document.getElementById('broadcastMessage').value = localStorage.getItem(BROADCAST_MESSAGE_KEY) || '';
    document.getElementById('broadcastSettingsPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function saveBroadcastMessage() {
    const msg = document.getElementById('broadcastMessage').value;
    if(!msg.trim()) return showToast("Pesan tidak boleh kosong", "error");
    
    localStorage.setItem(BROADCAST_MESSAGE_KEY, msg);
    promoMessageCache = msg;
    showToast("Template pesan tersimpan");
    closePopup('broadcastSettingsPopup');
    showBroadcastMain();
}

async function showBroadcastList() {
    // Pastikan pesan sudah diset
    const msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if(!msg) {
        showToast("Harap atur pesan promo terlebih dahulu!", "error");
        return showBroadcastSettings();
    }

    closePopup('broadcastMainPopup');
    showLoader();
    try {
        // Ambil 500 reservasi terakhir untuk mendapatkan data pelanggan
        const snap = await db.collection('reservations').orderBy('createdAt','desc').limit(500).get();
        const map = new Map();
        
        snap.forEach(d => {
            const data = d.data();
            if(data.nomorHp && isValidPhone(data.nomorHp)) {
                const clean = cleanPhoneNumber(data.nomorHp);
                // Gunakan Map untuk unifikasi (Nomor HP sama hanya muncul sekali)
                if(!map.has(clean)) {
                    map.set(clean, { phone: clean, name: data.nama });
                }
            }
        });
        
        allCustomersCache = Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name));
        renderBroadcastList(allCustomersCache);
        
        document.getElementById('broadcastListPopup').style.display = 'block'; 
        overlay.style.display = 'block';
    } catch(e) { 
        console.error(e);
        showToast("Gagal memuat data pelanggan", "error"); 
    } finally { 
        hideLoader(); 
    }
}

function renderBroadcastList(arr) {
    const container = document.getElementById('broadcast-customer-list');
    if(!container) return;
    
    if(arr.length === 0) {
        container.innerHTML = '<p class="text-center text-muted">Tidak ada data pelanggan yang valid.</p>';
        return;
    }

    container.innerHTML = arr.map(c => `
        <div class="menu-item" style="padding:10px;">
            <span>
                <b>${escapeHtml(c.name)}</b> <br>
                <small>${c.phone}</small>
            </span>
            <button class="btn-sm btn-whatsapp" onclick="sendPromo('${c.phone}', '${escapeHtml(c.name)}', this)">
                <i class="fab fa-whatsapp"></i> Kirim
            </button>
        </div>
    `).join('');
}

function filterBroadcastCustomers(q) {
    const query = q.toLowerCase();
    const filtered = allCustomersCache.filter(c => 
        c.name.toLowerCase().includes(query) || c.phone.includes(query)
    );
    renderBroadcastList(filtered);
}

function sendPromo(hp, nm, btnEl) {
    let msg = localStorage.getItem(BROADCAST_MESSAGE_KEY);
    if(!msg) return showToast("Template pesan hilang. Atur ulang.", "error");
    
    // Replace Placeholder
    msg = msg.replace(/kak/gi, `Kak *${nm}*`); // Ganti kata 'kak' dengan nama spesifik jika diinginkan
    
    // Buka WA
    window.open(`https://wa.me/${hp}?text=${encodeURIComponent(msg)}`, '_blank');
    
    // Feedback UI
    if(btnEl) {
        btnEl.classList.remove('btn-whatsapp');
        btnEl.classList.add('btn-secondary');
        btnEl.innerText = 'Terkirim';
        btnEl.disabled = true;
    }
}


/**
 * 25. WHATSAPP SHARE & EXPORT TOOLS
 */

// Kirim detail reservasi via WA (Personal)
function contactViaWhatsApp(id) {
    // Cari data di current view
    let r = null;
    for(const k in dataReservasi) { 
        r = dataReservasi[k].find(x => x.id === id); 
        if(r) break; 
    }
    
    if(!r) return showToast("Data tidak ditemukan", "error");
    if(!r.nomorHp) return showToast("Tidak ada nomor HP", "error");

    const msg = `Halo Kak *${r.nama}*,\n\nKami dari *Dolan Sawah* ingin mengkonfirmasi kembali reservasi Kakak:\n\n📅 Tanggal: ${r.date}\n⏰ Jam: ${r.jam}\n👥 Jumlah: ${r.jumlah} Orang\n📍 Tempat: ${r.tempat}\n\nMohon konfirmasinya ya Kak. Terima kasih! 😊`;
    
    window.open(`https://wa.me/${cleanPhoneNumber(r.nomorHp)}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Share Laporan Harian/Bulanan ke WA Owner/Grup
function shareViaWhatsApp(type) {
    let msg = "";
    
    if(type === 'day') {
        if(!tanggalDipilih) return showToast("Pilih tanggal dulu!", "error");
        const list = dataReservasi[tanggalDipilih] || [];
        if(list.length === 0) return showToast("Tidak ada data hari ini", "error");
        
        msg = `*LAPORAN RESERVASI - ${tanggalDipilih}*\n\n`;
        list.sort((a,b) => a.jam.localeCompare(b.jam)).forEach((r, i) => {
            msg += `${i+1}. *${r.nama}* (${r.jam}) - ${r.jumlah} pax @ ${r.tempat}\n`;
        });
        msg += `\nTotal: ${list.length} Reservasi`;
    }
    
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

// Export Data ke String (Base64) untuk Backup
function showExportDataPopup() {
    if(Object.keys(dataReservasi).length === 0) return showToast("Belum ada data reservasi yg dimuat.", "error");
    
    // Buat payload sederhana
    const payload = {
        meta: { date: new Date().toISOString(), type: 'backup' },
        data: dataReservasi
    };
    
    const str = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    document.getElementById('export-data-output').value = str;
    document.getElementById('exportDataPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function copyExportCode() {
    const el = document.getElementById('export-data-output');
    el.select();
    document.execCommand('copy');
    showToast("Kode berhasil disalin!");
}

// Print View
function printData() {
    if(!tanggalDipilih) return showToast("Pilih tanggal dulu di kalender", "error");
    document.getElementById('printOptionsPopup').style.display = 'block'; 
    overlay.style.display = 'block';
}

function executePrint() {
    const list = dataReservasi[tanggalDipilih] || [];
    if(list.length === 0) return showToast("Data kosong", "error");
    
    // Opsi Cetak
    const showMenu = document.getElementById('print-detail-menu').checked;
    const showNote = document.getElementById('print-tambahan').checked;
    
    let htmlRows = list.sort((a,b)=>a.jam.localeCompare(b.jam)).map((r, i) => {
        let menuStr = '-';
        if(showMenu) {
            if(r.menus && r.menus.length > 0) menuStr = r.menus.map(m=>`${m.quantity}x ${m.name}`).join(', ');
            else if(r.menu) menuStr = r.menu;
        }
        
        return `
        <tr style="border-bottom:1px solid #ddd;">
            <td style="padding:8px;">${i+1}</td>
            <td style="padding:8px;">${r.jam}</td>
            <td style="padding:8px;"><b>${r.nama}</b><br><small>${r.nomorHp || '-'}</small></td>
            <td style="padding:8px;">${r.jumlah}</td>
            <td style="padding:8px;">${r.tempat}</td>
            ${showMenu ? `<td style="padding:8px; font-size:0.9em;">${menuStr}</td>` : ''}
            ${showNote ? `<td style="padding:8px; font-size:0.9em;">${r.tambahan || '-'}</td>` : ''}
        </tr>`;
    }).join('');

    // Buka Jendela Baru
    const win = window.open('', '', 'width=900,height=600');
    win.document.write(`
        <html>
        <head>
            <title>Cetak - ${tanggalDipilih}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #eee; text-align: left; padding: 10px; border-bottom: 2px solid #ccc; }
                h2 { margin-bottom: 5px; color: #2a9d8f; }
            </style>
        </head>
        <body>
            <h2>Dolan Sawah - Laporan Reservasi</h2>
            <p>Tanggal: ${tanggalDipilih}</p>
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Jam</th><th>Nama</th><th>Jml</th><th>Tempat</th>
                        ${showMenu ? '<th>Menu</th>' : ''}
                        ${showNote ? '<th>Catatan</th>' : ''}
                    </tr>
                </thead>
                <tbody>${htmlRows}</tbody>
            </table>
            <script>window.print();</script>
        </body>
        </html>
    `);
    win.document.close();
    closePopup('printOptionsPopup');
}


/**
 * 26. ANALISIS GRAFIK (CHART.JS) & NOTIFIKASI
 */
let chartInstance = null;

async function runUIAnalysis() {
    // Populate Dropdown Tahun jika kosong
    const sel = document.getElementById('anl-year-ui');
    if(sel && sel.options.length === 0) {
        const y = new Date().getFullYear();
        sel.innerHTML = `<option value="${y}">${y}</option><option value="${y-1}">${y-1}</option>`;
    }
    
    const chartCanvas = document.getElementById('mainChart');
    if(!chartCanvas) return;

    // Fetch All Data (Hanya sekali load untuk performa)
    if(!allReservationsCache) {
        showLoader();
        try {
            const snap = await db.collection('reservations').get();
            allReservationsCache = snap.docs.map(d => d.data());
        } catch(e) { console.error(e); hideLoader(); return; }
        hideLoader();
    }
    
    // Filter Data by Year
    const year = parseInt(sel ? sel.value : new Date().getFullYear());
    const monthlyCounts = Array(12).fill(0);
    
    allReservationsCache.forEach(r => {
        // Asumsi format YYYY-MM-DD
        if(r.date) {
            const d = new Date(r.date);
            if(d.getFullYear() === year) {
                monthlyCounts[d.getMonth()]++;
            }
        }
    });
    
    // Render Chart
    const ctx = chartCanvas.getContext('2d');
    if(chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line', // Ganti ke Line agar terlihat tren
        data: {
            labels: monthNames,
            datasets: [{
                label: `Total Reservasi ${year}`,
                data: monthlyCounts,
                backgroundColor: 'rgba(42, 157, 143, 0.2)',
                borderColor: '#2a9d8f',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
    
    // Update Quick Insights (Teks di bawah chart)
    const total = monthlyCounts.reduce((a,b)=>a+b,0);
    const avg = (total/12).toFixed(1);
    const max = Math.max(...monthlyCounts);
    
    const insightDiv = document.getElementById('quick-insights');
    if(insightDiv) {
        insightDiv.innerHTML = `
            <div class="stat-card" style="padding:15px; text-align:center; min-width:120px;">
                <div style="font-size:0.8rem; color:#888;">Total Tahun Ini</div>
                <div style="font-size:1.5rem; font-weight:bold; color:var(--primary);">${total}</div>
            </div>
            <div class="stat-card" style="padding:15px; text-align:center; min-width:120px;">
                <div style="font-size:0.8rem; color:#888;">Rata-rata/Bulan</div>
                <div style="font-size:1.5rem; font-weight:bold; color:var(--info);">${avg}</div>
            </div>
            <div class="stat-card" style="padding:15px; text-align:center; min-width:120px;">
                <div style="font-size:0.8rem; color:#888;">Bulan Tertinggi</div>
                <div style="font-size:1.5rem; font-weight:bold; color:var(--accent);">${max}</div>
            </div>
        `;
    }
}

// Full Analysis Popup (Detail) - Menjaga fitur lama
function showAnalysis() {
    const popup = document.getElementById('analysisPopup');
    popup.innerHTML = `
        <h3>Analisis Detail</h3>
        <p>Fitur analisis mendalam (Top Menu, Top Customer) akan ditampilkan di sini.</p>
        <button class="btn-primary" onclick="runUIAnalysis(); closePopup('analysisPopup');">Lihat Grafik Utama</button>
        <div class="popup-actions">
            <button class="btn-danger" onclick="closePopup('analysisPopup')">Tutup</button>
        </div>
    `;
    popup.style.display = 'block'; overlay.style.display = 'block';
}


/**
 * 27. SISTEM NOTIFIKASI "SAY THANKS"
 * Mengecek reservasi yg sudah lewat jam-nya tapi belum disapa.
 */
function setupReliableNotificationChecker() {
    if (notificationInterval) clearInterval(notificationInterval);
    runNotificationCheck(); // Cek langsung saat load
    notificationInterval = setInterval(runNotificationCheck, 300000); // Cek tiap 5 menit
}

async function runNotificationCheck() {
    const now = new Date();
    // Hanya cek jika dataReservasi sudah ada isinya (sudah diload)
    if(Object.keys(dataReservasi).length === 0) return;

    // Cek data hari ini & kemarin (simple check)
    // Utk implementasi full database query, gunakan logic 'checkThankYouNotifications' di Web 1
    // Di sini kita cek data yang sudah di-load di memori (Current Month)
    
    let pendingCount = 0;
    const listHtml = [];

    // Iterasi dataReservasi yang ada di memori
    for(const dateKey in dataReservasi) {
        dataReservasi[dateKey].forEach(r => {
            if(!r.thankYouSent && r.nomorHp) {
                // Cek waktu
                const resDateTime = new Date(`${currentYear}-${dateKey}T${r.jam}`);
                // Jika waktu reservasi sudah lewat 2 jam yang lalu
                if(now > new Date(resDateTime.getTime() + (2*60*60*1000))) {
                    pendingCount++;
                    listHtml.push(`
                        <li class="notification-item">
                            <b>${escapeHtml(r.nama)}</b> (${dateKey})<br>
                            <button class="btn-sm btn-whatsapp" onclick="sendThankYouMessage('${r.id}', '${escapeHtml(r.nama)}', '${r.nomorHp}')">Kirim Ucapan</button>
                        </li>
                    `);
                }
            }
        });
    }

    const badge = document.getElementById('notification-badge');
    const ul = document.getElementById('notification-list-ul');
    
    if(badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'flex' : 'none';
    }
    
    if(ul) {
        ul.innerHTML = listHtml.length > 0 ? listHtml.join('') : '<li style="padding:10px; color:#999; text-align:center;">Tidak ada notifikasi baru.</li>';
    }
}

function sendThankYouMessage(id, nm, hp) {
    const msg = `Halo Kak *${nm}* 👋,\n\nTerima kasih banyak sudah berkunjung ke *Dolan Sawah* hari ini. 🙏\nSemoga hidangan dan pelayanannya memuaskan ya.\n\nJika berkenan, kami sangat menghargai masukan atau review Kakak agar kami bisa terus berkembang. Ditunggu kedatangannya kembali! ✨`;
    
    window.open(`https://wa.me/${cleanPhoneNumber(hp)}?text=${encodeURIComponent(msg)}`, '_blank');
    
    // Update status di DB
    db.collection('reservations').doc(id).update({ thankYouSent: true });
    
    // Update UI lokal (disable tombol)
    const btn = document.getElementById(`thank-btn-${id}`);
    if(btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-check"></i> Sent';
        btn.classList.remove('btn-info');
        btn.classList.add('btn-success');
    }
}

// Utilities Akhir
function forceSync() {
    showLoader();
    setTimeout(() => location.reload(), 500);
}

function toggleNotificationDropdown(e) {
    e.stopPropagation();
    const d = document.getElementById('notification-dropdown');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}

// Tutup dropdown notifikasi jika klik di luar
window.addEventListener('click', () => {
    const d = document.getElementById('notification-dropdown');
    if(d) d.style.display = 'none';
});

console.log("App.js Bagian 5 dimuat. Aplikasi Siap.");

