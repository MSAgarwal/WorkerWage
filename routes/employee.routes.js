const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employee.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, (req, res, next) => employeeController.getEmployees(req, res, next));
router.post('/', requireAdmin, (req, res, next) => employeeController.createEmployee(req, res, next));
router.put('/:id', requireAdmin, (req, res, next) => employeeController.updateEmployee(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => employeeController.deleteEmployee(req, res, next));

module.exports = router;
