const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
// const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const settingsRoutes = require('./routes/settings');
const { run } = require('./database/connection');

const app = express();
const PORT = process.env.PORT || 5000;

// Simple HTTP server - no SSL certificates needed

// Trust proxy for rate limiting
// app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Rate limiting - COMMENTED OUT FOR DEVELOPMENT
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // limit each IP to 100 requests per windowMs
//   standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//   legacyHeaders: false, // Disable the `X-RateLimit-*` headers
//   keyGenerator: (req) => {
//     return req.ip; // Use IP address as key
//   }
// });
// app.use(limiter);

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // In production, allow all Vercel domains and specific frontend URL
    if (process.env.NODE_ENV === 'production') {
      // Allow specific frontend URL
      if (origin === process.env.FRONTEND_URL) return callback(null, true);
      
      // Allow all Vercel domains
      if (origin.endsWith('.vercel.app')) return callback(null, true);
    } else {
      // Development origins
      const devOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://192.168.100.9:3000'
      ];
      if (devOrigins.includes(origin)) return callback(null, true);
    }
    
    console.log(`CORS blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Explicitly handle preflight
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/settings', settingsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Create HTTP server (simple, no SSL)
const httpServer = http.createServer(app);

// Start HTTP server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 Server accessible at:`);
  console.log(`   - HTTP: http://localhost:${PORT}`);
  console.log(`   - HTTP: http://192.168.100.9:${PORT}`);

  // Ensure barcode column exists (simple migration)
  run(`ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(255) UNIQUE`).catch((e) => {
    console.error('Failed ensuring barcode column', e.message);
  });
});