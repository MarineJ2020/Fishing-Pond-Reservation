import React from 'react';
import { Booking } from '../types';
import BookingDetailContent from './BookingDetailContent';

interface BookingDetailsModalProps {
  isOpen: boolean;
  booking: Booking | null;
  competitionEnded?: boolean;
  onClose: () => void;
}

const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({ isOpen, booking, competitionEnded, onClose }) => {
  if (!isOpen || !booking) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ display: 'flex' }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <div className="modal-title">Butiran Tempahan</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <BookingDetailContent booking={booking} competitionEnded={competitionEnded} onClose={onClose} />
      </div>
    </div>
  );
};

export default BookingDetailsModal;
