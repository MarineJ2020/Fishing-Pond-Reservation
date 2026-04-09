import React from 'react';

interface BookingApprovedEmailProps {
  bookingRef: string;
  appUrl: string;
}

const BookingApprovedEmail: React.FC<BookingApprovedEmailProps> = ({ bookingRef, appUrl }) => (
  <html>
    <body style={{ fontFamily: 'Inter, sans-serif', color: '#111', margin: 0, padding: 0 }}>
      <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#f8fafc', padding: '32px 0' }}>
        <tbody>
          <tr>
            <td align="center">
              <table width="600" cellPadding={0} cellSpacing={0} style={{ background: '#ffffff', borderRadius: '18px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '32px', textAlign: 'center' }}>
                      <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a' }}>Booking Approved</h1>
                      <p style={{ color: '#475569', marginTop: '16px' }}>Your booking has been approved by our staff.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0 32px 32px' }}>
                      <p>Booking reference:</p>
                      <p style={{ fontWeight: 700, color: '#0f172a' }}>{bookingRef}</p>
                      <p style={{ marginTop: '24px' }}>
                        <a href={appUrl} style={{ display: 'inline-block', background: '#2563eb', color: '#ffffff', padding: '12px 20px', borderRadius: '10px', textDecoration: 'none' }}>
                          View Booking
                        </a>
                      </p>
                      <p style={{ color: '#64748b', marginTop: '24px' }}>Please keep your receipt and bring it on event day.</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </body>
  </html>
);

export default BookingApprovedEmail;
