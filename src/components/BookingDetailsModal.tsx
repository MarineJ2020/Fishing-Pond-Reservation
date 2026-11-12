import React from 'react';
import { Booking } from '../types';
import BookingDetailContent from './BookingDetailContent';

interface BookingDetailsModalProps {
  isOpen: boolean;
  booking: Booking | null;
  competitionEnded?: boolean;
  competitionDateLabel?: string;
  resultsHidden?: boolean;
  rankLimits?: { minWeightKg?: number | null; maxWeightKg?: number | null } | null;
  onClose: () => void;
}

const BookingDetailsModal: React.FC<BookingDetailsModalProps> = ({ isOpen, booking, competitionEnded, competitionDateLabel, resultsHidden, rankLimits, onClose }) => {
  if (!isOpen || !booking) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ display: 'flex' }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <div className="modal-title">Butiran Tempahan</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <BookingDetailContent
          booking={booking}
          competitionEnded={competitionEnded}
          competitionDateLabel={competitionDateLabel}
          resultsHidden={resultsHidden}
          rankLimits={rankLimits}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

export default BookingDetailsModal;
