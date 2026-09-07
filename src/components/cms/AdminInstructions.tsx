import React from 'react';

export type AdminGuidePage =
  | 'competitions'
  | 'ponds'
  | 'prizes'
  | 'approvals'
  | 'all-bookings'
  | 'manual-booking'
  | 'checkin'
  | 'results'
  | 'all-weigh-ins'
  | 'contact-settings'
  | 'landing-content'
  | 'seo'
  | 'users'
  | 'audit-log';

interface AdminInstructionsProps {
  onNavigate: (page: AdminGuidePage) => void;
}

interface GuideLink {
  page: AdminGuidePage;
  label: string;
}

interface GuideCardProps {
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
  links: GuideLink[];
  tone?: 'default' | 'event' | 'content' | 'governance';
  onNavigate: (page: AdminGuidePage) => void;
}

const toneStyles: Record<NonNullable<GuideCardProps['tone']>, React.CSSProperties> = {
  default: { borderTop: '4px solid var(--red)' },
  event: { borderTop: '4px solid var(--cyan)' },
  content: { borderTop: '4px solid var(--green)' },
  governance: { borderTop: '4px solid var(--navy)' },
};

const GuideCard: React.FC<GuideCardProps> = ({ eyebrow, title, summary, children, links, tone = 'default', onNavigate }) => (
  <section className="card" style={{ ...toneStyles[tone], height: '100%' }}>
    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div>
        <div style={{ color: 'var(--red)', fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontSize: '1.14rem', lineHeight: 1.2, marginBottom: 6 }}>{title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.55 }}>{summary}</p>
      </div>
      <div style={{ fontSize: '0.84rem', lineHeight: 1.62, color: 'var(--text)' }}>{children}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 'auto', paddingTop: 2 }}>
        {links.map((link) => (
          <button key={link.page} type="button" className="btn btn-sm btn-ghost" onClick={() => onNavigate(link.page)}>
            {link.label} -&gt;
          </button>
        ))}
      </div>
    </div>
  </section>
);

const List: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</ul>
);

const AdminInstructions: React.FC<AdminInstructionsProps> = ({ onNavigate }) => (
  <div className="page active">
    <div className="page-header">
      <div>
        <div className="page-title">Arahan</div>
        <div className="page-sub">Panduan operasi ringkas CMS untuk admin</div>
      </div>
    </div>

    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 14,
      padding: '18px', marginBottom: 16, borderRadius: 14,
      color: '#fff', background: 'linear-gradient(135deg, var(--navy), #0b4665)',
      boxShadow: '0 16px 34px rgba(17,42,65,.16)',
    }}>
      <div>
        <div style={{ color: 'var(--cyan)', fontSize: '0.7rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 5 }}>Aliran kerja disyorkan</div>
        <h2 style={{ fontSize: '1.35rem', lineHeight: 1.15, marginBottom: 8 }}>Sedia - Tempahan - Hari Pertandingan - Semakan</h2>
        <p style={{ color: 'rgba(255,255,255,.78)', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: 760 }}>
          Mulakan dengan kolam dan pertandingan, semak pembayaran sebelum mengunci tempat, kemudian urus check-in dan timbangan setiap peg. Gunakan Log Audit untuk jejak tindakan penting.
        </p>
      </div>
      <div style={{ border: '1px solid rgba(255,255,255,.16)', borderRadius: 11, padding: '12px 14px', background: 'rgba(255,255,255,.07)' }}>
        <div style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 800, marginBottom: 5 }}>Sebelum tindakan kritikal</div>
        <div style={{ color: 'rgba(255,255,255,.74)', fontSize: '0.77rem', lineHeight: 1.55 }}>
          Sahkan pertandingan, nama pelanggan, nombor peg, jumlah bayaran dan bukti. Jangan bergantung pada nama sahaja apabila ada tempahan serupa.
        </div>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 14 }}>
      <GuideCard
        eyebrow="01 - Persediaan"
        title="Pertandingan, Kolam & Hadiah"
        summary="Sediakan struktur acara sebelum membuka tempahan kepada pelanggan."
        links={[
          { page: 'ponds', label: 'Kolam' },
          { page: 'competitions', label: 'Pertandingan' },
          { page: 'prizes', label: 'Hadiah & Ranking' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li><strong>Kolam:</strong> kod mesti satu huruf unik A-Z. Tetapkan bilangan pancang, susun urutan paparan dengan anak panah, dan muat naik Peta Kolam untuk halaman tempahan.</li>
          <li>Mengurangkan bilangan pancang akan disekat jika pancang yang dibuang masih mempunyai tempahan aktif. Padam kolam hanya selepas menyemak semua pertandingan berkaitan.</li>
          <li><strong>Pertandingan:</strong> isi masa mula/tamat, masa buka/tutup tempahan, harga setiap pancang, jumlah ranking dan sekurang-kurangnya satu kolam.</li>
          <li>Status dalam tetingkap <strong>Urus</strong> ditentukan automatik oleh tarikh: Coming soon (belum buka tempahan), Aktif (dari buka tempahan hingga pertandingan tamat) atau Tamat.</li>
          <li><strong>Hadiah & Ranking:</strong> semak julat kosong atau bertindih sebelum Simpan. <strong>Duplicate Previous</strong> menyalin julat daripada pertandingan lain.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="02 - Tempahan"
        title="Kelulusan & Pembayaran"
        summary="Semak identiti, peg, jumlah dan bukti sebelum membuat keputusan pertama."
        links={[
          { page: 'approvals', label: 'Kelulusan' },
          { page: 'all-bookings', label: 'Semua Tempahan' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li><strong>Kelulusan</strong> hanya memaparkan tempahan yang belum menerima keputusan pertama. Bandingkan telefon profil/tempahan dan beri perhatian pada amaran peg bertindih.</li>
          <li>Mengesahkan resit pertama terus mengesahkan tempahan dan mengunci peg, termasuk bayaran deposit. Menolak resit pertama menolak tempahan dan melepaskan peg.</li>
          <li>Untuk resit baki, keputusan hanya mengubah rekod pembayaran; tempahan yang sudah disahkan kekal disahkan.</li>
          <li>Bayaran luar sistem mesti direkod melalui <strong>Rekod secara manual</strong> bersama bukti. Gunakan <strong>Catatan Staf</strong> untuk maklumat dalaman.</li>
          <li>Di Semua Tempahan, semak sejarah resit, QR peserta dan status penghantaran e-mel. Peringatan baki menetapkan semula kiraan tujuh hari hanya selepas e-mel berjaya dihantar.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="03 - Tempahan"
        title="Tempahan Manual & Pembatalan"
        summary="Buat tempahan bagi pihak pelanggan dan gunakan pembatalan hanya selepas semakan silang."
        links={[
          { page: 'manual-booking', label: 'Tempahan Manual' },
          { page: 'all-bookings', label: 'Semua Tempahan' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Butang Tempahan Manual membuka halaman tempahan awam. Apabila admin log masuk, medan pelanggan <strong>akan dipaparkan</strong> tetapi nama, e-mel dan telefon masih perlu ditaip.</li>
          <li>Pilih pertandingan, kolam dan peg seperti pelanggan biasa, kemudian muat naik resit. Rekod akan ditanda sebagai <strong>Ditempah oleh Admin</strong> dan tidak memerlukan akaun pelanggan.</li>
          <li><strong>Batal Paksa</strong> hanya tersedia untuk tempahan disahkan. Ia memerlukan dua pengesahan dan akan melepaskan semua peg tempahan.</li>
          <li>Selepas tindakan, cari semula rujukan tempahan dan pastikan status serta peg telah berubah seperti yang dijangka.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="04 - Hari Pertandingan"
        title="Check-In Setiap Peg"
        summary="Gunakan QR untuk membuka tempahan yang betul dan rekod kehadiran mengikut peg."
        tone="event"
        links={[{ page: 'checkin', label: 'Check-In' }]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Imbas QR secara live atau muat naik gambar QR. Kamera berhenti apabila kod dikesan; kandungan kod dipaparkan jika tiada tempahan sepadan.</li>
          <li>Tempahan mesti disahkan. Untuk tempahan berbilang peg atau kolam, tekan <strong>Check-In</strong> pada setiap peg secara berasingan.</li>
          <li>Gunakan <strong>Senarai Check in</strong> untuk pilih pertandingan, semak masa setiap peg dan membatalkan check-in yang tersilap.</li>
          <li>Sahkan nama, pertandingan, kolam dan nombor peg sebelum menekan Check-In atau Batalkan Check in.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="05 - Hari Pertandingan"
        title="Timbangan, OCR & Keputusan Live"
        summary="Setiap bacaan mesti dipadankan dengan peserta dan disahkan terhadap paparan sebenar."
        tone="event"
        links={[
          { page: 'results', label: 'Keputusan & Live' },
          { page: 'all-weigh-ins', label: 'Semua Timbangan' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Pilih pertandingan, kemudian kenal pasti peserta melalui QR live, gambar QR atau carian manual. Pilih peg yang sedang ditimbang jika tempahan mempunyai lebih daripada satu peg.</li>
          <li>Ambil gambar jelas dan crop <strong>hanya baris angka</strong>. Bandingkan bacaan dengan timbangan sebelum <strong>Sahkan & Simpan</strong>.</li>
          <li>Jika AI salah, cuba Ambil Semula, Imbas AI Semula atau Imbas Tanpa AI. Kemasukan manual wajib menggunakan gambar bukti baharu.</li>
          <li>Papan Markah Semasa membenarkan bukti dilihat dan rekod dipadam. Pemadaman tidak boleh dipulihkan dari CMS.</li>
          <li>Semua Timbangan ialah sejarah baca sahaja merentas pertandingan; sunting atau padam hanya di Keputusan & Live.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="06 - Kandungan"
        title="Hubungan, Bank, Laman Utama & SEO"
        summary="Semak perubahan pada halaman awam dan bahan pembayaran sebelum mengumumkannya."
        tone="content"
        links={[
          { page: 'contact-settings', label: 'Contact Us' },
          { page: 'landing-content', label: 'Laman Utama' },
          { page: 'seo', label: 'SEO' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li><strong>Contact Us:</strong> urus telefon, WhatsApp, e-mel, alamat, bank, nama/nombor akaun dan QR pembayaran.</li>
          <li><strong>Laman Utama:</strong> setiap seksyen boleh menggunakan input biasa atau Custom HTML. HTML disanitasi; skrip, event handler, borang, iframe dan URL berbahaya dibuang.</li>
          <li>Urus imej, peta/lokasi, syarat dinamik dan PDF Syarat & Peraturan. Tetapan OCR turut berada di halaman ini.</li>
          <li><strong>SEO:</strong> hanya Laman Utama (/), Tempah (/book) dan Live (/live) boleh disunting. <code>/confirmed</code> ialah halaman peribadi.</li>
          <li>Imej perkongsian disyorkan 1200 x 630 dan ditukar ke JPEG. Pratonton sebelum Simpan; crawler mungkin mengambil kira-kira 10 minit untuk melihat perubahan.</li>
        </List>
      </GuideCard>

      <GuideCard
        eyebrow="07 - Tadbir Urus"
        title="Pengguna, Peranan & Log Audit"
        summary="Admin mengurus akses CMS; staf hanya melihat pengguna dan menjalankan operasi hari pertandingan."
        tone="governance"
        links={[
          { page: 'users', label: 'Pengguna' },
          { page: 'audit-log', label: 'Log Audit' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Admin boleh menukar Pengguna kepada Staf atau Admin, dan menukar Staf kembali kepada Pengguna. Akaun Admin sedia ada dan peranan sendiri dikunci daripada perubahan dalam CMS.</li>
          <li>Staf hanya boleh membuka Check-In, Keputusan &amp; Live, Semua Timbangan dan senarai Pengguna secara baca sahaja.</li>
          <li>Senarai akaun dan Tempahan Manual Tanpa Akaun membantu membezakan pelanggan berdaftar daripada tempahan kaunter/proksi.</li>
          <li>Log Audit memaparkan 200 tindakan terkini dan tidak boleh disunting atau dipadam. Timbangan individu tidak dicatat di sini; pemadaman keputusan dicatat.</li>
          <li>Gunakan carian nama staf, e-mel, entiti atau tindakan apabila menyiasat perubahan.</li>
        </List>
      </GuideCard>
    </div>

    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12 }}>
      <div style={{ padding: '14px 16px', borderRadius: 11, border: '1px solid rgba(217,119,6,.35)', background: 'var(--amber-pale)', fontSize: '0.8rem', lineHeight: 1.55 }}>
        <strong style={{ color: '#92400e' }}>Amaran - keputusan pembayaran:</strong> semak resit, jumlah, rujukan bank dan peg sebelum Sahkan/Tolak. Keputusan pertama mengubah status tempahan dan ketersediaan peg.
      </div>
      <div style={{ padding: '14px 16px', borderRadius: 11, border: '1px solid rgba(231,25,45,.28)', background: 'var(--red-pale)', fontSize: '0.8rem', lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--red-mid)' }}>Amaran - tindakan kekal:</strong> Batal Paksa, Padam Pertandingan, Padam Kolam dan padam rekod keputusan perlu semakan silang kerana pemulihan tidak tersedia dalam CMS.
      </div>
    </div>
  </div>
);

export default AdminInstructions;
