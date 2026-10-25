# Dolan Sawah Manager (test-reservasi)

Dashboard admin reservasi Dolan Sawah: kalender, inbox permintaan dari form publik, data master
(menu & tempat), broadcast WhatsApp, analisis bisnis, cetak laporan harian.

- Frontend statis (index.html, app.js, style.css), Firebase v8 (Auth + Firestore), tanpa build step.
- Firebase project: reservasi-dolan-sawah. Login admin = Firebase Auth email/password.
- Hosting: GitHub Pages.

## Koleksi Firestore
- reservations: reservasi terkonfirmasi (date YYYY-MM-DD, jam, jumlah, tempat, nama, nomorHp, menus[], dp, tipeDp, status: konfirmasi/hadir/batal)
- reservation_requests: permintaan dari form publik, menunggu approve/tolak
- menus: id dokumen = nama menu; price, details[]
- locations: name, capacity
- settings/business: PPN %, DP %, rekening untuk pesan tagihan WA (opsional; ada nilai bawaan di kode)

## Perilaku penting
- Approve hanya menyalin field yang dikenal dari permintaan (whitelist + validasi) lewat transaksi.
- Reservasi batal tidak dihitung ke kapasitas, laporan cetak, dan analisis (tetap tersimpan).
- Kapasitas dijumlahkan per tanggal + tempat; melebihi kapasitas memunculkan konfirmasi.
- Nomor HP dinormalkan ke 62xxxx untuk link WhatsApp.
- Semua teks dari pengguna harus lewat escapeHtml(); nilai di onclick lewat escapeForJsAttr(),
  atau (lebih baik) cari data lewat id seperti sendThankYouMessage(id).

## Catatan keamanan (di luar kode ini)
Pastikan aturan Firestore membatasi tulis ke reservations/menus/locations/settings hanya untuk
admin tertentu (mis. cek request.auth.token.email), dan reservation_requests hanya create dengan
field/tipe/panjang yang dibatasi untuk publik.
