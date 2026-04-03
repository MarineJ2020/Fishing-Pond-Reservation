import React, { useState } from 'react';
import { User, Pond, Competition, Prize } from '../types';
import { getDB } from '../data';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  onUpdateData: (updates: { ponds?: Pond[]; comp?: Competition }) => void;
}

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, user, ponds, comp, onUpdateData }) => {
  const [tab, setTab] = useState<'ponds' | 'competition' | 'bookings'>('ponds');
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [compEdit, setCompEdit] = useState<Competition>(comp);

  const isStaff = user && (user.email.includes('admin') || user.email.includes('staff'));

  if (!isOpen) return null;

  const handlePondUpdate = (pond: Pond) => {
    const updatedPonds = ponds.map(p => p.id === pond.id ? pond : p);
    onUpdateData({ ponds: updatedPonds });
    setEditingPond(null);
  };

  const handleCompetitionUpdate = () => {
    onUpdateData({ comp: compEdit });
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
                          {pond.seats.length} pegs · {pond.date} · {pond.open ? '✅ Open' : '❌ Closed'}
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
                      <button className="btn btn-sm btn-primary">Confirm</button>
                      <button className="btn btn-sm btn-danger">Reject</button>
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
