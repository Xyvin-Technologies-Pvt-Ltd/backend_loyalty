const express = require('express');
const router = express.Router();
const { authorizePermission } = require('../../middlewares/auth/auth');
const { createAuditMiddleware } = require('../audit');
const validators = require('./sub_admin.validators');
const {
    createSubAdmin,
    getAllSubAdmins,
    getSubAdminById,
    updateSubAdmin,
    deleteSubAdmin,
    resetPassword
} = require('./sub_admin.controller');

// Create audit middleware for the sub_admin module
const subAdminAudit = createAuditMiddleware('sub_admin');

// Create new sub-admin
router.post('/',
    authorizePermission('MANAGE_SUB_ADMINS'),
    subAdminAudit.captureResponse(),
    subAdminAudit.adminAction('create_sub_admin', {
        description: 'Admin created a new sub-admin',
        targetModel: 'SubAdmin',
        details: req => req.body
    }),
    createSubAdmin
);

// Get all sub-admins
router.get('/',
    authorizePermission('VIEW_SUB_ADMINS'),
    subAdminAudit.adminAction('list_sub_admins', {
        description: 'User viewed all sub-admins',
        targetModel: 'SubAdmin'
    }),
    getAllSubAdmins
);

// Get sub-admin by ID
router.get('/:id',
    authorizePermission('VIEW_SUB_ADMINS'),
    subAdminAudit.adminAction('view_sub_admin', {
        description: 'User viewed a sub-admin',
        targetModel: 'SubAdmin',
        targetId: req => req.params.id
    }),
    getSubAdminById
);

// Update sub-admin
router.put('/:id',
    authorizePermission('MANAGE_SUB_ADMINS'),
    subAdminAudit.captureResponse(),
    subAdminAudit.adminAction('update_sub_admin', {
        description: 'Admin updated a sub-admin',
        targetModel: 'SubAdmin',
        targetId: req => req.params.id,
        details: req => req.body
    }),
    updateSubAdmin
);

// Delete sub-admin
router.delete('/:id',
    authorizePermission('MANAGE_SUB_ADMINS'),
    subAdminAudit.captureResponse(),
    subAdminAudit.adminAction('delete_sub_admin', {
        description: 'Admin deleted a sub-admin',
        targetModel: 'SubAdmin',
        targetId: req => req.params.id
    }),
    deleteSubAdmin
);

// Reset password
router.put('/:id/reset-password',
    authorizePermission('MANAGE_SUB_ADMINS'),
    subAdminAudit.captureResponse(),
    subAdminAudit.adminAction('reset_sub_admin_password', {
        description: 'Admin reset sub-admin password',
        targetModel: 'SubAdmin',
        targetId: req => req.params.id
    }),
    resetPassword
);

module.exports = router; 