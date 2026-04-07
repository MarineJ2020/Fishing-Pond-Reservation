import React, { useState } from 'react';
import { User, Pond, Competition, Prize } from '../types';
import { getDB, setDB, gs } from '../data';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  onUpdateData: (updates: { ponds?: Pond[]; comp?: Competition }) => void;
}

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, user, ponds, comp, onUpdateData }) => {
  const [tab, setTab] = useState<'ponds' | 'competition' | 'settings' | 'bookings'>('ponds');
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [compEdit, setCompEdit] = useState<Competition>(comp);
  const [settingsEdit, setSettingsEdit] = useState(getDB().settings);
  const [newPond, setNewPond] = useState<Partial<Pond>>({ name: '', date: '', desc: '', seats: [], open: true });

  const isStaff = user && (user.email.includes('admin') || user.email.includes('staff'));

  if (!isOpen) return null;

  const handlePondUpdate = (pond: Pond) => {
    const updatedPonds = ponds.map(p => p.id === pond.id ? pond : p);
    onUpdateData({ ponds: updatedPonds });
    setEditingPond(null);
  };

  const handleCompetitionUpdate = () => {
    const db = getDB();
    db.comp = compEdit;
    setDB(db);
    onUpdateData({ comp: compEdit });
  };

  const handleApproveBooking = (bookingId: string) => {
    const booking = getDB().bookings.find(b => b.id === bookingId);
    if (!booking) return;
    // Set status to confirmed, lock seats
    booking.status = 'confirmed';
    booking.seats.forEach(num => {
      const pond = ponds.find(p => p.id === booking.pondId);
      const seat = pond?.seats.find(s => s.num === num);
      if (seat) seat.status = 'booked';
    });
    onUpdateData({ ponds });
  };

  const handleRejectBooking = (bookingId: string) => {
    const booking = getDB().bookings.find(b => b.id === bookingId);
    if (!booking) return;
    // Set status to rejected, free seats
    booking.status = 'rejected';
    booking.seats.forEach(num => {
      const pond = ponds.find(p => p.id === booking.pondId);
      const seat = pond?.seats.find(s => s.num === num);
      if (seat && seat.status === 'pending') seat.status = 'available';
    });
    onUpdateData({ ponds });
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
                    <button className="btn btn-primary" onClick={() => {
                      if (newPond.name && newPond.date && newPond.seats && newPond.seats.length > 0) {
                        const pond: Pond = {
                          id: Math.max(...ponds.map(p => p.id)) + 1,
                          name: newPond.name,
                          date: newPond.date,
                          desc: newPond.desc || '',
                          seats: newPond.seats,
                          open: true
                        };
                        const updatedPonds = [...ponds, pond];
                        onUpdateData({ ponds: updatedPonds });
                        setNewPond({ name: '', date: '', desc: '', seats: [], open: true });
                      }
                    }}>
                      Add Pond
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
                    <button className="btn btn-primary" onClick={() => handlePondUpdate(editingPond)}>
                      Save Changes
                    </button>
                    <button className="btn btn-ghost" onClick={() => setEditingPond(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cms-list">
                  {ponds.map(pond => (
                    <div key={pond.id} className="cms-list-item">
                      <div>
                        <div className="cms-item-name">{pond.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {pond.seats.length} pegs · RM {pond.seats[0]?.price || 0} each · {pond.date} · {pond.open ? '✅ Open' : '❌ Closed'}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setEditingPond(pond)}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
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
                    value={new Date(compEdit.startDate).toISOString().slice(0, 16)}
                    onChange={e => setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })}
                  />
                </div>
                <div className="form-group">
                  <label>End Date & Time</label>
                  <input
                    type="datetime-local"
                    value={new Date(compEdit.endDate).toISOString().slice(0, 16)}
                    onChange={e => setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })}
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
                  <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
                    {compEdit.prizes.map((p: Prize, i: number) => (
                      <div key={i}>Rank {p.rank}: {p.prize}</div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" onClick={handleCompetitionUpdate}>
                    Save Competition
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
                  <label>Hero Logo URL</label>
                  <input
                    type="text"
                    value={settingsEdit.heroLogo}
                    onChange={e => setSettingsEdit({ ...settingsEdit, heroLogo: e.target.value })}
                  />
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
                  <button className="btn btn-primary" onClick={() => {
                    const newDb = getDB();
                    newDb.settings = settingsEdit;
                    setDB(newDb);
                    onUpdateData({});
                  }}>
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'bookings' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Pending Bookings</h3>
              <div className="cms-list">
                {getDB().bookings.filter(b => b.status === 'pending').map(booking => (
                  <div key={booking.id} className="cms-booking-item">
                    <div>
                      <div className="cms-item-name">{booking.userName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {booking.pondName} • Pegs: {booking.seats.join(', ')} • RM {booking.amount}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        📧 {booking.userId} • ☎️ {booking.userPhone}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleViewReceipt(booking.receiptData)}>View Receipt</button>
                      <button className="btn btn-sm btn-primary" onClick={() => handleApproveBooking(booking.id)}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleRejectBooking(booking.id)}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CMSModal;
