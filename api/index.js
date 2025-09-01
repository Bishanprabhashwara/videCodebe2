const serverless = require('serverless-http');
const app = require('../app');
const dbConnect = require('../utils/db');

const handler = serverless(app);

module.exports = async (req, res) => {
  try {
    await dbConnect();
  } catch (err) {
    console.error('Database connection error:', err);
  }
  return handler(req, res);
};
