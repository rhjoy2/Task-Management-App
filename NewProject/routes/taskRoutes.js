const express = require('express');
const router = express.Router();
const taskControllers = require('../controllers/taskControllers');

// Get all tasks
router.get('/', taskControllers.getAllTasks);

// Create a new task
router.post('/', taskControllers.createTask);

// Get a single task
router.get('/:taskId', taskControllers.getTaskById);

// Update a task
router.put('/:taskId', taskControllers.updateTask);

// Delete a task
router.delete('/:taskId', taskControllers.deleteTask);

module.exports = router;
