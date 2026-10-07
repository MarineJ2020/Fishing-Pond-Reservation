import React, { useState } from 'react';

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
  default: { borderLeft: '5px solid var(--red)' },
  event: { borderLeft: '5px solid var(--cyan)' },
  content: { borderLeft: '5px solid var(--green)' },
  governance: { borderLeft: '5px solid var(--navy)' },
};

// One full-width card per topic: heading and summary first, then short steps,
// then shortcut buttons. A single column is far easier to read than a grid.
const GuideCard: React.FC<GuideCardProps> = ({ eyebrow, title, summary, children, links, tone = 'default', onNavigate }) => (
  <div className="card" style={{ ...toneStyles[tone], marginBottom: 16 }}>
    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 22px' }}>
      <div>
        <div style={{ color: 'var(--red)', fontSize: '0.74rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontSize: '1.4rem', lineHeight: 1.2, marginBottom: 6, color: 'var(--navy)' }}>{title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>{summary}</p>
      </div>
      <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text)' }}>{children}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 2 }}>
        {links.map((link) => (
          <button key={link.page} type="button" className="btn btn-sm btn-ghost" onClick={() => onNavigate(link.page)}>
            Buka {link.label} →
          </button>
        ))}
      </div>
    </div>
  </div>
);

const List: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10, margin: 0 }}>{children}</ul>
);

const Steps: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10, margin: 0 }}>{children}</ol>
);

const Callout: React.FC<{ tone: 'amber' | 'red' | 'blue'; title: string; children: React.ReactNode }> = ({ tone, title, children }) => {
  const palette = {
    amber: { border: 'rgba(217,119,6,.4)', bg: 'var(--amber-pale)', title: '#92400e' },
    red: { border: 'rgba(231,25,45,.3)', bg: 'var(--red-pale)', title: 'var(--red-mid)' },
    blue: { border: 'rgba(14,116,144,.3)', bg: '#ecfeff', title: '#0e7490' },
  }[tone];
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.bg, fontSize: '0.9rem', lineHeight: 1.6 }}>
      <strong style={{ color: palette.title }}>{title}</strong> {children}
    </div>
  );
};

const AdminInstructions: React.FC<AdminInstructionsProps> = ({ onNavigate }) => {
  const [tab, setTab] = useState(0);
  const guides: { label: string; node: React.ReactNode }[] = [
    { label: 'Persediaan', node: (
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
          <li>Status ditentukan automatik oleh tarikh: <em>Coming soon</em> (belum buka tempahan), <em>Aktif</em> (dari buka tempahan hingga pertandingan tamat) atau <em>Tamat</em>.</li>
          <li><strong>Hadiah &amp; Ranking:</strong> semak julat kosong atau bertindih sebelum Simpan. <strong>Duplicate Previous</strong> menyalin julat daripada pertandingan lain.</li>
          <li><strong>Laman utama:</strong> kad &quot;Acara Pilihan&quot; ialah pertandingan aktif yang paling hampir. Kad di sebelahnya menunjukkan pertandingan seterusnya; jika tiada, kad &quot;Akan diumumkan&quot; dipaparkan.</li>
        </List>
      </GuideCard>
    ) },
    { label: 'Kelulusan', node: (
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
          <li>Di Semua Tempahan, semak sejarah resit dan status penghantaran e-mel. Peringatan baki menetapkan semula kiraan tujuh hari hanya selepas e-mel berjaya dihantar.</li>
        </List>
      </GuideCard>
    ) },
    { label: 'QR Peserta', node: (
      <GuideCard
        eyebrow="03 - Tempahan"
        title="QR Peserta (Cetak / Muat Turun)"
        summary="Setiap peg mempunyai QR sendiri. Jika peserta terlupa cetak, staf boleh membantu."
        links={[{ page: 'all-bookings', label: 'Semua Tempahan' }]}
        onNavigate={onNavigate}
      >
        <Steps>
          <li>Di <strong>Semua Tempahan</strong>, cari tempahan peserta (status Disahkan) dan tekan butang <strong>QR</strong>.</li>
          <li>Setiap QR dipaparkan bersama pertandingan, masa mula, kolam, peg dan rujukan tempahan.</li>
          <li>Tekan <strong>⬇ Muat turun</strong> untuk simpan satu kad QR sebagai gambar, atau <strong>🖨 Cetak Semua QR</strong> untuk mencetak semua peg dalam tempahan itu. Benarkan pop-up pelayar jika tidak terbuka.</li>
          <li>Peserta juga boleh memuat turun kad yang sama daripada e-mel pengesahan atau halaman tempahan mereka.</li>
        </Steps>
      </GuideCard>
    ) },
    { label: 'Tempahan Manual', node: (
      <GuideCard
        eyebrow="04 - Tempahan"
        title="Tempahan Manual & Pembatalan"
        summary="Buat tempahan bagi pihak pelanggan dan gunakan pembatalan hanya selepas semakan silang."
        links={[
          { page: 'manual-booking', label: 'Tempahan Manual' },
          { page: 'all-bookings', label: 'Semua Tempahan' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Butang Tempahan Manual membuka halaman tempahan awam. Apabila admin log masuk, medan pelanggan dipaparkan tetapi nama, e-mel dan telefon masih perlu ditaip.</li>
          <li>Pilih pertandingan, kolam dan peg seperti pelanggan biasa, kemudian muat naik resit. Rekod ditanda <strong>Ditempah oleh Admin</strong> dan tidak memerlukan akaun pelanggan.</li>
          <li><strong>Batal Paksa</strong> hanya untuk tempahan disahkan. Ia memerlukan dua pengesahan, wajib ada sebab, dan melepaskan semua peg tempahan.</li>
          <li><strong>QR tempahan yang dibatalkan menjadi tidak sah.</strong> Apabila diimbas, CMS memaparkan &quot;QR Tidak Sah&quot; bersama status dan sebab pembatalan; check-in dan timbangan disekat. Tempahan dibatalkan juga tidak muncul dalam Senarai Check in.</li>
          <li>Selepas tindakan, cari semula rujukan tempahan dan pastikan status serta peg telah berubah seperti yang dijangka.</li>
        </List>
      </GuideCard>
    ) },
    { label: 'Check-In', node: (
      <GuideCard
        eyebrow="05 - Hari Pertandingan"
        title="Check-In Setiap Peg"
        summary="Gunakan QR untuk membuka tempahan yang betul dan rekod kehadiran mengikut peg."
        tone="event"
        links={[{ page: 'checkin', label: 'Check-In' }]}
        onNavigate={onNavigate}
      >
        <Steps>
          <li>Imbas QR secara live atau muat naik gambar QR. Kamera berhenti apabila kod dikesan; kandungan kod dipaparkan jika tiada tempahan sepadan.</li>
          <li>Tempahan mesti disahkan dan bayaran penuh selesai. Untuk berbilang peg atau kolam, tekan <strong>Check-In</strong> pada setiap peg secara berasingan.</li>
          <li>Jika kad merah <strong>&quot;QR Tidak Sah — Tempahan Dibatalkan&quot;</strong> muncul, jangan benarkan masuk; baca sebab pembatalan yang dipaparkan.</li>
          <li>Gunakan <strong>Senarai Check in</strong> untuk pilih pertandingan, semak masa setiap peg dan membatalkan check-in yang tersilap.</li>
          <li>Sahkan nama, pertandingan, kolam dan nombor peg sebelum menekan Check-In atau Batalkan Check in.</li>
        </Steps>
      </GuideCard>
    ) },
    { label: 'Timbangan', node: (
      <GuideCard
        eyebrow="06 - Hari Pertandingan"
        title="Timbangan, OCR & Keputusan Live"
        summary="Setiap bacaan mesti dipadankan dengan peserta dan disahkan terhadap paparan sebenar."
        tone="event"
        links={[
          { page: 'results', label: 'Keputusan & Live' },
          { page: 'all-weigh-ins', label: 'Semua Timbangan' },
        ]}
        onNavigate={onNavigate}
      >
        <Steps>
          <li>Pilih pertandingan, kemudian kenal pasti peserta melalui QR live, gambar QR atau carian manual. Pilih peg yang sedang ditimbang jika tempahan mempunyai lebih daripada satu peg. QR tempahan dibatalkan akan ditolak.</li>
          <li><strong>Ambil gambar:</strong> kamera live dibuka dengan kotak kuning di bahagian bawah skrin. Letakkan <strong>hanya baris angka</strong> di dalam kotak (tanpa label dan tanpa &quot;kg&quot;); pemancing dan ikan boleh berada di bahagian atas gambar. Tekan butang bulat untuk ambil dan imbas terus.</li>
          <li>Butang kecil di sebelah kiri membolehkan pilih gambar daripada galeri. Kotak imbasan diletakkan automatik pada angka (atau guna kotak terakhir); semak dan tekan <strong>Imbas Kawasan Ini</strong>.</li>
          <li>Bandingkan bacaan dengan timbangan sebelum <strong>Sahkan &amp; Simpan</strong>. Jika kotak tersilap, tekan <strong>Laras Kotak &amp; Imbas Semula</strong>.</li>
          <li>Titik perpuluhan sukar dibaca, jadi sistem menggunakan tetapan <strong>Posisi titik perpuluhan</strong> (cth. 3 = tiga digit terakhir ialah perpuluhan). Jika bacaan ada <strong>satu digit lebih</strong> (cth. 1.246 menjadi 12.480), titik akan beralih. Semak teks <code>ONNX</code> di skrin, imbas semula tanpa &quot;kg&quot; dalam kotak, atau masukkan manual.</li>
          <li>Jika AI masih salah, cuba Ambil Semula atau Masukkan Manual. Kemasukan manual menggunakan gambar timbangan sebagai bukti, atau gambar lain jika dipilih.</li>
          <li>Papan Markah Semasa membenarkan bukti dilihat dan rekod dipadam daripada ranking live selepas dua pengesahan admin. Semua Timbangan ialah sejarah baca sahaja merentas pertandingan.</li>
        </Steps>
      </GuideCard>
    ) },
    { label: 'Kandungan', node: (
      <GuideCard
        eyebrow="07 - Kandungan"
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
          <li>Urus imej, peta/lokasi, syarat dinamik dan PDF Syarat &amp; Peraturan. Tetapan OCR (termasuk tempat perpuluhan) turut berada di halaman ini.</li>
          <li><strong>SEO:</strong> hanya Laman Utama (/), Tempah (/book) dan Live (/live) boleh disunting. <code>/confirmed</code> ialah halaman peribadi.</li>
          <li>Imej perkongsian disyorkan 1200 x 630 dan ditukar ke JPEG. Pratonton sebelum Simpan; crawler mungkin mengambil kira-kira 10 minit untuk melihat perubahan.</li>
        </List>
      </GuideCard>
    ) },
    { label: 'Tadbir Urus', node: (
      <GuideCard
        eyebrow="08 - Tadbir Urus"
        title="Pengguna, Peranan & Log Audit"
        summary="Admin mengurus akses CMS; staf hanya menjalankan operasi hari pertandingan."
        tone="governance"
        links={[
          { page: 'users', label: 'Pengguna' },
          { page: 'audit-log', label: 'Log Audit' },
        ]}
        onNavigate={onNavigate}
      >
        <List>
          <li>Admin boleh menukar Pengguna kepada Staf atau Admin, dan menukar Staf kembali kepada Pengguna. Akaun Admin sedia ada dan peranan sendiri dikunci daripada perubahan dalam CMS.</li>
          <li>Staf hanya boleh membuka Check-In, Keputusan &amp; Live dan Semua Timbangan. Senarai Pengguna hanya untuk Admin.</li>
          <li>Senarai akaun dan Tempahan Manual Tanpa Akaun membantu membezakan pelanggan berdaftar daripada tempahan kaunter/proksi.</li>
          <li>Log Audit memaparkan 200 tindakan terkini dan tidak boleh disunting atau dipadam. Timbangan individu tidak dicatat di sini; pemadaman keputusan dicatat.</li>
          <li>Gunakan carian nama staf, e-mel, entiti atau tindakan apabila menyiasat perubahan.</li>
        </List>
      </GuideCard>
    ) },
  ];
  return (
  <div className="page active">
    <div className="page-header">
      <div>
        <div className="page-title">Arahan</div>
        <div className="page-sub">Panduan operasi CMS untuk admin dan staf</div>
      </div>
    </div>

    <div style={{ maxWidth: 880 }}>
      <div style={{
        padding: '20px 22px', marginBottom: 18, borderRadius: 14,
        background: '#ffffff', border: '1px solid var(--line)', borderTop: '5px solid var(--navy)',
        boxShadow: '0 8px 22px rgba(17,42,65,.08)',
      }}>
        <div style={{ color: 'var(--red)', fontSize: '0.74rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>Aliran kerja disyorkan</div>
        <h2 style={{ fontSize: '1.45rem', lineHeight: 1.25, marginBottom: 10, color: 'var(--navy)' }}>Sedia → Tempahan → Hari Pertandingan → Semakan</h2>
        <p style={{ color: 'var(--text)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: 14 }}>
          Mulakan dengan kolam dan pertandingan, semak pembayaran sebelum mengunci tempat, kemudian urus check-in dan timbangan setiap peg. Gunakan Log Audit untuk jejak tindakan penting.
        </p>
        <Callout tone="blue" title="Sebelum tindakan kritikal:">
          sahkan pertandingan, nama pelanggan, nombor peg, jumlah bayaran dan bukti. Jangan bergantung pada nama sahaja apabila ada tempahan serupa.
        </Callout>
      </div>

      <div role="tablist" aria-label="Pilih arahan" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 14, WebkitOverflowScrolling: 'touch' }}>
        {guides.map((guide, i) => (
          <button
            key={guide.label}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={tab === i ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
            style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}
          >
            {String(i + 1).padStart(2, '0')} {guide.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{guides[tab].node}</div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 8 }}>
        <Callout tone="amber" title="Amaran - keputusan pembayaran:">
          semak resit, jumlah, rujukan bank dan peg sebelum Sahkan/Tolak. Keputusan pertama mengubah status tempahan dan ketersediaan peg.
        </Callout>
        <Callout tone="red" title="Amaran - tindakan kekal:">
          Batal Paksa, Padam Pertandingan, Padam Kolam dan padam rekod keputusan perlu semakan silang kerana pemulihan tidak tersedia dalam CMS.
        </Callout>
      </div>
    </div>
  </div>
  );
};

export default AdminInstructions;
