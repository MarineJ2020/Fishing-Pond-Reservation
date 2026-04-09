import React, { useState, useEffect } from 'react';
import { User, Pond, Competition, Prize, Settings } from '../types';
import { gs } from '../data';
import {
  createPond as createPondFirestore,
  updatePond as updatePondFirestore,
  updateBookingStatus as updateBookingStatusFirestore,
  updateCompetition as updateCompetitionFirestore,
  updateSettings as updateSettingsFirestore,
} from '../lib/firestore';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  settings: Settings;
  bookings: { id: string; userName: string; pondName: string; seats: number[]; amount: number; userId: string; userPhone: string; receiptData: string; status: string; pondId: number }[];
  onUpdateData: (updates: { ponds?: Pond[]; comp?: Competition }) => void;
  reloadDB: () => Promise<void>;
}

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, user, ponds, comp, settings, bookings, onUpdateData, reloadDB }) => {
  const [tab, setTab] = useState<'ponds' | 'competition' | 'settings' | 'bookings' | 'content'>('ponds');
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [compEdit, setCompEdit] = useState<Competition>(comp);
  const [settingsEdit, setSettingsEdit] = useState(settings);
  const [newPond, setNewPond] = useState<Partial<Pond>>({ name: '', date: '', desc: '', seats: [], open: true });
  const [saving, setSaving] = useState(false);
  const [uploadingHeroLogo, setUploadingHeroLogo] = useState(false);

  useEffect(() => { setCompEdit(comp); }, [comp]);
  useEffect(() => { setSettingsEdit(settings); }, [settings]);

  const toLocalDatetime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const isStaff = user && (user.role === 'ADMIN' || user.role === 'STAFF');

  if (!isOpen) return null;

  const handlePondUpdate = async (pond: Pond) => {
    setSaving(true);
    try {
      await updatePondFirestore(pond._docId || pond.id.toString(), {
        name: pond.name,
        description: pond.desc,
        eventDate: pond.date,
        open: pond.open,
        totalSeats: pond.seats.length,
        pricePerSeat: pond.seats[0]?.price || 100,
      } as any);
      await reloadDB();
      setEditingPond(null);
    } catch (err) {
      console.error('Failed to update pond:', err);
    }
    setSaving(false);
  };

  const handleCompetitionUpdate = async () => {
    setSaving(true);
    try {
      if (!compEdit.id) {
        console.warn('No competition ID found. Cannot update.');
        setSaving(false);
        return;
      }
      await updateCompetitionFirestore(compEdit.id, {
        name: compEdit.name,
        eventDate: compEdit.startDate,
        endDate: compEdit.endDate,
        topN: compEdit.topN,
        prizes: compEdit.prizes,
      } as any);
      await reloadDB();
      alert('✅ Competition settings saved successfully!');
    } catch (err) {
      console.error('Failed to update competition:', err);
      alert('❌ Failed to save competition settings. Check console.');
    }
    setSaving(false);
  };

  const handleApproveBooking = async (bookingId: string) => {
    setSaving(true);
    try {
      await updateBookingStatusFirestore(bookingId, 'confirmed');
      await reloadDB();
    } catch (err) {
      console.error('Failed to approve booking:', err);
    }
    setSaving(false);
  };

  const handleRejectBooking = async (bookingId: string) => {
    setSaving(true);
    try {
      await updateBookingStatusFirestore(bookingId, 'rejected');
      await reloadDB();
    } catch (err) {
      console.error('Failed to reject booking:', err);
    }
    setSaving(false);
  };

  const handleViewReceipt = (receiptData: string) => {
    // Open in new window or modal
    const img = new Image();
    img.src = receiptData;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<img src="' + receiptData + '" style="max-width:100%;max-height:100vh;" />');
      w.document.close();
    }
  };

  const uploadHeroLogo = async (file: File) => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      throw new Error('Cloudinary environment variables are missing.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', 'fishing-pond-assets');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error('Failed to upload hero logo.');
    }

    const data = await res.json();
    return data.secure_url as string;
  };

  const handleHeroLogoFileChange = async (file: File | null) => {
    if (!file) return;
    setUploadingHeroLogo(true);
    try {
      const logoUrl = await uploadHeroLogo(file);
      setSettingsEdit({ ...settingsEdit, heroLogo: logoUrl });
      alert('✅ Hero logo uploaded. Click Save Settings to publish.');
    } catch (err) {
      console.error('Hero logo upload failed:', err);
      alert('❌ Failed to upload hero logo. Check console or Cloudinary config.');
    }
    setUploadingHeroLogo(false);
  };

  if (!isStaff) {
    return (
      <div className="cms-modal-overlay" onClick={onClose}>
        <div className="cms-modal-content" onClick={e => e.stopPropagation()}>
          <div className="cms-header">
            <h2>Staff Access Only</h2>
            <button className="cms-close" onClick={onClose}>✕</button>
          </div>
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔒</div>
            <p>This area is restricted to staff and administrators.</p>
            <p style={{ fontSize: '12px', marginTop: '16px' }}>
              Contact your administrator to gain access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-modal-overlay" onClick={onClose}>
      <div className="cms-modal-content" onClick={e => e.stopPropagation()}>
        <div className="cms-header">
          <h2>CMS Control Panel</h2>
          <button className="cms-close" onClick={onClose}>✕</button>
        </div>

        <div className="cms-tabs">
          <button
            className={`cms-tab ${tab === 'ponds' ? 'active' : ''}`}
            onClick={() => setTab('ponds')}
          >
            🎣 Ponds
          </button>
          <button
            className={`cms-tab ${tab === 'competition' ? 'active' : ''}`}
            onClick={() => setTab('competition')}
          >
            🏆 Competition
          </button>
          <button
            className={`cms-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            ⚙️ Settings
          </button>
          <button
            className={`cms-tab ${tab === 'bookings' ? 'active' : ''}`}
            onClick={() => setTab('bookings')}
          >
            📋 Bookings
          </button>
          <button
            className={`cms-tab ${tab === 'content' ? 'active' : ''}`}
            onClick={() => setTab('content')}
          >
            📝 Content
          </button>
        </div>

        <div className="cms-content">
          {tab === 'ponds' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Manage Ponds</h3>
              <div style={{ marginBottom: '20px' }}>
                <h4>Add New Pond</h4>
                <div className="cms-form">
                  <div className="form-group">
                    <label>Pond Name</label>
                    <input
                      type="text"
                      value={newPond.name}
                      onChange={e => setNewPond({ ...newPond, name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={newPond.desc}
                      onChange={e => setNewPond({ ...newPond, desc: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={newPond.date}
                      onChange={e => setNewPond({ ...newPond, date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Number of Seats</label>
                    <input
                      type="number"
                      value={newPond.seats?.length || 0}
                      onChange={e => {
                        const count = parseInt(e.target.value) || 0;
                        const price = newPond.seats?.[0]?.price || 100;
                        setNewPond({ ...newPond, seats: gs(Math.max(...ponds.map(p => p.id)) + 1, 1, count, price) });
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Price per Seat</label>
                    <input
                      type="number"
                      value={newPond.seats?.[0]?.price || 100}
                      onChange={e => {
                        const price = parseInt(e.target.value) || 100;
                        const count = newPond.seats?.length || 0;
                        setNewPond({ ...newPond, seats: gs(Math.max(...ponds.map(p => p.id)) + 1, 1, count, price) });
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button className="btn btn-primary" disabled={saving} onClick={async () => {
                      if (newPond.name && newPond.date && newPond.seats && newPond.seats.length > 0) {
                        setSaving(true);
                        try {
                          await createPondFirestore({
                            name: newPond.name,
                            date: newPond.date,
                            desc: newPond.desc || '',
                            open: true,
                            totalSeats: newPond.seats.length,
                            pricePerSeat: newPond.seats[0]?.price || 100,
                          } as any);
                          await reloadDB();
                          setNewPond({ name: '', date: '', desc: '', seats: [], open: true });
                        } catch (err) {
                          console.error('Failed to add pond:', err);
                        }
                        setSaving(false);
                      }
                    }}>
                      {saving ? 'Saving...' : 'Add Pond'}
                    </button>
                  </div>
                </div>
              </div>
              {editingPond ? (
                <div className="cms-form">
                  <div className="form-group">
                    <label>Pond Name</label>
                    <input
                      type="text"
                      value={editingPond.name}
                      onChange={e => setEditingPond({ ...editingPond, name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={editingPond.desc}
                      onChange={e => setEditingPond({ ...editingPond, desc: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={editingPond.date}
                      onChange={e => setEditingPond({ ...editingPond, date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Number of Seats</label>
                    <input
                      type="number"
                      value={editingPond.seats.length}
                      onChange={e => {
                        const count = parseInt(e.target.value) || 0;
                        const price = editingPond.seats[0]?.price || 100;
                        setEditingPond({ ...editingPond, seats: gs(editingPond.id, 1, count, price) });
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Price per Seat</label>
                    <input
                      type="number"
                      value={editingPond.seats[0]?.price || 100}
                      onChange={e => {
                        const price = parseInt(e.target.value) || 100;
                        const count = editingPond.seats.length;
                        setEditingPond({ ...editingPond, seats: gs(editingPond.id, 1, count, price) });
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={editingPond.open ? 'open' : 'closed'}
                      onChange={e => setEditingPond({ ...editingPond, open: e.target.value === 'open' })}
                    >
                      <option value="open">Open for Booking</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button className="btn btn-primary" disabled={saving} onClick={() => handlePondUpdate(editingPond)}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setEditingPond(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cms-list">
                  {ponds.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
                      <p>No ponds yet. Create one above.</p>
                    </div>
                  ) : (
                    ponds.map(pond => (
                      <div key={pond._docId || pond.id} className="cms-list-item" style={{ background: 'var(--surface2)', padding: '14px', borderRadius: '8px', marginBottom: '10px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div className="cms-item-name" style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px' }}>{pond.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
                            📍 {pond.date} · 🪑 {pond.seats.length} pegs · 💰 RM {pond.seats[0]?.price || 0} each
                            <br />
                            📊 {pond.seats.filter(s => s.status === 'available').length} available · {pond.seats.filter(s => s.status === 'booked').length} booked
                            <br />
                            {pond.open ? '✅ Open' : '❌ Closed'}
                          </div>
                        </div>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => setEditingPond(pond)}
                          style={{ marginLeft: '12px', flexShrink: 0 }}
                        >
                          Edit
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'competition' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Competition Settings</h3>
              <div className="cms-form">
                <div className="form-group">
                  <label>Competition Name</label>
                  <input
                    type="text"
                    value={compEdit.name}
                    onChange={e => setCompEdit({ ...compEdit, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Start Date & Time</label>
                  <input
                    type="datetime-local"
                    value={toLocalDatetime(compEdit.startDate)}
                    onChange={e => e.target.value && setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })}
                  />
                </div>
                <div className="form-group">
                  <label>End Date & Time</label>
                  <input
                    type="datetime-local"
                    value={toLocalDatetime(compEdit.endDate)}
                    onChange={e => e.target.value && setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })}
                  />
                </div>
                <div className="form-group">
                  <label>Top N Anglers to Display</label>
                  <input
                    type="number"
                    value={compEdit.topN}
                    onChange={e => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 20 })}
                  />
                </div>
                <div className="form-group">
                  <label>Prize Pool</label>
                  {compEdit.prizes.map((p: Prize, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={p.rank}
                        onChange={e => {
                          const prizes = [...compEdit.prizes];
                          prizes[i] = { ...prizes[i], rank: parseInt(e.target.value) || 1 };
                          setCompEdit({ ...compEdit, prizes });
                        }}
                        style={{ width: '60px' }}
                        placeholder="Rank"
                      />
                      <input
                        type="text"
                        value={p.label || ''}
                        onChange={e => {
                          const prizes = [...compEdit.prizes];
                          prizes[i] = { ...prizes[i], label: e.target.value };
                          setCompEdit({ ...compEdit, prizes });
                        }}
                        style={{ width: '100px' }}
                        placeholder="Label"
                      />
                      <input
                        type="text"
                        value={p.prize}
                        onChange={e => {
                          const prizes = [...compEdit.prizes];
                          prizes[i] = { ...prizes[i], prize: e.target.value };
                          setCompEdit({ ...compEdit, prizes });
                        }}
                        style={{ flex: 1 }}
                        placeholder="Prize (e.g. RM500)"
                      />
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          const prizes = compEdit.prizes.filter((_: Prize, idx: number) => idx !== i);
                          setCompEdit({ ...compEdit, prizes });
                        }}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                      >✕</button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const nextRank = compEdit.prizes.length ? Math.max(...compEdit.prizes.map((p: Prize) => p.rank)) + 1 : 1;
                      setCompEdit({ ...compEdit, prizes: [...compEdit.prizes, { rank: nextRank, label: `#${nextRank}`, prize: '' }] });
                    }}
                    style={{ marginTop: '6px' }}
                  >+ Add Prize</button>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" disabled={saving} onClick={handleCompetitionUpdate}>
                    {saving ? 'Saving...' : 'Save Competition'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Site Settings</h3>
              <div className="cms-form">
                <div className="form-group">
                  <label>Hero Logo Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingHeroLogo || saving}
                    onChange={e => handleHeroLogoFileChange(e.target.files?.[0] || null)}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>
                    Upload a logo image. PNG with transparent background is recommended.
                  </div>
                  {settingsEdit.heroLogo && (
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <img
                        src={settingsEdit.heroLogo}
                        alt="Hero logo preview"
                        style={{ width: '72px', height: '72px', objectFit: 'contain', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface2)' }}
                      />
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        disabled={uploadingHeroLogo || saving}
                        onClick={() => setSettingsEdit({ ...settingsEdit, heroLogo: '' })}
                      >
                        Remove Logo
                      </button>
                    </div>
                  )}
                  {uploadingHeroLogo && (
                    <div style={{ fontSize: '12px', marginTop: '8px', color: 'var(--muted)' }}>Uploading logo...</div>
                  )}
                </div>
                <div className="form-group">
                  <label>WhatsApp Number (for booking button)</label>
                  <input
                    type="text"
                    value={settingsEdit.whatsapp}
                    onChange={e => setSettingsEdit({ ...settingsEdit, whatsapp: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Location</label>
                  <input
                    type="text"
                    value={settingsEdit.location}
                    onChange={e => setSettingsEdit({ ...settingsEdit, location: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Opening Days</label>
                  <select
                    multiple
                    value={settingsEdit.openingHours.days}
                    onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, days: Array.from(e.target.selectedOptions, o => o.value) } })}
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Opening Time Start</label>
                  <input
                    type="time"
                    value={settingsEdit.openingHours.timeStart}
                    onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, timeStart: e.target.value } })}
                  />
                </div>
                <div className="form-group">
                  <label>Opening Time End</label>
                  <input
                    type="time"
                    value={settingsEdit.openingHours.timeEnd}
                    onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, timeEnd: e.target.value } })}
                  />
                </div>
                <div className="form-group">
                  <label>Grand Opening Date</label>
                  <input
                    type="date"
                    value={settingsEdit.grandOpening.date}
                    onChange={e => setSettingsEdit({ ...settingsEdit, grandOpening: { ...settingsEdit.grandOpening, date: e.target.value } })}
                  />
                </div>
                <div className="form-group">
                  <label>Grand Opening Time</label>
                  <input
                    type="time"
                    value={settingsEdit.grandOpening.time}
                    onChange={e => setSettingsEdit({ ...settingsEdit, grandOpening: { ...settingsEdit.grandOpening, time: e.target.value } })}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" disabled={saving} onClick={async () => {
                    setSaving(true);
                    try {
                      await updateSettingsFirestore(settingsEdit);
                      await reloadDB();
                    } catch (err) {
                      console.error('Failed to save settings:', err);
                    }
                    setSaving(false);
                  }}>
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'bookings' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>All Bookings</h3>
              <div className="cms-list">
                {bookings.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
                    <div style={{ fontSize: '30px', marginBottom: '12px' }}>📭</div>
                    <p>No bookings found</p>
                  </div>
                )}
                {[...bookings]
                  .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                  .map(booking => (
                  <div key={booking.id} className="cms-booking-item">
                    <div>
                      <div className="cms-item-name">{booking.userName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {booking.pondName} • Pegs: {booking.seats.join(', ')} • RM {booking.amount}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        📧 {booking.userId} • ☎️ {booking.userPhone} • 🕒 {toLocalDatetime(booking.createdAt || '') || 'N/A'}
                      </div>
                      <div style={{ fontSize: '11px', marginTop: '4px' }}>
                        <span className={`status-badge st-${booking.status}`}>{booking.status.toUpperCase()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleViewReceipt(booking.receiptData)}>View Receipt</button>
                      {booking.status === 'pending' && (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => handleApproveBooking(booking.id)}>Approve</button>
                          <button className="btn btn-sm btn-danger" disabled={saving} onClick={() => handleRejectBooking(booking.id)}>Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'content' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Homepage Content</h3>
              <div className="cms-form">
                <div className="form-group">
                  <label>Hero Title</label>
                  <input
                    type="text"
                    value={settingsEdit.heroTitle || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, heroTitle: e.target.value })}
                    placeholder="e.g. Kolam Keli Sayang (KKS)"
                  />
                </div>
                <div className="form-group">
                  <label>Hero Subtitle</label>
                  <textarea
                    value={settingsEdit.heroSubtitle || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, heroSubtitle: e.target.value })}
                    placeholder="e.g. 14 Kolam Besar • 65 × 480 Kaki • Alor Setar, Kedah"
                    rows={2}
                  />
                </div>
                <div className="form-group">
                  <label>About Title</label>
                  <input
                    type="text"
                    value={settingsEdit.aboutTitle || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, aboutTitle: e.target.value })}
                    placeholder="e.g. Tentang Kami"
                  />
                </div>
                <div className="form-group">
                  <label>About Content</label>
                  <textarea
                    value={settingsEdit.aboutContent || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, aboutContent: e.target.value })}
                    placeholder="Enter about section content..."
                    rows={4}
                  />
                </div>
                <div className="form-group">
                  <label>CTA (Call-to-Action) Title</label>
                  <input
                    type="text"
                    value={settingsEdit.ctaTitle || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, ctaTitle: e.target.value })}
                    placeholder="e.g. Jangan Tunggu Lama"
                  />
                </div>
                <div className="form-group">
                  <label>CTA Subtitle</label>
                  <textarea
                    value={settingsEdit.ctaSubtitle || ''}
                    onChange={e => setSettingsEdit({ ...settingsEdit, ctaSubtitle: e.target.value })}
                    placeholder="Slot cepat penuh terutamanya hujung minggu..."
                    rows={2}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" disabled={saving} onClick={async () => {
                    setSaving(true);
                    try {
                      await updateSettingsFirestore(settingsEdit);
                      await reloadDB();
                      alert('✅ Homepage content saved successfully!');
                    } catch (err) {
                      console.error('Failed to save content:', err);
                      alert('❌ Failed to save content');
                    }
                    setSaving(false);
                  }}>
                    {saving ? 'Saving...' : 'Save Content'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CMSModal;
