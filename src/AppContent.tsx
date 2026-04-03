import React from 'react';
import './styles.css';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import PondsGrid from './components/PondsGrid';
import BookingSidebar from './components/BookingSidebar';
import SeatMap from './components/SeatMap';
import BookingForm from './components/BookingForm';
import LiveResults from './components/LiveResults';
import AuthModal from './components/AuthModal';
import Toast from './components/Toast';
import { useBooking } from './context/BookingContext';
import { useUI } from './context/UIContext';
import { useNavigation } from './hooks/useNavigation';
import { useAuth } from './hooks/useAuth';
import { fmt } from './utils';

const AppContent: React.FC = () => {
  const { db, selectedPond, selectedSeats, payType, receiptData, user, setPond, toggleSeat, setPayType, setReceiptData, submitBooking } = useBooking();
  const { addToast, setAuthModalOpen, authModalOpen } = useUI();
  const { currentSection, goToSection, goToBook, goHome, goToMyBookings, goToConfirmed } = useNavigation();
  const { login, register, logout } = useAuth();

  const handleSelectPond = (id: number) => {
    setPond(id);
    goToBook();
  };

  const handleSubmitBooking = async () => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (!selectedSeats.length) {
      addToast('Select at least one peg', 'error');
      return;
    }
    if (!receiptData) {
      addToast('Upload your payment receipt', 'error');
      return;
    }
    if (!selectedPond) return;

    const pond = db.ponds.find(p => p.id === selectedPond);
    if (!pond) return;

    const booking = await submitBooking(pond);
    if (booking) {
      addToast('Booking submitted! Staff will confirm via email.', 'success');
      goToConfirmed();
    }
  };

  const handleReceiptChange = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setReceiptData(e.target?.result as string, file);
    };
    reader.readAsDataURL(file);
  };

  const handleLogin = (email: string, pass: string) => {
    if (login(email, pass)) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
  };

  const handleRegister = (name: string, email: string, phone: string, pass: string) => {
    if (register(name, email, phone, pass)) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
  };

  const handleLogout = () => {
    logout();
    goHome();
  };

  const userBookings = user ? db.bookings.filter(b => b.userId === user.email) : [];

  const renderSection = () => {
    switch (currentSection) {
      case 'home':
        return (
          <>
            <Hero ponds={db.ponds} bookings={db.bookings} onSectionChange={goToSection} />
            <PondsGrid ponds={db.ponds} onSelectPond={handleSelectPond} />
          </>
        );
      case 'book':
        const bookedPond = selectedPond ? db.ponds.find(p => p.id === selectedPond) : null;
        return (
          <div className="booking-layout">
            <BookingSidebar ponds={db.ponds} selectedPond={selectedPond} onSelectPond={handleSelectPond} />
            {bookedPond && <SeatMap pond={bookedPond} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} />}
            {bookedPond && (
              <BookingForm
                user={user}
                pond={bookedPond}
                selectedSeats={selectedSeats}
                payType={payType}
                receiptData={receiptData}
                onSetPayType={setPayType}
                onHandleReceiptChange={handleReceiptChange}
                onClearReceipt={() => setReceiptData(null, null)}
                onSubmitBooking={handleSubmitBooking}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            )}
          </div>
        );
      case 'live':
        return <LiveResults comp={db.comp} scores={db.scores} ponds={db.ponds} bookings={db.bookings} user={user} />;
      case 'mybookings':
        if (!user) {
          setAuthModalOpen(true);
          return null;
        }
        return (
          <div className="bookings-page">
            <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div className="section-title" style={{ fontSize: '30px' }}>My Bookings</div>
                <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{user.name} ({user.email})</div>
              </div>
              <button className="btn btn-primary" onClick={() => goToBook()}>
                <i className="fa-solid fa-plus"></i> New Booking
              </button>
            </div>
            {userBookings.length ? userBookings.map(b => (
              <div key={b.id} className="card booking-row">
                <div>
                  <div className="booking-id">{b.id}</div>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{fmt(b.createdAt)}</div>
                </div>
                <div>
                  <div className="booking-pond">{b.pondName}</div>
                  <div className="booking-meta">
                    📍 Pegs: {b.seats.join(', ')} &nbsp;|&nbsp; 💰 RM {b.amount} &nbsp;|&nbsp; {b.paymentType === 'deposit' ? 'Deposit' : 'Full'}
                  </div>
                </div>
                <div>
                  <span className={`status-badge st-${b.status}`}>
                    <i className={`fa-solid fa-${b.status === 'pending' ? 'clock' : b.status === 'confirmed' ? 'check-circle' : 'xmark-circle'}`}></i>{' '}
                    {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                  </span>
                </div>
              </div>
            )) : (
              <div className="empty-state">
                <span className="empty-icon">🎣</span>
                <div className="empty-text">
                  No bookings yet. <a onClick={() => goToBook()} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Book a peg</a> to get started.
                </div>
              </div>
            )}
          </div>
        );
      case 'confirmed':
        const lastBooking = db.bookings[0];
        return (
          <div className="confirm-page">
            <div className="confirm-icon">🎣</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>BOOKING SUBMITTED</div>
            <div className="confirm-id">{lastBooking?.id || 'CB1234567'}</div>
            <div className="confirm-detail">
              {lastBooking ? (
                <>
                  <strong>{lastBooking.pondName}</strong><br />
                  Pegs: {lastBooking.seats.join(', ')}<br />
                  Amount: RM {lastBooking.amount} ({lastBooking.paymentType === 'deposit' ? '50% deposit' : 'full payment'})<br />
                  <br />
                  Booking is <strong>pending verification</strong>.<br />
                  Staff will confirm via email to <strong>{lastBooking.userId}</strong>.
                </>
              ) : (
                <>
                  <strong>Pond Name</strong><br />
                  Pegs: 1, 2<br />
                  Amount: RM 100 (full payment)<br />
                  <br />
                  Booking is <strong>pending verification</strong>.<br />
                  Staff will confirm via email.
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '28px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => goToMyBookings()}>View My Bookings</button>
              <button className="btn btn-ghost" onClick={() => goHome()}>Back to Home</button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Navbar
        user={user}
        currentSection={currentSection}
        onSectionChange={goToSection}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenCMS={() => addToast('CMS not implemented yet', 'info')}
        onLogout={handleLogout}
      />
      <div className={`section ${currentSection === 'home' ? 'active' : ''}`} id="section-home">
        {renderSection()}
      </div>
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
      <Toast />
    </>
  );
};

export default AppContent;