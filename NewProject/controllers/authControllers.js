const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = (req, res, next) => {
    const { name, email, phone, password } = req.body;
  
    User.findOne({ $or: [{ email: email }, { phone: phone }] })
      .then(existingUser => {
        if (existingUser) {
          // User with the same email or phone already exists
          return res.json({
            message: 'Account already exists with that email or phone.'
          });
        }
  
        bcrypt.hash(password, 10, (err, hashedPass) => {
          if (err) {
            return res.json({
              error: err
            });
          }
  
          const newUser = new User({
            name: name,
            email: email,
            phone: phone,
            password: hashedPass
          });
  
          newUser.save()
            .then(user => {
              res.json({
                message: 'User added successfully!'
              });
            })
            .catch(error => {
              res.json({
                message: 'An error occurred while saving the user.'
              });
            });
        });
      })
      .catch(error => {
        res.json({
          message: 'An error occurred while checking for existing user.'
        });
      });
  };
  

  const login = (req, res, next) => {
    const username = req.body.username;
    const password = req.body.password;
  
    User.findOne({ $or: [{ email: username }, { phone: username }] })
      .then(user => {
        if (user) {
          bcrypt.compare(password, user.password, function(err, result) {
            if (err) {
              res.json({
                error: err
              });
            }
            if (result) {
              let token = jwt.sign({ name: user.name }, 'verySecretValue', { expiresIn: '1h' });
              res.json({
                message: "Login successful",
                token
              });
            } else {
              res.json({
                message: 'Password does not match!'
              });
            }
          });
        } else {
          res.json({
            message: 'No User Found!'
          });
        }
      })
      .catch(error => {
        res.json({
          message: 'An error occurred while finding the user.'
        });
      });
  };
  
module.exports = {
    register, login
}