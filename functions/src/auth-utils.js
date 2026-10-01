import admin from 'firebase-admin';
import { ADMIN_ROLES, BOOKING_MANAGER_ROLES, STAFF_ROLES, normalizeRole } from './role-policy.js';
if (!admin.apps.length) {
    admin.initializeApp();
}
export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        req.user = decoded;
        return next();
    }
    catch (error) {
        console.error(error);
        return res.status(401).json({ error: 'Invalid token' });
    }
};
export const requireStaff = async (req, res, next) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const profile = await adminDb.collection('users').doc(user.uid).get();
        const role = profile.exists ? normalizeRole(profile.data()?.role) : 'CLIENT';
        if (!STAFF_ROLES.has(role)) {
            return res.status(403).json({ error: 'Forbidden: staff role required' });
        }
        return next();
    } catch (error) {
        console.error('Failed to resolve staff role:', error);
        return res.status(500).json({ error: 'Failed to verify permissions' });
    }
};
export const requireAdmin = async (req, res, next) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const profile = await adminDb.collection('users').doc(user.uid).get();
        const role = profile.exists ? normalizeRole(profile.data()?.role) : 'CLIENT';
        if (!ADMIN_ROLES.has(role)) {
            return res.status(403).json({ error: 'Forbidden: admin role required' });
        }
        return next();
    } catch (error) {
        console.error('Failed to resolve admin role:', error);
        return res.status(500).json({ error: 'Failed to verify permissions' });
    }
};
export const requireBookingManager = async (req, res, next) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const profile = await adminDb.collection('users').doc(user.uid).get();
        const role = profile.exists ? normalizeRole(profile.data()?.role) : 'CLIENT';
        if (!BOOKING_MANAGER_ROLES.has(role)) {
            return res.status(403).json({ error: 'Forbidden: counter staff role required' });
        }
        return next();
    } catch (error) {
        console.error('Failed to resolve booking manager role:', error);
        return res.status(500).json({ error: 'Failed to verify permissions' });
    }
};
