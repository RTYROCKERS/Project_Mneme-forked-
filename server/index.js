require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const errorHandler = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth');
const topicRoutes = require('./src/routes/topics');
const resourceRoutes = require('./src/routes/resources');
const conceptRoutes = require('./src/routes/concepts');
const masteryRoutes = require('./src/routes/mastery');
const recommendationRoutes = require('./src/routes/recommendations');
const contentRoutes = require('./src/routes/content');
const profileRoutes = require('./src/routes/profile');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & middleware
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/concepts', conceptRoutes);
app.use('/api/mastery', masteryRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/profile', profileRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Mneme server running on http://localhost:${PORT}`);
});

module.exports = app;
