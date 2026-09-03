import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRole, roleChangeBlockReason } from '../src/role-policy.js';

test('normalizes supported roles and fails closed for unknown values', () => {
    assert.equal(normalizeRole(' staff '), 'STAFF');
    assert.equal(normalizeRole('ADMIN'), 'ADMIN');
    assert.equal(normalizeRole('owner'), 'CLIENT');
    assert.equal(normalizeRole(undefined), 'CLIENT');
});

test('only admins may change roles', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'staff-1', callerRole: 'STAFF', targetUid: 'client-1', targetRole: 'CLIENT', requestedRole: 'STAFF',
    }), 'caller-not-admin');
});

test('blocks self changes and changes to existing admins', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'admin-1', targetRole: 'ADMIN', requestedRole: 'STAFF',
    }), 'self-change');
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'admin-2', targetRole: 'ADMIN', requestedRole: 'CLIENT',
    }), 'admin-locked');
});

test('allows admins to manage non-admin users, including promotion to admin', () => {
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'staff-1', targetRole: 'STAFF', requestedRole: 'CLIENT',
    }), null);
    assert.equal(roleChangeBlockReason({
        callerUid: 'admin-1', callerRole: 'ADMIN', targetUid: 'client-1', targetRole: 'CLIENT', requestedRole: 'ADMIN',
    }), null);
});
