const express = require('express');
const app = express();

app.use(express.json());

// Example route
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Vercel!' });
});

// Export as a serverless function
module.exports = app;