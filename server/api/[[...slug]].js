// Catch-all Vercel serverless function that forwards all /api/* requests
// to the exported Express app in ../index.js

const app = require('../index');

module.exports = (req, res) => {
  return app(req, res);
};


