import admin from 'firebase-admin';
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
        const role = profile.exists ? String(profile.data()?.role || '').toUpperCase() : 'CLIENT';
        if (role !== 'STAFF' && role !== 'ADMIN') {
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
        const role = profile.exists ? String(profile.data()?.role || '').toUpperCase() : 'CLIENT';
        if (role !== 'ADMIN') {
            return res.status(403).json({ error: 'Forbidden: admin role required' });
        }
        return next();
    } catch (error) {
        console.error('Failed to resolve admin role:', error);
        return res.status(500).json({ error: 'Failed to verify permissions' });
    }
};
