const Task = require('../models/task');
const User = require('../models/user');

// Get all tasks
exports.getAllTasks = async (req, res) => {
  try {
    const tasks = await Task.find().populate('name');
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

// Create a new task
// Create a new task
exports.createTask = async (req, res) => {
  try {
    const { name, description, dueDate, priority, assignedUser } = req.body;
    const task = new Task({ name, description, dueDate, priority, assignedUser });
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
};


// Get a single task
exports.getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
};

// Update a task
exports.updateTask = async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const { name, description, dueDate, priority, assignedUser, progress } = req.body;

    let updatedAssignedUser = null;
    if (assignedUser) {
      // Find the user by their name
      const user = await User.findOne({ name: assignedUser });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      updatedAssignedUser = user.name;
    } else {
      // If assignedUser is not provided, retrieve the existing assignedUser value
      const existingTask = await Task.findById(taskId);
      if (existingTask) {
        updatedAssignedUser = existingTask.assignedUser;
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { name, description, dueDate, priority, assignedUser: updatedAssignedUser, progress },
      { new: true }
    );

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
};






// Delete a task
exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
};
