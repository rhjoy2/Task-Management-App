// Registration form submission
document.getElementById('registrationForm').addEventListener('submit', (event) => {
  event.preventDefault();

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const phone = document.getElementById('phone').value;
  const password = document.getElementById('password').value;

  const userData = { name, email, phone, password };

  // Make a POST request to the registration endpoint
  fetch('/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(userData)
  })
    .then(response => {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error('Registration failed. Please try again.');
      }
    })
    .then(data => {
      console.log(data);
     alert(JSON.stringify(data));
      // Handle the response from the server
      
      // You can also display a success message on the page or redirect to a different page
    })
    .catch(error => {
      console.error('Error during registration:', error);
      // Display error message
      alert(error.message);
    });
});

// Login form submission
document.getElementById('loginForm').addEventListener('submit', (event) => {
  event.preventDefault();

  const username = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  const loginData = { username, password };

  // Make a POST request to the login endpoint
  fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(loginData)
  })
    .then(response => response.json())
    .then(data => {
      console.log(data);
      // Handle the response from the server
      if (data.message === "Login successful") {
        // Login was successful
        alert('Login successful!');
        window.location.href = '/taskManagement.html';
      
      }
      else {
        // Login failed
      
        alert("Login Failed");
      }
    })
    .catch(error => {
      console.error('Error during login:', error);
      // Handle error
    });
});

