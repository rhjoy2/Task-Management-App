// Function to get all tasks
function getTasks() {
    fetch('/tasks')
      .then(response => response.json())
      .then(tasks => {
        const taskList = document.getElementById('taskList');
  
        // Clear the task list
        taskList.innerHTML = '';
  
        // Loop through the tasks and create HTML elements for each task
        tasks.forEach(task => {
          const taskDiv = document.createElement('div');
          taskDiv.classList.add('task');
  
          const nameHeading = document.createElement('h3');
          nameHeading.textContent = task.name;
  
          const descriptionParagraph = document.createElement('p');
          descriptionParagraph.textContent = task.description;
  
          const dueDateParagraph = document.createElement('p');
          dueDateParagraph.textContent = 'Due Date: ' + task.dueDate;
  
          const priorityParagraph = document.createElement('p');
          priorityParagraph.textContent = 'Priority: ' + task.priority;

          const assignedUserParagraph = document.createElement('p');
          assignedUserParagraph.textContent = 'Assigned to: ' + task.assignedUser;
  
          taskDiv.appendChild(nameHeading);
          taskDiv.appendChild(descriptionParagraph);
          taskDiv.appendChild(dueDateParagraph);
          taskDiv.appendChild(priorityParagraph);
          taskDiv.appendChild(assignedUserParagraph);
  
          taskList.appendChild(taskDiv);
        });
      })
      .catch(error => console.error('Error fetching tasks:', error));
  }
  
  // Function to add a new task
  function addTask(event) {
    event.preventDefault();
  
    const form = event.target;
    const name = form.elements['name'].value;
    const description = form.elements['description'].value;
    const dueDate = form.elements['dueDate'].value;
    const priority = form.elements['priority'].value;
    const assignedUser = form.elements['assignedUser'].value;
  
    const task = { name, description, dueDate, priority, assignedUser };
  
    fetch('/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    })
      .then(response => response.json())
      .then(newTask => {
        // Reset the form
        form.reset();
  
        // Display the newly added task
        const taskList = document.getElementById('taskList');
  
        const taskDiv = document.createElement('div');
        taskDiv.classList.add('task');
  
        const nameHeading = document.createElement('h3');
        nameHeading.textContent = newTask.name;
  
        const descriptionParagraph = document.createElement('p');
        descriptionParagraph.textContent = newTask.description;
  
        const dueDateParagraph = document.createElement('p');
        dueDateParagraph.textContent = 'Due Date: ' + newTask.dueDate;
  
        const priorityParagraph = document.createElement('p');
        priorityParagraph.textContent = 'Priority: ' + newTask.priority;

        const assignedUserParagraph = document.createElement('p');
        assignedUserParagraph.textContent = 'Assigned to: ' + newTask.assignedUser;
  
        taskDiv.appendChild(nameHeading);
        taskDiv.appendChild(descriptionParagraph);
        taskDiv.appendChild(dueDateParagraph);
        taskDiv.appendChild(priorityParagraph);
        taskDiv.appendChild(assignedUserParagraph);

        taskList.appendChild(taskDiv);
      })
      .catch(error => console.error('Error adding task:', error));
  }
  
  // Event listener for the form submission
  const addTaskForm = document.getElementById('addTaskForm');
  addTaskForm.addEventListener('submit', addTask);
  
  // Fetch tasks when the page loads
  window.addEventListener('load', getTasks);