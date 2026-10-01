export const ALLOWED_ROLES = new Set(['CLIENT', 'STAFF', 'COUNTER_STAFF', 'ADMIN', 'SUPER_ADMIN']);
export const STAFF_ROLES = new Set(['STAFF', 'COUNTER_STAFF', 'ADMIN', 'SUPER_ADMIN']);
export const BOOKING_MANAGER_ROLES = new Set(['COUNTER_STAFF', 'ADMIN', 'SUPER_ADMIN']);
export const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export const normalizeRole = (value) => {
    const normalized = String(value || 'CLIENT').trim().toUpperCase();
    return ALLOWED_ROLES.has(normalized) ? normalized : 'CLIENT';
};

export const roleChangeBlockReason = ({ callerUid, callerRole, targetUid, targetRole, requestedRole }) => {
    const normalizedCallerRole = normalizeRole(callerRole);
    const normalizedTargetRole = normalizeRole(targetRole);
    if (!ADMIN_ROLES.has(normalizedCallerRole)) return 'caller-not-admin';
    if (!targetUid || !ALLOWED_ROLES.has(requestedRole)) return 'invalid-request';
    if (callerUid === targetUid) return 'self-change';
    if (normalizedTargetRole === 'SUPER_ADMIN') return 'super-admin-locked';
    if (normalizedTargetRole === 'ADMIN' && normalizedCallerRole !== 'SUPER_ADMIN') return 'admin-locked';
    return null;
};
