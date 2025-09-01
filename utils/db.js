const mongoose = require('mongoose');

let isConnected = 0; // 0 = disconnected, 1 = connecting, 2 = connected

async function dbConnect() {
  if (isConnected === 2) {
    return mongoose.connection;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  if (isConnected === 1) {
    return new Promise((resolve, reject) => {
      if (mongoose.connection.readyState === 1) return resolve(mongoose.connection);
      mongoose.connection.once('connected', () => resolve(mongoose.connection));
      mongoose.connection.once('error', reject);
    });
  }
  try {
    isConnected = 1;
    await mongoose.connect(process.env.DATABASE_URL, {
      // options can be added here if needed
    });
    isConnected = 2;
    return mongoose.connection;
  } catch (err) {
    isConnected = 0;
    throw err;
  }
}

module.exports = dbConnect;
