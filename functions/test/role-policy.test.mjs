import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRole, roleChangeBlockReason } from '../src/role-policy.js';

test('normalizes supported roles and fails closed for unknown values', () => {
    assert.equal(normalizeRole(' staff '), 'STAFF');
    assert.equal(normalizeRole('counter_staff'), 'COUNTER_STAFF');
    assert.equal(normalizeRole('ADMIN'), 'ADMIN');
    assert.equal(normalizeRole('super_admin'), 'SUPER_ADMIN');
    assert.equal(normalizeRole('owner'), 'CLIENT');
    assert.equal(normalizeRole(undefined), 'CLIENT');
});

test('only admins may change roles', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'staff-1', callerRole: 'STAFF', targetUid: 'client-1', targetRole: 'CLIENT', requestedRole: 'STAFF',
    }), 'caller-not-admin');
});

test('blocks self changes and non-super-admin changes to existing admins', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'admin-1', targetRole: 'ADMIN', requestedRole: 'STAFF',
    }), 'self-change');
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'admin-2', targetRole: 'ADMIN', requestedRole: 'CLIENT',
    }), 'admin-locked');
});

test('allows admins to manage non-admin users, including promotion to admin or counter staff', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'staff-1', targetRole: 'STAFF', requestedRole: 'CLIENT',
    }), null);
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'client-1', targetRole: 'CLIENT', requestedRole: 'ADMIN',
    }), null);
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'client-2', targetRole: 'CLIENT', requestedRole: 'COUNTER_STAFF',
    }), null);
});

test('admins may create a super admin, but only super admins can manage existing admins', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'client-1', targetRole: 'CLIENT', requestedRole: 'SUPER_ADMIN',
    }), null);
    assert.equal(roleChangeBlockReason({
        callerUid: 'super-1', callerRole: 'SUPER_ADMIN', targetUid: 'admin-1', targetRole: 'ADMIN', requestedRole: 'STAFF',
    }), null);
    assert.equal(roleChangeBlockReason({
        callerUid: 'super-1', callerRole: 'SUPER_ADMIN', targetUid: 'super-2', targetRole: 'SUPER_ADMIN', requestedRole: 'ADMIN',
    }), 'super-admin-locked');
});
