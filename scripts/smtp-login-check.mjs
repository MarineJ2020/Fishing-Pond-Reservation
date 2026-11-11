// Checks a mailbox password against the SMTP server before you store it in the
// email extension. Sends no email and never prints the password.
//   node scripts/smtp-login-check.mjs
import readline from 'node:readline';
import tls from 'node:tls';

const USER = 'hello@kolamkelisayang.com.my';
const HOST = 'mail.kolamkelisayang.com.my';
const PORT = 465;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => { if (s.includes('Password')) process.stdout.write(s); }; // hide typing
rl.question(`Password for ${USER}: `, (pass) => {
  rl.close();
  process.stdout.write('\n');
  console.log(`Server: ${HOST}:${PORT}  User: ${USER}  Password length: ${pass.length}`);

  const socket = tls.connect({ host: HOST, port: PORT, servername: HOST }, () => {
    console.log(`TLS connected. Certificate valid for host: ${socket.authorized ? 'yes' : 'NO - ' + socket.authorizationError}`);
  });
  socket.setEncoding('utf8');
  socket.setTimeout(20000, () => { console.log('Timed out.'); socket.destroy(); });
  socket.on('error', (e) => console.log('Connection error:', e.message));

  let step = 0;
  let buf = '';
  const send = (s) => socket.write(s + '\r\n');
  socket.on('data', (chunk) => {
    buf += chunk;
    if (!/\r?\n$/.test(buf)) return;
    const lines = buf.trim().split(/\r?\n/);
    const last = lines[lines.length - 1];
    buf = '';
    if (/^\d{3}-/.test(last)) return; // multi-line reply not finished
    if (step === 0) { send('EHLO localhost'); step = 1; }
    else if (step === 1) { send('AUTH PLAIN ' + Buffer.from(`\0${USER}\0${pass}`).toString('base64')); step = 2; }
    else if (step === 2) {
      console.log(last.startsWith('235') ? 'LOGIN OK (235) - this password works.' : `LOGIN REJECTED: ${last}`);
      send('QUIT'); step = 3;
    } else socket.end();
  });
});
