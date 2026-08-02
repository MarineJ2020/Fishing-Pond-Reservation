import React from 'react';
import { MY_PHONE_PREFIXES, phoneRestLength } from '../utils/phone';

interface PhoneNumberFieldProps {
  prefix: string;
  rest: string;
  onPrefixChange: (v: string) => void;
  onRestChange: (v: string) => void;
  label?: string;
  required?: boolean;
  unlimitedDigits?: boolean;
}

/** Malaysia-convention phone input: 01X prefix selector + the rest of the digits. */
const PhoneNumberField: React.FC<PhoneNumberFieldProps> = ({
  prefix,
  rest,
  onPrefixChange,
  onRestChange,
  label = 'Nombor Telefon',
  required,
  unlimitedDigits = false,
}) => {
  const maxLen = phoneRestLength(prefix);
  return (
    <div>
      <label className="form-label">
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <select
          className="form-input"
          style={{ flex: '0 0 88px' }}
          value={prefix}
          onChange={(e) => onPrefixChange(e.target.value)}
          aria-label="Awalan nombor telefon"
        >
          {MY_PHONE_PREFIXES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          type="tel"
          className="form-input"
          style={{ flex: 1 }}
          value={rest}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            onRestChange(unlimitedDigits ? digits : digits.slice(0, maxLen));
          }}
          placeholder={maxLen === 8 ? '1234 5678' : '345 6789'}
          maxLength={unlimitedDigits ? undefined : maxLen}
          inputMode="numeric"
        />
      </div>
    </div>
  );
};

export default PhoneNumberField;
