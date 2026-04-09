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
    const role = user.role || user.claims?.role || (user.custom_claims?.role || 'CLIENT');
    if (role !== 'STAFF' && role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden: staff role required' });
    }
    return next();
};
export const requireAdmin = async (req, res, next) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const role = user.role || user.claims?.role || (user.custom_claims?.role || 'CLIENT');
    if (role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden: admin role required' });
    }
    return next();
};
