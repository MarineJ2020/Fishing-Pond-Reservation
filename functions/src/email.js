import { Resend } from 'resend';
import { renderToStaticMarkup } from 'react-dom/server';
const resend = new Resend(process.env.RESEND_API_KEY || '');
export const sendEmail = async (options) => {
    if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY is not configured.');
    }
    return resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'no-reply@fishingpond.app',
        to: options.to,
        subject: options.subject,
        html: options.html,
    });
};
export const renderEmail = (element) => renderToStaticMarkup(element);
