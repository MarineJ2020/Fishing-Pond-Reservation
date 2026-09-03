export const ALLOWED_ROLES = new Set(['CLIENT', 'STAFF', 'ADMIN']);

export const normalizeRole = (value) => {
    const normalized = String(value || 'CLIENT').trim().toUpperCase();
    return ALLOWED_ROLES.has(normalized) ? normalized : 'CLIENT';
};

export const roleChangeBlockReason = ({ callerUid, callerRole, targetUid, targetRole, requestedRole }) => {
    if (normalizeRole(callerRole) !== 'ADMIN') return 'caller-not-admin';
    if (!targetUid || !ALLOWED_ROLES.has(requestedRole)) return 'invalid-request';
    if (callerUid === targetUid) return 'self-change';
    if (normalizeRole(targetRole) === 'ADMIN') return 'admin-locked';
    return null;
};
