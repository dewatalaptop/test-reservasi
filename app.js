// =========================================
// 1. KONFIGURASI FIREBASE & INISIALISASI
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
// 2. VARIABEL GLOBAL (STATE MANAGEMENT)
// =========================================
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Variabel Data Utama
let dataReservasi = {};
let detailMenu = {};
let menuPrices = {}; // <--- Variabel Baru untuk Harga
let locationsData = {};

// Variabel Kalender & Navigasi
let tanggalDipilih = '';
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let unsubscribeReservations = null;
let allReservationsCache = null; // Cache untuk analisis data berat

// Variabel Logika Fitur
let lastAnalysisPeriod = 'month';
let hasAutoOpened = false; // Mencegah auto-open berulang
let notificationInterval = null;
let lastNotificationCheck = 0;

// Variabel Broadcast
let promoMessageCache = null;
let allCustomersCache = [];
const BROADCAST_MESSAGE_KEY = 'dolanSawahBroadcastMessage';

// =========================================
// 3. REFERENSI ELEMEN DOM
// =========================================
const mainContainer = document.getElementById('main-container');
const loginContainer = document.getElementById('login-container');
const logoutButton = document.getElementById('logout-button');
const monthYearEl = document.getElementById('monthYear');
const calendarEl = document.getElementById('calendar');
const overlay = document.getElementById('overlay');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

// =========================================
// 4. OTENTIKASI & LOGIN ADMIN
// =========================================
auth.onAuthStateChanged(user => {
    if (user) {
        // User Login
        loginContainer.style.display = 'none'; 
        mainContainer.style.display = 'block';
        logoutButton.style.display = 'inline-flex'; 
        initializeApp(); // Mulai aplikasi
    } else {
        // User Logout
        loginContainer.style.display = 'block'; 
        mainContainer.style.display = 'none';
        logoutButton.style.display = 'none';
        if (notificationInterval) clearInterval(notificationInterval);
    }
});

async function handleLogin() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('login-error');
  
  if (!email || !password) { 
      errorEl.textContent = 'Email dan password wajib diisi'; 
      errorEl.style.display = 'block'; 
      return; 
  }
  
  showLoader();
  try { 
      await auth.signInWithEmailAndPassword(email, password); 
      // Sukses akan ditangani oleh onAuthStateChanged
  } catch (err) { 
      errorEl.textContent = 'Email atau password salah'; 
      errorEl.style.display = 'block'; 
  } finally { 
      hideLoader(); 
  }
}

function handleLogout() { 
    if (confirm("Yakin ingin logout?")) {
        auth.signOut(); 
    }
}

// =========================================
// 5. INISIALISASI APLIKASI & LOAD DATA
// =========================================
async function initializeApp() { 
  showLoader();
  try {
    // Cek URL Parameter (Fitur Deep Linking)
    const urlParams = new URLSearchParams(window.location.search);
    const paramDate = urlParams.get('date');

    if (paramDate) {
        const d = new Date(paramDate);
        if (!isNaN(d.getTime())) {
            currentMonth = d.getMonth();
            currentYear = d.getFullYear();
        }
    }

    // Load Data Master (Parallel agar cepat)
    await Promise.all([
        loadMenus(),     // Menu & Harga
        loadLocations()  // Data Tempat
    ]);

    // Setup Listener Realtime
    loadReservationsForCurrentMonth(); 
    setupReliableNotificationChecker();

  } catch (e) {
    console.error("Gagal melakukan inisialisasi:", e);
    showToast("Gagal memulai aplikasi", "error");
    hideLoader();
  }
}

// --- LOAD MENU & HARGA (BAGIAN PENTING) ---
async function loadMenus() {
  try {
    const snapshot = await db.collection('menus').get();
    
    detailMenu = {};
    menuPrices = {}; // Reset variabel harga

    snapshot.forEach(doc => {
        const data = doc.data();
        detailMenu[doc.id] = data.details || []; 
        // Ambil harga, default 0 jika tidak ada
        menuPrices[doc.id] = data.price || 0; 
    });
    console.log("Menu & Harga berhasil dimuat. Total:", Object.keys(detailMenu).length);
  } catch (e) { 
    console.error("Error Lengkap Menu:", e); 
    showToast("Gagal memuat menu: " + e.message, "error"); 
  }
}

async function loadLocations() {
    try {
        const snapshot = await db.collection('locations').get();
        locationsData = {};
        snapshot.forEach(doc => {
            locationsData[doc.id] = doc.data();
        });
    } catch (e) { 
        console.error("Error Lengkap Lokasi:", e);
        showToast("Gagal memuat lokasi: " + e.message, "error"); 
    }
}

function loadReservationsForCurrentMonth() {
  // Hapus listener lama jika ada (untuk mencegah memory leak saat ganti bulan)
  if (unsubscribeReservations) unsubscribeReservations();
  
  const monthStr = String(currentMonth + 1).padStart(2, '0');
  const startDate = `${currentYear}-${monthStr}-01`;
  const endDate = `${currentYear}-${monthStr}-${new Date(currentYear, currentMonth + 1, 0).getDate()}`;
  
  console.log(`Memuat reservasi dari ${startDate} sampai ${endDate}`);

  unsubscribeReservations = db.collection('reservations')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .onSnapshot( snapshot => {
        dataReservasi = {};
        snapshot.forEach(doc => {
          const r = { id: doc.id, ...doc.data() };
          // Format Key: "MM-DD" untuk memudahkan grouping
          const dateKey = r.date.substring(5);
          
          if (!dataReservasi[dateKey]) {
              dataReservasi[dateKey] = [];
          }
          dataReservasi[dateKey].push(r);
        });
        
        // Render ulang kalender dengan data baru
        buatKalender();

        // --- LOGIKA AUTO OPEN (Deep Link) ---
        handleAutoOpen();

        // Jika sedang membuka tanggal tertentu, update list-nya realtime
        if (tanggalDipilih && !hasAutoOpened) {
            const reservations = dataReservasi[tanggalDipilih] || [];
            updateReservationList(reservations);
        }
        hideLoader();
      }, 
      err => { 
          console.error("Error Snapshot Reservasi:", err);
          showToast("Gagal memuat data reservasi", "error"); 
          hideLoader(); 
      }
    );
}

function handleAutoOpen() {
    const urlParams = new URLSearchParams(window.location.search);
    const autoOpen = urlParams.get('autoOpen');
    const paramDate = urlParams.get('date');
    const paramSearch = urlParams.get('search');

    // Jalankan hanya jika parameter lengkap dan belum pernah dibuka
    if (autoOpen && paramDate && paramSearch && !hasAutoOpened) {
        const d = new Date(paramDate);
        
        // Pastikan kita di bulan yang tepat
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            
            const checkDateKey = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const dailyData = dataReservasi[checkDateKey] || [];

            // Cari apakah data yang dimaksud sudah masuk di snapshot ini
            const dataFound = dailyData.some(r => r.nama.toLowerCase().includes(paramSearch.toLowerCase()));

            if (dataFound) {
                const day = d.getDate();
                pilihTanggal(day); // Buka view detail
                
                const searchInput = document.getElementById('detailSearchInput');
                if (searchInput) {
                    searchInput.value = paramSearch;
                    filterReservations(paramSearch); 
                    showToast(`Data baru ditemukan: ${paramSearch}`, "success");
                }
                
                hasAutoOpened = true; // Tandai sudah dibuka
                // Bersihkan URL agar bersih
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }
}
// =========================================
// 6. UI HELPERS & UTILITIES
// =========================================
function showLoader() { loadingOverlay.style.display = 'flex'; }
function hideLoader() { loadingOverlay.style.display = 'none'; }

function showToast(message, type = 'success') {
  toast.textContent = message; 
  toast.className = `toast ${type}`; 
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function formatRupiah(amount) { 
    return (amount || 0).toLocaleString('id-ID'); 
}

function cleanPhoneNumber(phone) { 
    return phone.replace(/[^0-9]/g, ''); 
}

function isValidPhone(phone) { 
    return /^[0-9]{10,13}$/.test(cleanPhoneNumber(phone)); 
}

function closePopup(popupId) {
    document.getElementById(popupId).style.display = 'none';
    overlay.style.display = 'none';
}

// =========================================
// 7. LOGIKA KALENDER
// =========================================
function buatKalender() {
  calendarEl.innerHTML = ''; 
  monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  // Filler untuk hari kosong di awal bulan
  for (let i = 0; i < firstDay; i++) { 
      calendarEl.insertAdjacentHTML('beforeend', `<div></div>`); 
  }
  
  // Render Tanggal
  for (let i = 1; i <= daysInMonth; i++) {
    const dateKey = `${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    // Cek status hari
    const isToday = new Date().toDateString() === new Date(currentYear, currentMonth, i).toDateString() ? 'today' : '';
    const isSelected = dateKey === tanggalDipilih ? 'selected' : '';
    
    // Cek jumlah reservasi
    const hasRes = dataReservasi[dateKey] && dataReservasi[dateKey].length > 0;
    const countHTML = hasRes ? `<div class="reservation-count">${dataReservasi[dateKey].length}</div>` : '';
    
    calendarEl.insertAdjacentHTML('beforeend', `
      <div class="calendar-day ${isToday} ${isSelected}" onclick="pilihTanggal(${i})">
        <div class="day-number">${i}</div>
        ${countHTML}
      </div>`);
  }
}

function pilihTanggal(day) {
  // Format: "MM-DD" (sesuai key di dataReservasi)
  tanggalDipilih = `${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  buatKalender(); // Refresh highlight tanggal
  
  const reservations = dataReservasi[tanggalDipilih] || [];
  const viewContainer = document.getElementById('reservation-view-container');
  
  // Update Judul View Detail
  document.getElementById('reservation-view-title').innerHTML = 
      `<i class="far fa-calendar-check"></i> Reservasi ${day} ${monthNames[currentMonth]} ${currentYear}`;
  
  // Reset Search & Tampilkan Data
  document.getElementById('detailSearchInput').value = ''; 
  updateReservationList(reservations); 
  
  // Ganti Tampilan
  mainContainer.style.display = 'none';
  viewContainer.style.display = 'block';
  window.scrollTo(0, 0);
  
  if (reservations.length === 0) {
      showToast("Belum ada reservasi, silakan tambah baru.", "info");
  }
}

function kembaliKeKalender() {
  document.getElementById('reservation-view-container').style.display = 'none';
  mainContainer.style.display = 'block';
  tanggalDipilih = ''; // Reset tanggal
  buatKalender(); // Hapus highlight selected
}

// Navigasi Bulan
function navigateMonth(direction) {
    currentMonth += direction;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    kembaliKeKalender(); 
    loadReservationsForCurrentMonth();
}
const previousMonth = () => navigateMonth(-1);
const nextMonth = () => navigateMonth(1);

function goToToday() {
    currentMonth = new Date().getMonth(); 
    currentYear = new Date().getFullYear();
    kembaliKeKalender(); 
    loadReservationsForCurrentMonth(); 
    showToast("Kembali ke bulan ini");
}

// =========================================
// 8. LOGIKA LIST RESERVASI (VIEW DETAIL)
// =========================================
function updateReservationList(reservations) {
    const container = document.getElementById('reservation-detail-list');
    
    if (!reservations || reservations.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px 0; grid-column: 1 / -1;">Tidak ada reservasi untuk ditampilkan.</p>`; 
        return;
    }
    
    container.innerHTML = reservations.map(r => {
        // Logika Menampilkan Menu (Kompatibel dengan data lama & baru)
        let menuItemsHtml = "-";
        let menuTitle = "Pesanan Menu";

        if (Array.isArray(r.menus) && r.menus.length > 0) {
            // Data Format Baru (Array)
            menuItemsHtml = r.menus.map(item => {
                const details = detailMenu[item.name] || ['(Detail tidak ditemukan)'];
                const detailString = details.map(d => `&nbsp;&nbsp;&nbsp;&nbsp;&bull; ${d}`).join('<br/>');
                return `<strong>${item.quantity}x ${item.name}</strong><br/>${detailString}`;
            }).join('<br/><br/>');
        } else if (r.menu) { 
            // Data Format Lama (String tunggal)
            menuTitle = r.menu;
            menuItemsHtml = (detailMenu[r.menu] || []).map(item => `&bull; ${item}`).join('<br/>') || "-";
        }

        // Info DP & Phone
        const dpInfo = r.dp > 0 ? `<div><i class="fas fa-money-bill-wave"></i> DP: Rp${formatRupiah(r.dp)} ${r.tipeDp ? `(${r.tipeDp})` : ''}</div>` : '';
        const phoneInfo = r.nomorHp ? `<div><i class="fas fa-phone"></i> ${r.nomorHp}</div>` : '';

        // Tombol "Terima Kasih"
        let thankYouButtonHtml = '';
        if (r.nomorHp) {
            if (r.thankYouSent) {
                thankYouButtonHtml = `<button style="background-color: var(--success);" disabled><i class="fas fa-check-circle"></i> Terima Kasih Terkirim</button>`;
            } else {
                thankYouButtonHtml = `<button class="accent" id="thank-you-btn-${r.id}" onclick="sendThankYouMessage('${r.id}', '${r.nama}', '${r.nomorHp}')"><i class="fas fa-gift"></i> Ucapkan Terima Kasih</button>`;
            }
        }

        // Render Card HTML
        return `
        <div class="reservation-item" style="display: flex; flex-direction: column; justify-content: space-between; margin-bottom: 0;">
            <div class="reservation-details">
                <b><i class="fas fa-user"></i> ${r.nama || 'Nama tidak ada'}</b><br/>
                <span><i class="fas fa-map-marker-alt"></i> ${r.tempat || '?'} • <i class="far fa-clock"></i> ${r.jam  || '?'} • <i class="fas fa-users"></i> ${r.jumlah  || '?'} org</span>
                ${dpInfo} ${phoneInfo}
                <div class="menu-detail">
                    <b><i class="fas fa-utensils"></i> ${menuTitle}:</b><br/>${menuItemsHtml}
                </div>
                <div><i class="fas fa-comment"></i> <b>Tambahan:</b> ${r.tambahan || '-'}</div>
            </div>
            <div class="data-actions">
                ${r.nomorHp ? `<button class="whatsapp" onclick="contactViaWhatsApp('${r.id}')"><i class="fab fa-whatsapp"></i> Hubungi</button>` : ''}
                ${thankYouButtonHtml} 
                <button onclick="editReservasi('${r.id}')"><i class="fas fa-edit"></i> Edit</button>
                <button class="danger" onclick="hapusReservasi('${r.id}')"><i class="fas fa-trash-alt"></i> Hapus</button>
            </div>
        </div>`;
    }).join('');
}

// Filter & Sort Logic
function filterReservations(query) {
  if (!tanggalDipilih) return;
  const q = query.toLowerCase();
  
  const filtered = (dataReservasi[tanggalDipilih] || []).filter(r => 
    (r.nama && r.nama.toLowerCase().includes(q)) || 
    (r.tempat && r.tempat.toLowerCase().includes(q)) ||
    (r.menus && r.menus.some(m => m.name && m.name.toLowerCase().includes(q))) ||
    (r.menu && r.menu.toLowerCase().includes(q))
  );
  updateReservationList(filtered);
}

function toggleDetailSort(event) {
    event.stopPropagation();
    const sortOptions = document.getElementById('sortOptionsDetail');
    sortOptions.style.display = (sortOptions.style.display === 'block') ? 'none' : 'block';
}

// Tutup dropdown sort saat klik di luar
window.addEventListener('click', function(e) {
    document.querySelectorAll('.sort-options-container').forEach(container => {
        if (!container.contains(e.target)) {
            container.querySelector('.sort-options').style.display = 'none';
        }
    });
});

function sortReservations(sortBy) {
    if (!tanggalDipilih || !dataReservasi[tanggalDipilih]) return;

    const reservationsToSort = [...dataReservasi[tanggalDipilih]]; 
    const sorted = reservationsToSort.sort((a, b) => {
        const valA = a[sortBy] || '';
        const valB = b[sortBy] || '';
        return valA.localeCompare(valB);
    });
    
    updateReservationList(sorted);
    document.querySelectorAll('.sort-options').forEach(el => el.style.display = 'none');
    showToast(`Reservasi diurutkan berdasarkan ${sortBy}`);
}

// =========================================
// 9. CRUD RESERVASI (TAMBAH, EDIT, HAPUS)
// =========================================

function showAddForm() {
    const form = document.getElementById('reservation-form');
    form.reset();
    
    // Bersihkan pesan error
    document.querySelectorAll('#reservation-form .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#reservation-form .invalid').forEach(el => el.classList.remove('invalid'));

    // Populate Data
    populateLocationDropdown(document.querySelector('#reservation-form #tempat'));
    updateCapacityInfo('reservation-form');
    
    // Reset Menu Row (Multi-menu)
    const menuContainer = document.getElementById('selected-menus-container');
    menuContainer.innerHTML = '';
    addMenuSelectionRow('reservation-form');
    
    document.getElementById('addFormPopup').style.display = 'block';
    overlay.style.display = 'block';
}

function editReservasi(id) {
  const res = findReservationById(id); 
  if (!res) { showToast("Reservasi tidak ditemukan", "error"); return; }
  
  const formContainer = document.getElementById('editFormPopup');
  
  // Render Form Edit
  formContainer.innerHTML = `
    <form id="edit-reservation-form">
      <h3><i class="fas fa-edit"></i> Edit Reservasi</h3>
      <input type="hidden" id="editReservationId" value="${id}" />
      
      <label>Nama: <input type="text" id="nama" value="${res.nama || ''}" required />
        <span class="error-message" id="nama-error"></span></label>
      
      <label>Nomor HP: <input type="tel" id="nomorHp" value="${res.nomorHp || ''}" />
        <span class="error-message" id="nomorHp-error"></span></label>
      
      <label>Jam: <input type="time" id="jam" value="${res.jam || ''}" required />
        <span class="error-message" id="jam-error"></span></label>
      
      <label>Jumlah: <input type="number" id="jumlah" value="${res.jumlah || ''}" min="1" required />
        <span class="error-message" id="jumlah-error"></span></label>
      
      <label>DP: <input type="number" id="dp" value="${res.dp || 0}" min="0" /></label>
      
      <label>Tipe Pembayaran DP: <select id="tipeDp"></select></label>
      
      <label>Tempat: <select id="tempat" required onchange="updateCapacityInfo('edit-reservation-form')"></select>
        <span id="capacity-info"></span><span class="error-message" id="tempat-error"></span>
      </label>
      
      <label>Paket Menu Dipesan: <span class="error-message" id="menus-error"></span></label>
      <div id="selected-menus-container"></div>
      <button type="button" class="secondary" id="add-menu-btn" onclick="addMenuSelectionRow('edit-reservation-form')"><i class="fas fa-plus"></i> Tambah Paket</button>
      
      <label>Tambahan: <textarea id="tambahan">${res.tambahan || ''}</textarea></label>
      
      <div class="data-actions">
        <button type="button" onclick="simpanPerubahanReservasi()"><i class="fas fa-save"></i> Simpan</button>
        <button type="button" class="danger" onclick="closePopup('editFormPopup')">Batal</button>
      </div>
    </form>`;
  
  const editFormEl = document.getElementById('edit-reservation-form');
  
  // Populate Tipe DP
  const tipeDpSelect = editFormEl.querySelector('#tipeDp');
  tipeDpSelect.innerHTML = `<option value="">- Tanpa DP -</option><option>Cash</option><option>QRIS</option><option>Transfer BCA</option><option>Transfer Mandiri</option><option>Transfer BRI</option>`;
  tipeDpSelect.value = res.tipeDp || '';
  
  // Populate Tempat
  populateLocationDropdown(editFormEl.querySelector('#tempat'), res.tempat);
  updateCapacityInfo('edit-reservation-form');
  
  // Populate Menu (Legacy vs New)
  const menuContainer = editFormEl.querySelector('#selected-menus-container');
  menuContainer.innerHTML = '';
  if (Array.isArray(res.menus) && res.menus.length > 0) {
    res.menus.forEach(item => addMenuSelectionRow('edit-reservation-form', item.name, item.quantity));
  } else if (res.menu) {
    addMenuSelectionRow('edit-reservation-form', res.menu, 1);
  } else {
    addMenuSelectionRow('edit-reservation-form');
  }
  
  formContainer.style.display = 'block'; 
  overlay.style.display = 'block';
}

async function simpanReservasi() {
  const formData = await validateAndGetFormData('reservation-form');
  
  if (!formData || !tanggalDipilih) { 
      if(!tanggalDipilih) showToast("Tanggal belum dipilih!", "error"); 
      return; 
  };
  
  const data = { 
      ...formData, 
      date: `${currentYear}-${tanggalDipilih}`, 
      createdAt: firebase.firestore.FieldValue.serverTimestamp() 
  };
  
  showLoader();
  try {
    await db.collection('reservations').add(data);
    showToast("Reservasi berhasil disimpan!");
    closePopup('addFormPopup'); 
  } catch (e) { 
    console.error(e);
    showToast("Gagal menyimpan reservasi", "error"); 
  } finally { 
    hideLoader(); 
  }
}

async function simpanPerubahanReservasi() {
  const id = document.getElementById('editReservationId').value;
  const formData = await validateAndGetFormData('edit-reservation-form');
  
  if (!formData) return;
  
  showLoader();
  try {
    await db.collection('reservations').doc(id).update(formData);
    showToast("Perubahan berhasil disimpan");
    closePopup('editFormPopup');
  } catch (e) { 
    showToast("Gagal menyimpan perubahan", "error"); 
  } finally { 
    hideLoader(); 
  }
}

async function hapusReservasi(id) {
  if (!confirm("Yakin ingin menghapus reservasi ini?")) return;
  showLoader();
  try { 
      await db.collection('reservations').doc(id).delete(); 
      showToast("Reservasi berhasil dihapus"); 
  } catch (e) { 
      showToast("Gagal menghapus reservasi", "error"); 
  } finally { 
      hideLoader(); 
  }
}

// --- FORM VALIDATION ---
async function validateAndGetFormData(formId) {
    let isValid = true;
    const form = document.getElementById(formId);
    const elements = form.elements;
    const getErrorEl = (name) => document.querySelector(`#${formId} #${name}-error`);

    // Reset Errors
    form.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

    // 1. Validasi Nama
    if (!elements.nama.value.trim()) { 
        getErrorEl('nama').textContent = 'Nama wajib diisi'; 
        elements.nama.classList.add('invalid'); 
        isValid = false; 
    }
    
    // 2. Validasi HP
    if (elements.nomorHp.value && !isValidPhone(elements.nomorHp.value)) { 
        getErrorEl('nomorHp').textContent = 'Nomor HP harus 10-13 digit angka'; 
        elements.nomorHp.classList.add('invalid'); 
        isValid = false; 
    }
    
    // 3. Validasi Jam
    if (!elements.jam.value) { 
        getErrorEl('jam').textContent = 'Jam wajib diisi'; 
        elements.jam.classList.add('invalid'); 
        isValid = false; 
    }
    
    // 4. Validasi Jumlah & Kapasitas
    const jumlahPeserta = parseInt(elements.jumlah.value);
    if (isNaN(jumlahPeserta) || jumlahPeserta < 1) { 
        getErrorEl('jumlah').textContent = 'Jumlah minimal 1'; 
        elements.jumlah.classList.add('invalid'); 
        isValid = false; 
    }
    if (!elements.tempat.value) { 
        getErrorEl('tempat').textContent = 'Tempat wajib dipilih'; 
        elements.tempat.classList.add('invalid'); 
        isValid = false; 
    }
    
    const selectedLocationName = elements.tempat.value;
    const locationKey = Object.keys(locationsData).find(key => locationsData[key].name === selectedLocationName);
    if (locationKey && locationsData[locationKey]) {
        const capacity = locationsData[locationKey].capacity;
        if (jumlahPeserta > capacity) {
            getErrorEl('jumlah').textContent = `Jumlah melebihi kapasitas tempat (${capacity} org)`;
            elements.jumlah.classList.add('invalid');
            isValid = false;
        }
    }

    // 5. Validasi Menu
    const menus = [];
    const menuRows = form.querySelectorAll('.menu-selection-row');
    const selectedMenuNames = new Set();
    
    if (menuRows.length === 0) { 
        getErrorEl('menus').textContent = 'Minimal 1 paket menu dipilih.'; 
        isValid = false; 
    }
    
    menuRows.forEach(row => {
        const menuSelect = row.querySelector('select');
        const quantityInput = row.querySelector('input');
        const menuName = menuSelect.value;
        const quantity = parseInt(quantityInput.value);
        
        if (!menuName) { 
            getErrorEl('menus').textContent = 'Semua paket menu harus dipilih.'; 
            menuSelect.classList.add('invalid'); 
            isValid = false; 
        }
        if (isNaN(quantity) || quantity < 1) { 
            getErrorEl('menus').textContent = 'Jumlah menu minimal 1.'; 
            quantityInput.classList.add('invalid'); 
            isValid = false; 
        }
        // Cek Duplikat
        if (selectedMenuNames.has(menuName)) { 
            getErrorEl('menus').textContent = 'Tidak boleh ada paket menu yang sama.'; 
            menuSelect.classList.add('invalid'); 
            isValid = false; 
        }
        
        if(menuName) selectedMenuNames.add(menuName);
        if(menuName && quantity > 0) menus.push({ name: menuName, quantity: quantity });
    });
    
    if (!isValid) return null;

    return {
        nama: elements.nama.value.trim(), 
        nomorHp: cleanPhoneNumber(elements.nomorHp.value), 
        jam: elements.jam.value,
        jumlah: jumlahPeserta, 
        dp: parseInt(elements.dp.value) || 0, 
        tipeDp: elements.tipeDp.value,
        tempat: elements.tempat.value, 
        tambahan: elements.tambahan.value.trim(), 
        menus: menus
    };
}
// =========================================
// 10. UI HELPERS KHUSUS FORM (MENU & LOKASI)
// =========================================

function addMenuSelectionRow(formId, menuName = '', quantity = 1) {
  const container = document.querySelector(`#${formId} #selected-menus-container`);
  const newRow = document.createElement('div');
  newRow.className = 'menu-selection-row';
  
  // Generate Options
  const menuOptions = Object.keys(detailMenu).sort().map(name => {
      // Tampilkan harga di dropdown agar user tahu estimasi
      const price = menuPrices[name] ? ` (Rp${formatRupiah(menuPrices[name])})` : '';
      const selected = name === menuName ? 'selected' : '';
      return `<option value="${name}" ${selected}>${name}${price}</option>`;
  }).join('');
  
  newRow.innerHTML = `
    <select class="menu-select">
        <option value="">Pilih Menu...</option>
        ${menuOptions}
    </select>
    <input type="number" class="quantity-input" value="${quantity}" min="1" placeholder="Jml">
    <button type="button" class="remove-btn" onclick="this.parentElement.remove()">
        <i class="fas fa-trash-alt"></i>
    </button>`;
  
  container.appendChild(newRow);
}

function populateLocationDropdown(selectElement, selectedValue = '') {
    if (!selectElement) return;
    selectElement.innerHTML = '<option value="">Pilih Tempat...</option>';
    
    Object.values(locationsData)
        .sort((a,b) => a.name.localeCompare(b.name))
        .forEach(location => {
            const option = new Option(`${location.name} (Kapasitas: ${location.capacity})`, location.name);
            selectElement.add(option);
        });
        
    if (selectedValue) selectElement.value = selectedValue;
}

function updateCapacityInfo(formId) {
    const form = document.getElementById(formId);
    const selectElement = form.querySelector('#tempat');
    const infoElement = form.querySelector('#capacity-info');
    
    const selectedLocationName = selectElement.value;
    const locationKey = Object.keys(locationsData).find(key => locationsData[key].name === selectedLocationName);
    
    if (locationKey && locationsData[locationKey]) {
        infoElement.textContent = `Kapasitas maksimal: ${locationsData[locationKey].capacity} orang.`;
    } else { 
        infoElement.textContent = ''; 
    }
}

// =========================================
// 11. MANAJEMEN MENU & HARGA (FITUR BARU)
// =========================================

function showMenuManagement() {
  const popup = document.getElementById('menuManagementPopup');
  popup.innerHTML = `
    <h3><i class="fas fa-book-open"></i> Kelola Menu & Harga</h3>
    
    <div id="menu-list-container"></div>
    
    <div id="add-menu-form">
      <h4><i class="fas fa-plus-circle"></i> Tambah Menu Baru</h4>
      
      <label>Nama Menu: 
        <input type="text" id="newMenuName" placeholder="Contoh: Nasi Goreng">
      </label>
      
      <label>Harga (Rp): 
        <input type="number" id="newMenuPrice" placeholder="Contoh: 25000">
      </label>
      
      <label>Detail (pisahkan koma): 
        <textarea id="newMenuDetails" placeholder="Contoh: Pedas, Telur Dadar, Kerupuk"></textarea>
      </label>
      
      <button onclick="addNewMenu()">Tambah Menu</button>
    </div>
    
    <div class="data-actions">
        <button class="danger" onclick="closePopup('menuManagementPopup')">Tutup</button>
    </div>`;
  
  renderMenuList();
  popup.style.display = 'block'; 
  overlay.style.display = 'block';
}

function renderMenuList() {
  const container = document.getElementById('menu-list-container'); 
  if (!container) return;
  
  container.innerHTML = Object.keys(detailMenu).sort().map(name => {
      // Ambil harga, default 0 jika error
      const harga = menuPrices[name] ? parseInt(menuPrices[name]) : 0;
      
      return `
      <div class="menu-item">
        <span>
            <b>${name}</b><br/>
            <small style="color:var(--primary); font-weight:600;">Rp ${formatRupiah(harga)}</small>
        </span>
        <div class="menu-item-actions">
            <button onclick="openEditMenuPopup('${name}')"><i class="fas fa-edit"></i></button>
            <button class="danger" onclick="deleteMenu('${name}')"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>`;
  }).join('');
}

async function addNewMenu() {
  const name = document.getElementById('newMenuName').value.trim();
  const priceVal = document.getElementById('newMenuPrice').value;
  const detailsRaw = document.getElementById('newMenuDetails').value;
  const details = detailsRaw.split(',').map(s => s.trim()).filter(Boolean);
  
  // Validasi
  if (!name) { 
      showToast("Nama menu tidak boleh kosong", "error"); 
      return; 
  }
  
  const price = priceVal ? parseInt(priceVal) : 0; // Pastikan angka
  
  if (detailMenu[name]) { 
      showToast("Menu sudah ada", "error"); 
      return; 
  }
  
  showLoader();
  try {
    // Simpan details DAN price
    await db.collection('menus').doc(name).set({ 
        details: details, 
        price: price 
    });
    
    showToast(`Menu "${name}" berhasil ditambahkan`);
    
    // Refresh Data Global
    await loadMenus(); 
    
    // Reset Form
    renderMenuList();
    document.getElementById('newMenuName').value = ''; 
    document.getElementById('newMenuPrice').value = ''; 
    document.getElementById('newMenuDetails').value = '';
    
  } catch (e) { 
    console.error("Error saat addNewMenu:", e);
    showToast(`Gagal: ${e.message}`, "error");
  } finally { 
    hideLoader(); 
  }
}

function openEditMenuPopup(name) {
  const currentPrice = menuPrices[name] || 0;
  const currentDetails = detailMenu[name] ? detailMenu[name].join(', ') : '';

  document.getElementById('menuManagementPopup').innerHTML = `
    <h3><i class="fas fa-edit"></i> Edit Menu</h3>
    
    <label>Nama Menu: 
        <input type="text" id="editingMenuName" value="${name}">
    </label>
    
    <label>Harga (Rp): 
        <input type="number" id="editingMenuPrice" value="${currentPrice}">
    </label>
    
    <label>Detail (pisahkan koma): 
        <textarea id="editingMenuDetails">${currentDetails}</textarea>
    </label>
    
    <div class="data-actions">
        <button onclick="saveEditedMenu('${name}')"><i class="fas fa-save"></i> Simpan</button>
        <button class="danger" onclick="showMenuManagement()">Batal</button>
    </div>`;
}

async function saveEditedMenu(originalName) {
  const newName = document.getElementById('editingMenuName').value.trim();
  const newPriceVal = document.getElementById('editingMenuPrice').value;
  const newDetails = document.getElementById('editingMenuDetails').value.split(',').map(s => s.trim()).filter(Boolean);
  
  if (!newName) { 
      showToast("Nama menu tidak boleh kosong", "error"); 
      return; 
  }
  
  const newPrice = newPriceVal ? parseInt(newPriceVal) : 0;

  showLoader();
  try {
    // Jika nama berubah, hapus yang lama buat yang baru
    if (originalName !== newName) {
      if (detailMenu[newName]) { 
          showToast("Nama menu sudah digunakan", "error"); 
          hideLoader(); 
          return; 
      }
      await db.collection('menus').doc(originalName).delete();
    }
    
    // Simpan data baru
    await db.collection('menus').doc(newName).set({ 
        details: newDetails, 
        price: newPrice 
    });
    
    showToast(`Menu "${newName}" berhasil diperbarui`);
    await loadMenus(); 
    showMenuManagement();
    
  } catch(e) { 
      showToast("Gagal menyimpan perubahan menu", "error"); 
  } finally { 
      hideLoader(); 
  }
}

async function deleteMenu(name) {
  if (!confirm(`Yakin ingin menghapus menu "${name}"?`)) return;
  showLoader();
  try {
    await db.collection('menus').doc(name).delete();
    showToast(`Menu "${name}" berhasil dihapus`);
    await loadMenus(); 
    renderMenuList();
  } catch (e) { 
      showToast("Gagal menghapus menu", "error"); 
  } finally { 
      hideLoader(); 
  }
}

// =========================================
// 12. MANAJEMEN TEMPAT / LOKASI
// =========================================

function showLocationManagement() {
    const popup = document.getElementById('locationManagementPopup');
    popup.innerHTML = `
        <h3><i class="fas fa-map-marker-alt"></i> Kelola Tempat</h3>
        <div id="location-list-container"></div>
        
        <div id="add-location-form">
            <h4><i class="fas fa-plus-circle"></i> Tambah Tempat</h4>
            <label>Nama: <input type="text" id="newLocationName"></label>
            <label>Kapasitas (Orang): <input type="number" id="newLocationCapacity" min="1"></label>
            <button onclick="addNewLocation()">Tambah Tempat</button>
        </div>
        
        <div class="data-actions">
            <button class="danger" onclick="closePopup('locationManagementPopup')">Tutup</button>
        </div>`;
    renderLocationList();
    popup.style.display = 'block'; 
    overlay.style.display = 'block';
}

function renderLocationList() {
    const container = document.getElementById('location-list-container'); 
    if (!container) return;
    
    container.innerHTML = Object.keys(locationsData)
        .sort((a,b) => locationsData[a].name.localeCompare(locationsData[b].name))
        .map(docId => `
            <div class="menu-item">
                <span>${locationsData[docId].name}<br/>
                <small>Kapasitas: ${locationsData[docId].capacity} org</small></span>
                <div class="menu-item-actions">
                    <button onclick="openEditLocationPopup('${docId}')"><i class="fas fa-edit"></i></button>
                    <button class="danger" onclick="deleteLocation('${docId}')"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>`).join('');
}

async function addNewLocation() {
    const name = document.getElementById('newLocationName').value.trim();
    const capacity = parseInt(document.getElementById('newLocationCapacity').value);
    
    if (!name || isNaN(capacity) || capacity < 1) { 
        showToast("Nama dan kapasitas valid wajib diisi.", "error"); 
        return; 
    }

    // Generate ID aman
    const docId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-');

    if (Object.values(locationsData).some(loc => loc.name.toLowerCase() === name.toLowerCase())) {
         showToast("Tempat dengan nama tersebut sudah ada.", "error"); return;
    }
    
    showLoader();
    try {
        await db.collection('locations').doc(docId).set({ name, capacity });
        showToast(`Tempat "${name}" berhasil ditambahkan.`);
        await loadLocations(); 
        renderLocationList();
        
        // Reset input
        document.getElementById('newLocationName').value = ''; 
        document.getElementById('newLocationCapacity').value = '';
    } catch (e) { 
        console.error("Error saat addNewLocation:", e);
        showToast(`Gagal: ${e.message}`, "error");
    } finally { 
        hideLoader(); 
    }
}

async function deleteLocation(docId) {
    if (!confirm(`Yakin ingin menghapus tempat "${locationsData[docId].name}"?`)) return;
    showLoader();
    try {
        await db.collection('locations').doc(docId).delete();
        showToast(`Tempat berhasil dihapus.`);
        await loadLocations(); 
        renderLocationList();
    } catch (e) { showToast("Gagal menghapus tempat.", "error"); } finally { hideLoader(); }
}

function openEditLocationPopup(docId) {
    const location = locationsData[docId];
    document.getElementById('locationManagementPopup').innerHTML = `
        <h3><i class="fas fa-edit"></i> Edit Tempat</h3>
        <label>Nama Tempat: <input type="text" id="editingLocationName" value="${location.name}"></label>
        <label>Kapasitas: <input type="number" id="editingLocationCapacity" value="${location.capacity}" min="1"></label>
        <div class="data-actions">
            <button onclick="saveEditedLocation('${docId}')"><i class="fas fa-save"></i> Simpan</button>
            <button class="danger" onclick="showLocationManagement()">Batal</button>
        </div>`;
}

async function saveEditedLocation(originalDocId) {
    const newName = document.getElementById('editingLocationName').value.trim();
    const newCapacity = parseInt(document.getElementById('editingLocationCapacity').value);
    
    if (!newName || isNaN(newCapacity) || newCapacity < 1) { 
        showToast("Nama dan kapasitas valid wajib diisi.", "error"); 
        return; 
    }
    
    const originalName = locationsData[originalDocId].name;
    showLoader();
    try {
        if (originalName.toLowerCase() !== newName.toLowerCase()) {
            if (Object.values(locationsData).some(loc => loc.name.toLowerCase() === newName.toLowerCase())) {
                showToast("Nama tempat sudah digunakan.", "error"); hideLoader(); return;
            }
            const newDocId = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-');
            await db.collection('locations').doc(newDocId).set({ name: newName, capacity: newCapacity });
            await db.collection('locations').doc(originalDocId).delete();
        } else {
             await db.collection('locations').doc(originalDocId).update({ name: newName, capacity: newCapacity });
        }
        showToast(`Tempat "${newName}" berhasil diperbarui.`);
        await loadLocations(); 
        showLocationManagement();
    } catch(e) { 
        showToast("Gagal menyimpan perubahan.", "error"); 
    } finally { 
        hideLoader(); 
    }
}

// =========================================
// 13. CUSTOMER LIST & SHARING
// =========================================

async function showCustomerMenu() {
    showLoader();
    try {
        const snapshot = await db.collection('reservations').orderBy('createdAt', 'desc').limit(500).get();
        const customers = new Map();
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.nomorHp && !customers.has(data.nomorHp)) {
                customers.set(data.nomorHp, data.nama);
            }
        });

        const popup = document.getElementById('customerListPopup');
        const sortedCustomers = [...customers.entries()].sort((a, b) => a[1].localeCompare(b[1]));

        let contentHTML = `<h3><i class="fas fa-address-book"></i> Daftar Customer (${sortedCustomers.length})</h3>`;
        if (sortedCustomers.length > 0) {
            contentHTML += `<div class="search-container" style="margin-bottom: 15px;"><i class="fas fa-search"></i><input type="text" id="customerSearchInput" placeholder="Cari nama atau nomor HP..." oninput="filterCustomers(this.value)"></div><div id="customer-list"></div>`;
        } else {
            contentHTML += `<p style="text-align:center; padding: 20px 0;">Belum ada data customer.</p>`;
        }
        contentHTML += `<div class="data-actions" style="margin-top:20px;"><button class="danger" onclick="closePopup('customerListPopup')">Tutup</button></div>`;
        
        popup.innerHTML = contentHTML;
        
        window.filterCustomers = (query) => {
            const q = query.toLowerCase();
            const filtered = sortedCustomers.filter(([phone, name]) => name.toLowerCase().includes(q) || phone.includes(q));
            renderCustomerList(filtered);
        };
        
        renderCustomerList(sortedCustomers);
        popup.style.display = 'block'; 
        overlay.style.display = 'block';
    } catch (e) { 
        showToast("Gagal memuat data customer", "error"); 
    } finally { 
        hideLoader(); 
    }
}

function renderCustomerList(customerData) {
    const container = document.getElementById('customer-list'); if (!container) return;
    
    container.innerHTML = customerData.length === 0 
        ? `<p style="text-align:center;">Tidak ada customer yang cocok.</p>`
        : customerData.map(([phone, name]) => `
            <div class="menu-item">
                <span><i class="fas fa-user"></i> ${name} <br/><small style="color:#777;">${phone}</small></span>
                <div class="menu-item-actions">
                    <button class="whatsapp" onclick="openWhatsApp('${phone}', '${name}')"><i class="fab fa-whatsapp"></i> Hubungi</button>
                </div>
            </div>`).join('');
}

function findReservationById(id) {
    for (const key in dataReservasi) {
        const found = dataReservasi[key].find(r => r.id === id);
        if (found) return found;
    } return null;
}

function openWhatsApp(phone, name, messageTemplate) {
    const formattedPhone = phone.replace(/^0/, '62');
    const message = messageTemplate || `Halo Kak *${name}*, kami dari Dolan Sawah ingin menyapa. Terima kasih telah menjadi pelanggan kami! 😊`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
}

function contactViaWhatsApp(id) {
    const res = findReservationById(id);
    if (!res || !res.nomorHp) { showToast("Nomor HP tidak tersedia", "error"); return; }
    
    let menuList = '  - _(Tidak ada detail menu)_';
    if (Array.isArray(res.menus) && res.menus.length > 0) {
        menuList = res.menus.map(item => {
            const details = detailMenu[item.name] || ['(Detail tidak ditemukan)'];
            const detailString = details.map(d => `    • ${d}`).join('\n');
            return `  - *${item.quantity}x ${item.name}*\n${detailString}`;
        }).join('\n');
    } else if (res.menu) {
        const details = detailMenu[res.menu] || [];
        const detailString = details.map(d => `    • ${d}`).join('\n');
        menuList = `  - *${res.menu}*\n${detailString}`;
    }
    
    const tambahanInfo = res.tambahan ? `📝 *Request Tambahan:*\n${res.tambahan}\n\n` : '';
    const dpInfo = res.dp > 0 ? `💰 *DP:* Rp ${formatRupiah(res.dp)} ${res.tipeDp ? `(via ${res.tipeDp})` : ''} (Sudah kami terima, terima kasih 🙏)\n\n` : '';
    
    const message = `Halo Kak *${res.nama}* 👋,\n\nKami dari *Dolan Sawah* ingin mengkonfirmasi reservasi Anda:\n\n🗓️ *Tanggal:* ${res.date}\n⏰ *Jam:* ${res.jam}\n📍 *Tempat:* ${res.tempat}\n👥 *Jumlah:* ${res.jumlah} orang\n\n🍽️ *Pesanan Menu:*\n${menuList}\n\n${tambahanInfo}${dpInfo}Mohon balas pesan ini untuk konfirmasi. Kami tunggu kedatangannya ya! 😊`;
    
    openWhatsApp(res.nomorHp, res.nama, message);
}

function sendThankYouMessage(id, name, phone) {
    const message = `Halo Kak *${name}* 👋,\n\nKami dari *Dolan Sawah* ingin mengucapkan terima kasih banyak atas kunjungannya. 🙏\n\nKami harap Kakak dan rombongan menikmati hidangan serta suasana di tempat kami. 🌾😊\n\nMasukan dan saran dari Kakak sangat berarti bagi kami untuk menjadi lebih baik lagi. Jika berkenan, silakan balas pesan ini dengan kesan-kesan Kakak.\n\nKami tunggu kedatangannya kembali ya! ✨\n\nSalam hangat,\n*Tim Dolan Sawah* ❤️`;
    openWhatsApp(phone, name, message);
    markAsThankYouSent(id);
    
    const button = document.getElementById(`thank-you-btn-${id}`);
    if (button) {
        button.innerHTML = `<i class="fas fa-check-circle"></i> Terima Kasih Terkirim`;
        button.style.backgroundColor = 'var(--success)';
        button.disabled = true;
    }
}

async function markAsThankYouSent(id) {
    try { await db.collection('reservations').doc(id).update({ thankYouSent: true }); } 
    catch (e) { console.error("Gagal update status thankYouSent: ", e); }
}

function shareViaWhatsApp(scope) {
    let message = '';
    if (scope === 'day' && tanggalDipilih) {
        const reservations = (dataReservasi[tanggalDipilih] || []).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
        message = `*📋 LAPORAN RESERVASI DOLAN SAWAH 📋*\n\n*Tanggal:* ${parseInt(tanggalDipilih.split('-')[1])} ${monthNames[currentMonth]} ${currentYear}\n=========================\n\n`;
        if (reservations.length === 0) {
        message += `_Tidak ada reservasi untuk tanggal ini._`;
        } else {
        reservations.forEach((r, i) => {
            let menuList = '  - _(Tidak ada detail menu)_';
            if (Array.isArray(r.menus) && r.menus.length > 0) {
            menuList = r.menus.map(item => {
                const details = detailMenu[item.name] || [];
                const detailString = details.map(d => `      • ${d}`).join('\n');
                return `  - *${item.quantity}x ${item.name}*\n${detailString}`;
            }).join('\n');
            } else if (r.menu) {
            const details = detailMenu[r.menu] || [];
            const detailString = details.map(d => `      • ${d}`).join('\n');
            menuList = `  - *${r.menu}*\n${detailString}`;
            }

            message += `*${i + 1}. ${r.nama || 'Nama tidak ada'}*\n`;
            message += `⏰ Jam: *${r.jam || '?'}* | 📍 Tempat: *${r.tempat || '?'}* | 👥 Jumlah: *${r.jumlah || '?'} org*\n`;
            message += `🍽️ *Pesanan Menu:*\n${menuList}\n`;
            if (r.dp > 0) message += `💰 DP: *Rp ${formatRupiah(r.dp)}* ${r.tipeDp ? `(${r.tipeDp})` : ''}\n`;
            if (r.tambahan) message += `📝 Tambahan: *${r.tambahan}*\n`;
            message += `-------------------------\n\n`;
        });
        }
    } else if (scope === 'month') {
        message = `*🗓️ REKAP RESERVASI BULANAN 🗓️*\n*Dolan Sawah - ${monthNames[currentMonth]} ${currentYear}*\n=========================\n\n`;
        const sortedDates = Object.keys(dataReservasi).sort((a, b) => a.localeCompare(b));
        let totalReservations = sortedDates.reduce((acc, key) => acc + dataReservasi[key].length, 0);
        if (totalReservations === 0) {
        message += `_Tidak ada reservasi untuk bulan ini._`;
        } else {
        sortedDates.forEach(dateKey => {
            const reservationsOnDate = dataReservasi[dateKey];
            if (reservationsOnDate.length > 0) {
            message += `*📆 Tanggal: ${parseInt(dateKey.split('-')[1])} ${monthNames[currentMonth]}* (${reservationsOnDate.length} reservasi)\n`;
            }
        });
        }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

function shareViaEmail() {
    if (!tanggalDipilih || !(dataReservasi[tanggalDipilih] || []).length) { 
        showToast("Pilih tanggal yang memiliki reservasi.", "error"); return; 
    }
    const reservations = (dataReservasi[tanggalDipilih] || []).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
    const day = parseInt(tanggalDipilih.split('-')[1]);
    const subject = `Laporan Reservasi Dolan Sawah - ${day} ${monthNames[currentMonth]} ${currentYear}`;
    let body = `<h2 style="color: #264653;">📋 Laporan Reservasi Dolan Sawah</h2><p><strong>Tanggal:</strong> ${day} ${monthNames[currentMonth]} ${currentYear}</p><hr><ol>`;

    reservations.forEach((r) => {
        let menuListHtml = '<ul><li>_(Tidak ada detail menu)_</li></ul>';
        if (Array.isArray(r.menus) && r.menus.length > 0) {
        menuListHtml = `<ul style="margin:0; padding-left: 20px;">${r.menus.map(item => {
            const details = detailMenu[item.name] || [];
            const detailListHtml = `<ul style="margin: 4px 0 8px 20px; padding: 0; list-style-type: circle; color: #555;">${details.map(d => `<li>${d}</li>`).join('')}</ul>`;
            return `<li><strong>${item.quantity}x ${item.name}</strong>${detailListHtml}</li>`;
        }).join('')}</ul>`;
        } else if (r.menu) {
        const details = detailMenu[r.menu] || [];
        const detailListHtml = `<ul style="margin: 4px 0 8px 20px; padding: 0; list-style-type: circle; color: #555;">${details.map(d => `<li>${d}</li>`).join('')}</ul>`;
        menuListHtml = `<p><strong>Menu: ${r.menu}</strong></p>${detailListHtml}`;
        }

        let dpHtml = r.dp > 0 ? `<p><strong>💰 DP:</strong> Rp${formatRupiah(r.dp)} ${r.tipeDp ? `(${r.tipeDp})` : ''}</p>` : '';
        let tambahanHtml = r.tambahan ? `<p><strong>📝 Catatan:</strong> ${r.tambahan}</p>` : '';
        body += `<li style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee;"><h3 style="color: #2a9d8f; margin-bottom: 10px;">${r.nama || 'Nama tidak ada'}</h3><p><strong>⏰ Jam:</strong> ${r.jam || '?'}</p><p><strong>📍 Tempat:</strong> ${r.tempat || '?'}</p><p><strong>👥 Jumlah:</strong> ${r.jumlah || '?'} orang</p><p><strong>🍽️ Pesanan Menu:</strong></p>${menuListHtml}${dpHtml}${tambahanHtml}</li>`;
    });
    body += `</ol>`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// =========================================
// 14. EXPORT & PRINT
// =========================================

function showExportDataPopup() {
    if (Object.keys(dataReservasi).length === 0) { 
        showToast("Tidak ada data reservasi untuk diekspor di bulan ini.", "error"); return; 
    }
    try {
        const simplifiedData = {};
        for (const dateKey in dataReservasi) {
            if (dataReservasi.hasOwnProperty(dateKey)) {
                // Export dengan format simple tapi lengkap
                simplifiedData[dateKey] = dataReservasi[dateKey].map(res => ({
                    nama: res.nama || 'Tanpa Nama', 
                    jumlah: res.jumlah || 0, 
                    jam: res.jam || '00:00',
                    tempat: res.tempat || 'Tanpa Lokasi', 
                    menus: res.menus || []
                }));
            }
        }
        
        const exportPayload = { 
            version: '5.4-export', 
            data: simplifiedData, 
            locations: locationsData 
        };
        
        const jsonString = JSON.stringify(exportPayload);
        const encodedData = btoa(unescape(encodeURIComponent(jsonString)));
        
        document.getElementById('export-data-output').value = encodedData;
        document.getElementById('exportDataPopup').style.display = 'block'; 
        overlay.style.display = 'block';
    } catch (e) { 
        console.error("Export error:", e); 
        showToast("Terjadi kesalahan saat membuat kode ekspor.", "error"); 
    }
}

function copyExportCode() {
    const textarea = document.getElementById('export-data-output');
    if (!textarea.value) { showToast("Tidak ada kode untuk disalin.", "error"); return; }
    
    textarea.select(); 
    textarea.setSelectionRange(0, 99999);
    
    navigator.clipboard.writeText(textarea.value)
        .then(() => { showToast("Kode berhasil disalin!"); })
        .catch(err => { showToast("Gagal menyalin kode.", "error"); });
}

function printData() {
  if (!tanggalDipilih) { showToast("Silakan pilih tanggal terlebih dahulu.", "error"); return; }
  document.getElementById('printOptionsPopup').style.display = 'block'; overlay.style.display = 'block';
}

function executePrint() {
    const reservations = (dataReservasi[tanggalDipilih] || []).sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
    const title = document.getElementById('reservation-view-title').innerHTML;
    const dateString = `${parseInt(tanggalDipilih.split('-')[1])} ${monthNames[currentMonth]} ${currentYear}`;
    
    const options = { 
        showMenu: document.getElementById('print-detail-menu').checked, 
        showKontak: document.getElementById('print-kontak').checked, 
        showDp: document.getElementById('print-dp').checked, 
        showTambahan: document.getElementById('print-tambahan').checked 
    };

    const itemsHtml = reservations.map((r, index) => {
        let menuList = '';
        if(options.showMenu) {
            if (Array.isArray(r.menus) && r.menus.length > 0) {
                menuList = r.menus.map(item => {
                    const details = detailMenu[item.name] || [];
                    const detailString = details.map(d => `&nbsp;&nbsp;&nbsp;&nbsp;&bull; ${d}`).join('<br>');
                    return `<strong>${item.quantity}x ${item.name}</strong><br>${detailString}`;
                }).join('<br><br>');
            } else if (r.menu) {
                const details = detailMenu[r.menu] || [];
                const detailString = details.map(d => `&nbsp;&nbsp;&nbsp;&nbsp;&bull; ${d}`).join('<br>');
                menuList = `<strong>${r.menu}</strong><br>${detailString}`;
            } else { menuList = `&bull; _(Tidak ada detail menu)_`; }
        }
        const dpInfo = options.showDp && r.dp > 0 ? `<p><i class="fas fa-money-bill-wave"></i> <strong>DP:</strong> Rp ${formatRupiah(r.dp)} ${r.tipeDp ? `(${r.tipeDp})` : ''}</p>` : '';
        const tambahanInfo = options.showTambahan && r.tambahan ? `<p><i class="fas fa-comment"></i> <strong>Tambahan:</strong> ${r.tambahan}</p>` : '';
        const kontakInfo = options.showKontak && r.nomorHp ? `<p><i class="fas fa-phone"></i> <strong>Kontak:</strong> ${r.nomorHp}</p>` : '';

        return `
        <div class="print-item">
            <h3><i class="fas fa-user-circle"></i> ${index + 1}. ${r.nama || 'Nama tidak ada'}</h3>
            <p><i class="far fa-clock"></i> <strong>Jam:</strong> ${r.jam || '?'}</p>
            <p><i class="fas fa-map-marker-alt"></i> <strong>Tempat:</strong> ${r.tempat || '?'}</p>
            <p><i class="fas fa-users"></i> <strong>Jumlah:</strong> ${r.jumlah || '?'} org</p>
            ${kontakInfo}
            ${options.showMenu ? `<p><i class="fas fa-utensils"></i> <strong>Pesanan:</strong></p><div class="menu-details-print">${menuList}</div>` : ''}
            ${dpInfo}
            ${tambahanInfo}
        </div>`;
    }).join('');

    const printPageHtml = `<!DOCTYPE html><html lang="id"><head><title>Cetak Reservasi - ${dateString}</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"><style>:root { --primary: #2a9d8f; --primary-dark: #264653; --secondary: #e9c46a; } body { font-family: 'Poppins', sans-serif; margin: 0; padding: 25px; -webkit-print-color-adjust: exact; } #print-title { font-size: 1.8rem; text-align: center; margin-bottom: 25px; } #print-list { column-count: 2; column-gap: 25px; } .print-item { break-inside: avoid; margin-bottom: 20px; padding: 15px; border: 1px solid #ccc; background-color: #fff; border-radius: 8px; } .print-item h3 { font-size: 1.2rem; color: var(--primary); margin: 0 0 10px 0; border-bottom: 2px solid var(--secondary); padding-bottom: 5px; } .print-item p { margin: 6px 0; } .print-item .menu-details-print { margin-top: 5px; color: #555; border-left: 2px solid #eee; padding-left: 15px; } @media print { body { padding: 10px; } #print-list { column-count: 2; } } @media (max-width: 768px) { #print-list { column-count: 1; } }</style></head><body><h2 id="print-title">${title}</h2>${reservations.length > 0 ? `<div id="print-list">${itemsHtml}</div>` : '<p style="text-align:center;">Tidak ada reservasi untuk tanggal ini.</p>'}</body></html>`;
    
    const printWindow = window.open('', '_blank'); 
    printWindow.document.open(); 
    printWindow.document.write(printPageHtml); 
    printWindow.document.close(); 
    closePopup('printOptionsPopup');
}

// =========================================
// 15. DATA ANALYSIS & INSIGHTS
// =========================================

let analysisChartInstance = null;

async function showAnalysis() {
    const popup = document.getElementById('analysisPopup');
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth(); 
    
    let yearOptions = '';
    for(let y = currentYear; y >= currentYear - 2; y--) { yearOptions += `<option value="${y}">${y}</option>`; }
    
    let monthOptions = `<option value="all">-- Satu Tahun Penuh --</option>`;
    monthNames.forEach((m, index) => {
        const selected = index === currentMonth ? 'selected' : '';
        monthOptions += `<option value="${index}" ${selected}>${m}</option>`;
    });

    popup.innerHTML = `
        <h3><i class="fas fa-chart-line"></i> Analisis & Wawasan Bisnis</h3>
        <div class="analysis-controls">
            <div style="flex:1">
                <label style="font-size:0.8rem; margin-bottom:2px;">Tahun</label>
                <select id="anl-year">${yearOptions}</select>
            </div>
            <div style="flex:2">
                <label style="font-size:0.8rem; margin-bottom:2px;">Bulan / Periode</label>
                <select id="anl-month">${monthOptions}</select>
            </div>
            <button onclick="runAdvancedAnalysis()" style="margin-top:20px; height: 42px;"><i class="fas fa-filter"></i> Terapkan</button>
        </div>
        
        <div id="analysis-loading" style="display:none; text-align:center; padding:20px;"><div class="spinner"></div></div>
        
        <div id="analysis-result" style="display:none;">
            <div class="stats-grid" id="anl-stats-grid"></div>
            <div class="chart-container"><canvas id="analysisChart"></canvas></div>
            <div class="insight-box" id="anl-insights"></div>
            <div id="anl-details"></div>
        </div>
        
        <div class="data-actions"><button class="danger" onclick="closePopup('analysisPopup')">Tutup</button></div>`;
    
    popup.style.display = 'block'; 
    overlay.style.display = 'block';

    if (!allReservationsCache) {
        try {
            const snapshot = await db.collection('reservations').get();
            allReservationsCache = snapshot.docs.map(doc => doc.data());
        } catch (e) { showToast("Gagal memuat data analisis.", "error"); return; }
    }
    runAdvancedAnalysis();
}

function runAdvancedAnalysis() {
    const year = parseInt(document.getElementById('anl-year').value);
    const monthVal = document.getElementById('anl-month').value;
    const resultContainer = document.getElementById('analysis-result');
    const loading = document.getElementById('analysis-loading');
    
    resultContainer.style.display = 'none'; 
    loading.style.display = 'block';

    setTimeout(() => {
        let filteredData = [];
        let labels = [];
        let chartData = [];
        let xLabel = '';

        if (monthVal === 'all') {
            const startDate = new Date(year, 0, 1);
            const endDate = new Date(year, 11, 31);
            filteredData = allReservationsCache.filter(r => { const d = new Date(r.date); return d >= startDate && d <= endDate; });
            
            xLabel = 'Bulan'; 
            labels = monthNames.map(m => m.substring(0, 3)); 
            chartData = new Array(12).fill(0);
            filteredData.forEach(r => { chartData[new Date(r.date).getMonth()]++; });
        } else {
            const mIndex = parseInt(monthVal);
            const startDate = new Date(year, mIndex, 1);
            const endDate = new Date(year, mIndex + 1, 0); 
            
            filteredData = allReservationsCache.filter(r => { const d = new Date(r.date); return d >= startDate && d <= endDate; });
            
            xLabel = 'Tanggal';
            const daysInMonth = endDate.getDate();
            labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
            chartData = new Array(daysInMonth).fill(0);
            filteredData.forEach(r => { chartData[new Date(r.date).getDate() - 1]++; });
        }

        const stats = analyzeData(filteredData);
        const totalPax = filteredData.reduce((sum, r) => sum + parseInt(r.jumlah||0), 0);
        const totalRevenueDP = filteredData.reduce((sum, r) => sum + parseInt(r.dp||0), 0);
        
        document.getElementById('anl-stats-grid').innerHTML = `
            <div class="mini-stat"><div class="val">${filteredData.length}</div><div class="lbl">Total Reservasi</div></div>
            <div class="mini-stat"><div class="val">${totalPax}</div><div class="lbl">Total Tamu</div></div>
            <div class="mini-stat"><div class="val">Rp ${formatK(totalRevenueDP)}</div><div class="lbl">Omzet DP Masuk</div></div>`;
        
        renderChart(labels, chartData, xLabel);
        generateAutomatedInsights(filteredData, stats, monthVal, year);
        renderAnalysisLists(stats);
        
        loading.style.display = 'none'; 
        resultContainer.style.display = 'block';
    }, 300);
}

function analyzeData(data) {
    const frequentCustomers = data.filter(r => r.nomorHp).reduce((acc, r) => { 
        if (!acc[r.nomorHp]) acc[r.nomorHp] = { name: r.nama, count: 0, nomorHp: r.nomorHp }; 
        acc[r.nomorHp].count++; 
        return acc; 
    }, {});
    
    const topSpenders = data.filter(r => r.nomorHp && r.dp > 0).reduce((acc, r) => { 
        if (!acc[r.nomorHp]) acc[r.nomorHp] = { name: r.nama, totalDp: 0, nomorHp: r.nomorHp }; 
        acc[r.nomorHp].totalDp += parseInt(r.dp); 
        return acc; 
    }, {});
    
    const popularMenus = data.reduce((acc, r) => { 
        if (Array.isArray(r.menus)) { 
            r.menus.forEach(item => { acc[item.name] = (acc[item.name] || 0) + item.quantity; }); 
        } else if (r.menu) { 
            acc[r.menu] = (acc[r.menu] || 0) + 1; 
        } 
        return acc; 
    }, {});
    
    const dayOfWeek = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const busiestDays = data.reduce((acc, r) => { 
        const d = new Date(r.date); 
        if(!isNaN(d.getTime())){ 
            const day = dayOfWeek[d.getDay()]; 
            acc[day] = (acc[day] || 0) + 1; 
        } 
        return acc; 
    }, {});
    
    return {
        frequentCustomers: Object.values(frequentCustomers).sort((a, b) => b.count - a.count).slice(0, 5),
        topSpenders: Object.values(topSpenders).sort((a, b) => b.totalDp - a.totalDp).slice(0, 5),
        popularMenus: Object.entries(popularMenus).sort((a, b) => b[1] - a[1]).slice(0, 5),
        busiestDays: Object.entries(busiestDays).sort((a, b) => b[1] - a[1])
    };
}

function formatK(num) {
    if(num >= 1000000) return (num/1000000).toFixed(1) + 'jt';
    if(num >= 1000) return (num/1000).toFixed(0) + 'rb';
    return num;
}

function renderChart(labels, data, labelName) {
    const ctx = document.getElementById('analysisChart').getContext('2d');
    if (analysisChartInstance) { analysisChartInstance.destroy(); }
    
    analysisChartInstance = new Chart(ctx, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'Jumlah Reservasi', 
                data: data, 
                borderColor: '#2a9d8f', 
                backgroundColor: 'rgba(42, 157, 143, 0.1)', 
                borderWidth: 2, 
                fill: true, 
                tension: 0.3 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, 
            plugins: { legend: { display: false }, title: { display: true, text: `Tren Reservasi per ${labelName}` } } 
        } 
    });
}

function generateAutomatedInsights(data, stats, monthVal, year) {
    const container = document.getElementById('anl-insights');
    if (data.length === 0) { container.innerHTML = `<h5><i class="fas fa-lightbulb"></i> Analisis Data Kosong</h5><p>Belum ada data.</p>`; return; }
    
    const busiestDayName = stats.busiestDays.length > 0 ? stats.busiestDays[0][0] : '-';
    const topMenu = stats.popularMenus.length > 0 ? stats.popularMenus[0][0] : '-';
    const avgPax = (data.reduce((sum, r) => sum + parseInt(r.jumlah||0), 0) / data.length).toFixed(1);
    
    let suggestions = [];
    suggestions.push(`Hari tersibuk: <strong>${busiestDayName}</strong>. Siapkan staf ekstra.`);
    suggestions.push(`Menu favorit: <strong>${topMenu}</strong>. Pastikan stok aman.`);
    if (avgPax > 5) suggestions.push(`Banyak grup besar (Avg: ${avgPax}). Buat paket keluarga.`); 
    else suggestions.push(`Banyak grup kecil (Avg: ${avgPax}). Buat paket couple.`);
    
    container.innerHTML = `<h5><i class="fas fa-robot"></i> Insight Singkat</h5><ul>${suggestions.map(s => `<li>${s}</li>`).join('')}</ul>`;
}

function renderAnalysisLists(results) {
    document.getElementById('anl-details').innerHTML = `
    <div class="analysis-section">
        <h4><i class="fas fa-crown"></i> Pelanggan Setia</h4>
        <ul class="analysis-list">${results.frequentCustomers.map(c => `<li class="analysis-item"><span class="name-clickable" onclick="showCustomerProfile('${c.nomorHp}', '${c.name}')">${c.name}</span><span class="value">${c.count}x</span></li>`).join('') || '<li>Belum ada data</li>'}</ul>
    </div>
    <div class="analysis-section">
        <h4><i class="fas fa-utensils"></i> Menu Laris</h4>
        <ul class="analysis-list">${results.popularMenus.map(([name, count]) => `<li class="analysis-item"><span class="name">${name}</span><span class="value">${count} porsi</span></li>`).join('') || '<li>Belum ada data</li>'}</ul>
    </div>`;
}

function showCustomerProfile(nomorHp, name) {
    const customerReservations = allReservationsCache.filter(r => r.nomorHp === nomorHp).sort((a,b) => b.date.localeCompare(a.date));
    const totalDp = customerReservations.reduce((sum, r) => sum + (r.dp || 0), 0);
    
    const historyHtml = customerReservations.map(r => `<div class="history-item"><strong>${r.date}</strong> - ${r.jumlah} org</div>`).join('');
    
    document.getElementById('analysis-result').innerHTML = `
    <div id="customer-profile-view">
        <button class="secondary" onclick="runAdvancedAnalysis()" style="margin-bottom:15px;"><i class="fas fa-arrow-left"></i> Kembali</button>
        <h4><i class="fas fa-user-circle"></i> ${name}</h4>
        <p>${nomorHp}</p>
        <div class="profile-stats">
            <div class="stat-card"><div class="value">${customerReservations.length}</div><div class="label">Reservasi</div></div>
            <div class="stat-card"><div class="value">Rp ${formatK(totalDp)}</div><div class="label">Total DP</div></div>
        </div>
        <h5>Riwayat:</h5>
        <div class="profile-history">${historyHtml}</div>
    </div>`;
}

// =========================================
// 16. BROADCAST & PROMO
// =========================================

function showBroadcastMain() { document.getElementById('broadcastMainPopup').style.display = 'block'; overlay.style.display = 'block'; }

function showBroadcastSettings() { 
    closePopup('broadcastMainPopup'); 
    document.getElementById('broadcastMessage').value = localStorage.getItem(BROADCAST_MESSAGE_KEY) || ''; 
    document.getElementById('broadcastSettingsPopup').style.display = 'block'; 
    overlay.style.display = 'block'; 
}

function saveBroadcastMessage() { 
    const msg = document.getElementById('broadcastMessage').value.trim(); 
    if (!msg) { showToast("Pesan kosong.", "error"); return; } 
    localStorage.setItem(BROADCAST_MESSAGE_KEY, msg); 
    promoMessageCache = msg; 
    showToast("Pesan tersimpan!"); 
    closePopup('broadcastSettingsPopup'); 
}

async function showBroadcastList() {
    closePopup('broadcastMainPopup'); showLoader();
    try {
        const savedMessage = localStorage.getItem(BROADCAST_MESSAGE_KEY);
        if (!savedMessage) { showToast("Atur pesan dulu!", "error"); showBroadcastSettings(); hideLoader(); return; }
        promoMessageCache = savedMessage;
        
        const snapshot = await db.collection('reservations').orderBy('createdAt', 'desc').get();
        const customers = new Map();
        snapshot.forEach(doc => { 
            const data = doc.data(); 
            if (data.nomorHp && isValidPhone(data.nomorHp)) { 
                const phone = cleanPhoneNumber(data.nomorHp); 
                if (!customers.has(phone)) customers.set(phone, { name: data.nama, phone: phone }); 
            } 
        });
        
        allCustomersCache = [...customers.values()].sort((a, b) => a.name.localeCompare(b.name));
        renderBroadcastCustomerList(allCustomersCache);
        document.getElementById('broadcastCustomerSearch').value = ''; 
        document.getElementById('broadcastListPopup').style.display = 'block'; 
        overlay.style.display = 'block';
    } catch (e) { 
        showToast("Error memuat broadcast list.", "error"); 
    } finally { 
        hideLoader(); 
    }
}

function renderBroadcastCustomerList(customers) {
    document.getElementById('broadcast-customer-list').innerHTML = customers.map(c => `
        <div class="broadcast-customer-item">
            <div class="customer-info"><strong>${c.name}</strong><small>${c.phone}</small></div>
            <button class="broadcast-btn" id="promo-btn-${c.phone}" onclick="sendPromoBroadcast('${c.phone}', '${c.name}', this.id)">
                <i class="fab fa-whatsapp"></i> Broadcast
            </button>
        </div>`).join('');
}

function filterBroadcastCustomers(q) { 
    const query = q.toLowerCase(); 
    renderBroadcastCustomerList(allCustomersCache.filter(c => c.name.toLowerCase().includes(query) || c.phone.includes(query))); 
}

function sendPromoBroadcast(phone, name, btnId) {
    if (!promoMessageCache) return;
    const msg = promoMessageCache.replace(/kak/gi, `Kak *${name}*`);
    window.open(`https://wa.me/${phone.replace(/^0/,'62')}?text=${encodeURIComponent(msg)}`, '_blank');
    const btn = document.getElementById(btnId); 
    if(btn) { 
        btn.classList.add('sent'); 
        btn.innerHTML = '<i class="fas fa-check"></i> Terkirim'; 
        btn.onclick = null; 
    }
}

// =========================================
// 17. NOTIFICATION SYSTEM
// =========================================

function setupReliableNotificationChecker() {
    if (notificationInterval) clearInterval(notificationInterval);
    runNotificationCheck(true);
    notificationInterval = setInterval(() => runNotificationCheck(true), 120000); // 2 menit
}

function runNotificationCheck(force) {
    const now = Date.now();
    // Cek hanya jika dipaksa atau sudah lebih dari 1 menit sejak cek terakhir
    if (force || (now - lastNotificationCheck > 60000)) { 
        lastNotificationCheck = now; 
        checkThankYouNotifications(); 
    }
}

async function checkThankYouNotifications() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
    
    const todayStr = today.toISOString().split('T')[0]; 
    const sevenAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    
    try {
        const snapshot = await db.collection('reservations')
            .where('date', '>=', sevenAgoStr)
            .where('date', '<=', todayStr)
            .where('thankYouSent', '!=', true).get();
        
        const pending = [];
        snapshot.forEach(doc => {
            const r = { id: doc.id, ...doc.data() };
            if (!r.jam || !r.date) return;
            
            const resTime = new Date(r.date + 'T' + r.jam);
            if (isNaN(resTime.getTime())) return;
            
            // Trigger notifikasi 3 jam setelah jam reservasi
            if (now > new Date(resTime.getTime() + (3*3600000))) pending.push(r);
        });
        
        const badge = document.getElementById('notification-badge');
        
        if (pending.length === 0) {
            document.getElementById('notification-list-ul').innerHTML = `<li style="padding:15px;text-align:center;color:#888;">Tidak ada pengingat.</li>`;
            badge.style.display = 'none';
        } else {
            badge.textContent = pending.length; 
            badge.style.display = 'flex';
            document.getElementById('notification-list-ul').innerHTML = pending.map(r => `
                <li class="notification-item" id="notification-item-${r.id}">
                    <span class="info"><strong>${r.nama}</strong> (${r.date})</span>
                    <button class="whatsapp" onclick="sendThankYouWhatsApp('${r.id}', '${r.nama}', '${r.nomorHp}')">
                        <i class="fab fa-whatsapp"></i> Kirim Ucapan
                    </button>
                </li>`).join('');
        }
    } catch (e) { console.error(e); }
}

function toggleNotificationDropdown(e) { 
    e.stopPropagation(); 
    const d = document.getElementById('notification-dropdown'); 
    d.style.display = d.style.display === 'block' ? 'none' : 'block'; 
}

function sendThankYouWhatsApp(id, name, phone) { 
    sendThankYouMessage(id, name, phone); 
    const item = document.getElementById(`notification-item-${id}`);
    if(item) item.style.display = 'none'; 
}

function forceSync() { 
    location.reload(); 
}
