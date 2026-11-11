// Shared helpers for the staff-account scripts: the CSV sheet (opens in Excel)
// lives in /staff-accounts/ at the project root, which is git-ignored because it
// holds plaintext passwords.
import fs from 'node:fs';
import path from 'node:path';

export const SHEET_DIR = path.resolve(import.meta.dirname, '../../staff-accounts');
export const SHEET_FILE = path.join(SHEET_DIR, 'staff-accounts.csv');
export const DOMAIN = 'kolamkelisayang.com.my';
export const COLUMNS = ['No', 'Email', 'Password', 'Nama', 'Peranan', 'Mailbox cPanel', 'Akaun KKS', 'Email disahkan'];

const esc = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const writeSheet = (rows) => {
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  const lines = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => esc(row[c])).join(','))];
  fs.writeFileSync(SHEET_FILE, '﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM so Excel reads UTF-8
};

const parseLine = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
};

export const readSheet = () => {
  if (!fs.existsSync(SHEET_FILE)) throw new Error(`Sheet not found: ${SHEET_FILE}. Run: node scripts/staff-accounts/generate-sheet.mjs`);
  const [header, ...lines] = fs.readFileSync(SHEET_FILE, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = parseLine(header);
  return lines.map((line) => Object.fromEntries(parseLine(line).map((value, i) => [cols[i], value])));
};

export const flag = (name) => process.argv.includes(name);
