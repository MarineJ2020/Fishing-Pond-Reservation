import React, { useState, useEffect } from 'react';
import {
  updatePond,
  updateBookingStatus,
  updateSeatStatus,
  updateCompetition,
  updateSettings,
  getSettings,
  createPond,
  deletePond,
  getBookings,
  getPondsWithSeats
} from '../lib/firestore';
import { getDB, setDB, gs } from '../data';
const CMSModal = ({ isOpen, onClose, user, ponds, comp, onUpdateData, reloadDB }) => {
    const [tab, setTab] = useState('ponds');
    const [editingPond, setEditingPond] = useState(null);
    const [compEdit, setCompEdit] = useState(comp);
    const [settingsEdit, setSettingsEdit] = useState({
        qrBank: 'DuitNow / Bank Transfer',
        qrName: 'CastBook Sdn Bhd',
        qrAccNo: '3841-2038-491',
        qrImg: '',
        heroLogo: '',
        whatsapp: 'https://wa.me/60123456789',
        location: 'Alor Setar, Kedah',
        openingHours: {
            days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            timeStart: '06:00',
            timeEnd: '18:00'
        },
        grandOpening: {
            date: new Date().toISOString().slice(0, 10),
            time: '08:00'
        }
    });
    const [newPond, setNewPond] = useState({ name: '', date: '', desc: '', seats: [], open: true, totalSeats: 30, pricePerSeat: 100 });
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(false);
    const isStaff = user && (user.role === 'STAFF' || user.role === 'ADMIN');

    useEffect(() => {
        if (isOpen && isStaff) {
            loadData();
        }
    }, [isOpen, isStaff]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [settings, bookingsData] = await Promise.all([
                getSettings(),
                getBookings(comp?.id)
            ]);
            setSettingsEdit(settings || {
                qrBank: 'DuitNow / Bank Transfer',
                qrName: 'CastBook Sdn Bhd',
                qrAccNo: '3841-2038-491',
                qrImg: '',
                heroLogo: '',
                whatsapp: 'https://wa.me/60123456789',
                location: 'Alor Setar, Kedah',
                openingHours: {
                    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                    timeStart: '06:00',
                    timeEnd: '18:00'
                },
                grandOpening: {
                    date: new Date().toISOString().slice(0, 10),
                    time: '08:00'
                }
            });
            setBookings(bookingsData);
        } catch (error) {
            console.error('Failed to load CMS data:', error);
        } finally {
            setLoading(false);
        }
    };
    if (!isOpen)
        return null;
    const handlePondUpdate = async (pond) => {
        try {
            await updatePond(pond.id.toString(), {
                name: pond.name,
                desc: pond.desc,
                date: pond.date,
                open: pond.open,
                totalSeats: pond.totalSeats || pond.seats?.length || 30,
                pricePerSeat: pond.pricePerSeat || pond.seats?.[0]?.price || 100
            });
            // Reload ponds data
            const updatedPonds = await getPondsWithSeats();
            onUpdateData({ ponds: updatedPonds });
            setEditingPond(null);
            if (reloadDB) await reloadDB();
        } catch (error) {
            console.error('Failed to update pond:', error);
            alert('Failed to update pond. Please try again.');
        }
    };
    const handleCompetitionUpdate = async () => {
        try {
            await updateCompetition(comp.id, {
                name: compEdit.name,
                startDate: compEdit.startDate,
                endDate: compEdit.endDate,
                topN: compEdit.topN,
                prizes: compEdit.prizes
            });
            onUpdateData({ comp: compEdit });
        } catch (error) {
            console.error('Failed to update competition:', error);
            alert('Failed to update competition. Please try again.');
        }
    };
    const handleApproveBooking = async (bookingId) => {
        try {
            await updateBookingStatus(bookingId, 'confirmed');
            // Update seat statuses to booked
            const booking = bookings.find(b => b.id === bookingId);
            if (booking) {
                // Find the pond and seats
                const pond = ponds.find(p => p.id === booking.pondId);
                if (pond) {
                    for (const seatNum of booking.seats) {
                        const seat = pond.seats.find(s => s.num === seatNum);
                        if (seat && seat.id) {
                            await updateSeatStatus(seat.id, 'booked');
                        }
                    }
                }
            }
            // Reload data
            await loadData();
            const updatedPonds = await getPondsWithSeats();
            onUpdateData({ ponds: updatedPonds });
            if (reloadDB) await reloadDB();
        } catch (error) {
            console.error('Failed to approve booking:', error);
            alert('Failed to approve booking. Please try again.');
        }
    };

    const handleRejectBooking = async (bookingId) => {
        try {
            await updateBookingStatus(bookingId, 'rejected');
            // Update seat statuses back to available
            const booking = bookings.find(b => b.id === bookingId);
            if (booking) {
                const pond = ponds.find(p => p.id === booking.pondId);
                if (pond) {
                    for (const seatNum of booking.seats) {
                        const seat = pond.seats.find(s => s.num === seatNum);
                        if (seat && seat.id && seat.status === 'pending') {
                            await updateSeatStatus(seat.id, 'available');
                        }
                    }
                }
            }
            // Reload data
            await loadData();
            const updatedPonds = await getPondsWithSeats();
            onUpdateData({ ponds: updatedPonds });
            if (reloadDB) await reloadDB();
        } catch (error) {
            console.error('Failed to reject booking:', error);
            alert('Failed to reject booking. Please try again.');
        }
    };
    const handleSettingsUpdate = async () => {
        try {
            await updateSettings(settingsEdit);
            alert('Settings updated successfully!');
        } catch (error) {
            console.error('Failed to update settings:', error);
            alert('Failed to update settings. Please try again.');
        }
    };

    const handleCreatePond = async () => {
        try {
            await createPond({
                name: newPond.name,
                desc: newPond.desc,
                date: newPond.date,
                open: newPond.open,
                totalSeats: newPond.totalSeats,
                pricePerSeat: newPond.pricePerSeat
            });
            setNewPond({ name: '', date: '', desc: '', seats: [], open: true, totalSeats: 30, pricePerSeat: 100 });
            const updatedPonds = await getPondsWithSeats();
            onUpdateData({ ponds: updatedPonds });
            alert('Pond created successfully!');
        } catch (error) {
            console.error('Failed to create pond:', error);
            alert('Failed to create pond. Please try again.');
        }
    };

    const handleDeletePond = async (pondId) => {
        if (!confirm('Are you sure you want to delete this pond? This action cannot be undone.')) return;
        try {
            await deletePond(pondId.toString());
            const updatedPonds = await getPondsWithSeats();
            onUpdateData({ ponds: updatedPonds });
            alert('Pond deleted successfully!');
        } catch (error) {
            console.error('Failed to delete pond:', error);
            alert('Failed to delete pond. Please try again.');
        }
    };
    if (!isStaff) {
        return (<div className="cms-modal-overlay" onClick={onClose}>
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
      </div>);
    }
    return (<div className="cms-modal-overlay" onClick={onClose}>
      <div className="cms-modal-content" onClick={e => e.stopPropagation()}>
        <div className="cms-header">
          <h2>CMS Control Panel</h2>
          <button className="cms-close" onClick={onClose}>✕</button>
        </div>

        <div className="cms-tabs">
          <button className={`cms-tab ${tab === 'ponds' ? 'active' : ''}`} onClick={() => setTab('ponds')}>
            🎣 Ponds
          </button>
          <button className={`cms-tab ${tab === 'competition' ? 'active' : ''}`} onClick={() => setTab('competition')}>
            🏆 Competition
          </button>
          <button className={`cms-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            ⚙️ Settings
          </button>
          <button className={`cms-tab ${tab === 'bookings' ? 'active' : ''}`} onClick={() => setTab('bookings')}>
            📋 Bookings
          </button>
        </div>

        <div className="cms-content">
          {tab === 'ponds' && (<div>
              <h3 style={{ marginBottom: '16px' }}>Manage Ponds</h3>
              <div style={{ marginBottom: '20px' }}>
                <h4>Add New Pond</h4>
                <div className="cms-form">
                  <div className="form-group">
                    <label>Pond Name</label>
                    <input type="text" value={newPond.name} onChange={e => setNewPond({ ...newPond, name: e.target.value })}/>
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={newPond.desc} onChange={e => setNewPond({ ...newPond, desc: e.target.value })} rows={3}/>
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={newPond.date} onChange={e => setNewPond({ ...newPond, date: e.target.value })}/>
                  </div>
                  <div className="form-group">
                    <label>Number of Seats</label>
                    <input type="number" value={newPond.totalSeats} onChange={e => setNewPond({ ...newPond, totalSeats: parseInt(e.target.value) || 30 })}/>
                  </div>
                  <div className="form-group">
                    <label>Price per Seat (RM)</label>
                    <input type="number" value={newPond.pricePerSeat} onChange={e => setNewPond({ ...newPond, pricePerSeat: parseInt(e.target.value) || 100 })}/>
                  </div>
                  <div className="form-group">
                    <label>
                      <input type="checkbox" checked={newPond.open} onChange={e => setNewPond({ ...newPond, open: e.target.checked })}/>
                      Visible on homepage/booking page
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button className="btn btn-primary" onClick={handleCreatePond} disabled={!newPond.name || !newPond.date}>
                      Add Pond
                    </button>
                  </div>
                </div>
              </div>

              <h4>Existing Ponds</h4>
              <div className="ponds-list">
                {ponds.map(pond => (<div key={pond.id} className="pond-item">
                    <div className="pond-header">
                      <h5>{pond.name}</h5>
                      <div className="pond-actions">
                        <button className="btn btn-sm" onClick={() => setEditingPond(pond)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeletePond(pond.id)}>Delete</button>
                      </div>
                    </div>
                    <div className="pond-details">
                      <p><strong>Date:</strong> {new Date(pond.date).toLocaleDateString()}</p>
                      <p><strong>Description:</strong> {pond.desc}</p>
                      <p><strong>Seats:</strong> {pond.seats.length} total, {pond.seats.filter(s => s.status === 'available').length} available</p>
                      <p><strong>Price:</strong> RM {pond.seats[0]?.price || 100} per seat</p>
                      <p><strong>Status:</strong> <span style={{ color: pond.open ? 'green' : 'red' }}>{pond.open ? 'Visible' : 'Hidden'}</span></p>
                    </div>
                  </div>))}
              </div>

              {editingPond && (<div className="cms-form" style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
                  <h4>Edit Pond: {editingPond.name}</h4>
                  <div className="form-group">
                    <label>Pond Name</label>
                    <input type="text" value={editingPond.name} onChange={e => setEditingPond({ ...editingPond, name: e.target.value })}/>
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={editingPond.desc} onChange={e => setEditingPond({ ...editingPond, desc: e.target.value })} rows={3}/>
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={editingPond.date.split('T')[0]} onChange={e => setEditingPond({ ...editingPond, date: e.target.value })}/>
                  </div>
                  <div className="form-group">
                    <label>Number of Seats</label>
                    <input type="number" value={editingPond.seats.length} onChange={e => setEditingPond({ ...editingPond, totalSeats: parseInt(e.target.value) || 30 })}/>
                  </div>
                  <div className="form-group">
                    <label>Price per Seat (RM)</label>
                    <input type="number" value={editingPond.seats[0]?.price || 100} onChange={e => setEditingPond({ ...editingPond, pricePerSeat: parseInt(e.target.value) || 100 })}/>
                  </div>
                  <div className="form-group">
                    <label>
                      <input type="checkbox" checked={editingPond.open} onChange={e => setEditingPond({ ...editingPond, open: e.target.checked })}/>
                      Visible on homepage/booking page
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button className="btn btn-primary" onClick={() => handlePondUpdate(editingPond)}>Update Pond</button>
                    <button className="btn btn-secondary" onClick={() => setEditingPond(null)}>Cancel</button>
                  </div>
                </div>)}
            </div>)}

          {tab === 'competition' && (<div>
              <h3 style={{ marginBottom: '16px' }}>Competition Settings</h3>
              <div className="cms-form">
                <div className="form-group">
                  <label>Competition Name</label>
                  <input type="text" value={compEdit.name} onChange={e => setCompEdit({ ...compEdit, name: e.target.value })}/>
                </div>
                <div className="form-group">
                  <label>Start Date & Time</label>
                  <input type="datetime-local" value={new Date(compEdit.startDate).toISOString().slice(0, 16)} onChange={e => setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })}/>
                </div>
                <div className="form-group">
                  <label>End Date & Time</label>
                  <input type="datetime-local" value={new Date(compEdit.endDate).toISOString().slice(0, 16)} onChange={e => setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })}/>
                </div>
                <div className="form-group">
                  <label>Top N Anglers to Display</label>
                  <input type="number" value={compEdit.topN} onChange={e => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 20 })}/>
                </div>

                <div className="form-group">
                  <label>Prize Pool Management</label>
                  <div style={{ marginBottom: '10px' }}>
                    <button className="btn btn-sm" onClick={() => {
                      const newPrize = { rank: compEdit.prizes.length + 1, label: `Rank ${compEdit.prizes.length + 1}`, prize: 'RM 0' };
                      setCompEdit({ ...compEdit, prizes: [...compEdit.prizes, newPrize] });
                    }}>Add Prize</button>
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {compEdit.prizes.map((prize, index) => (
                      <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px', background: 'var(--surface2)', borderRadius: '8px' }}>
                        <span style={{ minWidth: '60px' }}>Rank {prize.rank}:</span>
                        <input
                          type="text"
                          placeholder="Label"
                          value={prize.label}
                          onChange={e => {
                            const newPrizes = [...compEdit.prizes];
                            newPrizes[index].label = e.target.value;
                            setCompEdit({ ...compEdit, prizes: newPrizes });
                          }}
                          style={{ flex: 1 }}
                        />
                        <input
                          type="text"
                          placeholder="Prize"
                          value={prize.prize}
                          onChange={e => {
                            const newPrizes = [...compEdit.prizes];
                            newPrizes[index].prize = e.target.value;
                            setCompEdit({ ...compEdit, prizes: newPrizes });
                          }}
                          style={{ flex: 1 }}
                        />
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            const newPrizes = compEdit.prizes.filter((_, i) => i !== index);
                            setCompEdit({ ...compEdit, prizes: newPrizes });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" onClick={handleCompetitionUpdate}>
                    Save Competition
                  </button>
                  <button className="btn btn-secondary" onClick={() => {
                    if (settingsEdit && compEdit.startDate) {
                      const compDate = new Date(compEdit.startDate).toISOString().split('T')[0];
                      setSettingsEdit({ ...settingsEdit, grandOpening: { ...settingsEdit.grandOpening, date: compDate } });
                      alert('Grand opening date synced with competition start date!');
                    }
                  }}>
                    Sync Grand Opening Date
                  </button>
                </div>
              </div>
            </div>)}

          {tab === 'settings' && (<div>
              <h3 style={{ marginBottom: '16px' }}>Site Settings</h3>
              <div className="cms-form">
                <div className="form-group">
                  <label>Hero Logo URL</label>
                  <input type="text" value={settingsEdit.heroLogo} onChange={e => setSettingsEdit({ ...settingsEdit, heroLogo: e.target.value })}/>
                </div>
                <div className="form-group">
                  <label>WhatsApp Number (for booking button)</label>
                  <input type="text" value={settingsEdit.whatsapp} onChange={e => setSettingsEdit({ ...settingsEdit, whatsapp: e.target.value })}/>
                </div>
                <div className="form-group">
                  <label>Location (for Google Maps)</label>
                  <input type="text" value={settingsEdit.location} onChange={e => setSettingsEdit({ ...settingsEdit, location: e.target.value })}/>
                  <small style={{ color: 'var(--muted)' }}>This address will be used for the embedded Google Map in the "Lokasi & Susun Atur Kolam" section</small>
                </div>
                <div className="form-group">
                  <label>Opening Days</label>
                  <select multiple value={settingsEdit.openingHours.days} onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, days: Array.from(e.target.selectedOptions, o => o.value) } })}>
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
                  <input type="time" value={settingsEdit.openingHours.timeStart} onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, timeStart: e.target.value } })}/>
                </div>
                <div className="form-group">
                  <label>Opening Time End</label>
                  <input type="time" value={settingsEdit.openingHours.timeEnd} onChange={e => setSettingsEdit({ ...settingsEdit, openingHours: { ...settingsEdit.openingHours, timeEnd: e.target.value } })}/>
                </div>
                <div className="form-group">
                  <label>Grand Opening Date</label>
                  <input type="date" value={settingsEdit.grandOpening.date} onChange={e => setSettingsEdit({ ...settingsEdit, grandOpening: { ...settingsEdit.grandOpening, date: e.target.value } })}/>
                </div>
                <div className="form-group">
                  <label>Grand Opening Time</label>
                  <input type="time" value={settingsEdit.grandOpening.time} onChange={e => setSettingsEdit({ ...settingsEdit, grandOpening: { ...settingsEdit.grandOpening, time: e.target.value } })}/>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button className="btn btn-primary" onClick={handleSettingsUpdate}>
                    Save Settings
                  </button>
                </div>
              </div>
            </div>)}

          {tab === 'bookings' && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Pending Bookings</h3>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                  Loading bookings...
                </div>
              ) : (
                <div className="cms-list">
                  {bookings.filter(b => b.status === 'pending').map(booking => (
                    <div key={booking.id} className="cms-booking-item">
                      <div>
                        <div className="cms-item-name">{booking.userName}</div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {booking.pondName} • Pegs: {booking.seats.join(', ')} • RM {booking.amount}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                          📧 {booking.userId} • ☎️ {booking.userPhone}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                          📅 {new Date(booking.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-sm btn-primary" onClick={() => handleViewReceipt(booking.receiptData)}>View Receipt</button>
                        <button className="btn btn-sm btn-primary" onClick={() => handleApproveBooking(booking.id)}>Approve</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleRejectBooking(booking.id)}>Reject</button>
                      </div>
                    </div>
                  ))}
                  {bookings.filter(b => b.status === 'pending').length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                      No pending bookings
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>);
};
export default CMSModal;
