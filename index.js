const express = require('express');
const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const User = require('./models/User');
const Ride = require('./models/Ride');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 5000;
const JWT_SECRET = 'supersecretkey_ride_buddy';
const MONGODB_URI = 'mongodb+srv://sayantanpatra68_db_user:sgGKawr9oWcvoMNc@ridesync.rriv0o6.mongodb.net/?appName=ridesync';

// Middleware
app.use(express.json());
app.use(cors());

// Connect to MongoDB
if (!MONGODB_URI) {
  console.error("CRITICAL: MONGODB_URI is not defined in .env file");
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Mobile Server: Connected to MongoDB'))
    .catch(err => console.error('❌ Mobile Server: MongoDB connection error:', err));
}

// --- API ROUTES ---

// 1. Auth: Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, bloodGroup, drivingLicenseNumber, emergencyNumbers, relativesDetails } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name, email, password: hashedPassword, bloodGroup,
      drivingLicenseNumber, emergencyNumbers, relativesDetails
    });

    await newUser.save();
    const token = jwt.sign({ userId: newUser._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: newUser._id, name: newUser.name, email: newUser.email } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', details: error.message });
  }
});

// 2. Auth: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(200).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Middleware: Authenticate
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// 3. Location Update (REST)
app.post('/api/auth/location', authenticate, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await User.findByIdAndUpdate(req.user.userId, { lat, lng });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Error updating location' });
  }
});

// 4. Ride: Create
app.post('/api/rides/create', authenticate, async (req, res) => {
  try {
    const { sourceCoords, destCoords, sourceName, destName, routeType } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const newRide = new Ride({
      code, creator: req.user.userId, sourceCoords, destCoords,
      sourceName, destName, routeType, riders: [req.user.userId]
    });

    await newRide.save();
    res.status(201).json({ message: 'Ride created', ride: newRide });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create ride' });
  }
});

// 5. Ride: Join Request
app.post('/api/rides/join', authenticate, async (req, res) => {
    try {
      const { code } = req.body;
      const ride = await Ride.findOne({ code: code.toUpperCase() });
      if (!ride) return res.status(404).json({ message: 'Ride not found' });
  
      if (ride.creator.toString() === req.user.userId || ride.riders.includes(req.user.userId)) {
        return res.status(200).json({ message: 'Already a member', ride });
      }
  
      if (!ride.pendingRiders.includes(req.user.userId)) {
        ride.pendingRiders.push(req.user.userId);
        await ride.save();
        io.to(code.toUpperCase()).emit('member-request', { userId: req.user.userId });
      }
      res.status(200).json({ message: 'Request sent to Admin', ride });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
});

// 6. Ride: Details
app.get('/api/rides/:code', authenticate, async (req, res) => {
    try {
      const ride = await Ride.findOne({ code: req.params.code.toUpperCase() })
        .populate('riders', 'name email lat lng')
        .populate('pendingRiders', 'name email');
      if (!ride) return res.status(404).json({ message: 'Ride not found' });
      
      // Zero-Crash Filter: Remove any null users that failed to populate
      ride.riders = ride.riders.filter(r => r !== null);
      ride.pendingRiders = ride.pendingRiders.filter(r => r !== null);
      
      res.status(200).json(ride);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
});

// 6a. Admin: Approve a Rider
app.post('/api/rides/approve', authenticate, async (req, res) => {
  try {
    const { code, userId } = req.body;
    const ride = await Ride.findOne({ code: code.toUpperCase() });
    
    if (!ride || ride.creator.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Only Admin can approve' });
    }

    // Move from pending to riders
    ride.pendingRiders = ride.pendingRiders.filter(id => id.toString() !== userId);
    if (!ride.riders.includes(userId)) {
      ride.riders.push(userId);
    }
    await ride.save();

    io.to(code.toUpperCase()).emit('member-approved', { userId });
    res.status(200).json({ message: 'Rider approved' });
  } catch (error) {
    res.status(500).json({ message: 'Approval failed' });
  }
});

// 6b. Admin: Kick a Rider
app.post('/api/rides/kick', authenticate, async (req, res) => {
  try {
    const { code, userId } = req.body;
    const ride = await Ride.findOne({ code: code.toUpperCase() });
    
    if (!ride || ride.creator.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Only Admin can kick' });
    }

    ride.riders = ride.riders.filter(id => id.toString() !== userId);
    ride.pendingRiders = ride.pendingRiders.filter(id => id.toString() !== userId);
    await ride.save();

    io.to(code.toUpperCase()).emit('member-kicked', { userId });
    res.status(200).json({ message: 'Rider kicked' });
  } catch (error) {
    res.status(500).json({ message: 'Kick failed' });
  }
});

// 7. Admin: Start Ride
app.post('/api/rides/start', authenticate, async (req, res) => {
    try {
      const { code } = req.body;
      const ride = await Ride.findOne({ code: code.toUpperCase() });
      if (!ride || ride.creator.toString() !== req.user.userId) {
        return res.status(403).json({ message: 'Only Admin can start the ride' });
      }
      ride.status = 'in-progress';
      await ride.save();
      io.to(code.toUpperCase()).emit('ride-started', { code });
      res.status(200).json({ message: 'Ride started' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to start ride' });
    }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log('Mobile User Connected:', socket.id);
  
    socket.on('join-ride', (rideCode) => {
      const upperCode = rideCode.toUpperCase();
      socket.join(upperCode);
      console.log(`User ${socket.id} joined ride: ${upperCode}`);
    });
  
    socket.on('update-location', ({ rideCode, userId, name, lat, lng }) => {
      io.to(rideCode.toUpperCase()).emit('location-updated', { userId, name, lat, lng });
    });
  
    socket.on('sos-alert', ({ rideCode, userId, name }) => {
      io.to(rideCode.toUpperCase()).emit('sos-triggered', { userId, name });
    });
  
    socket.on('pause-ride', async ({ rideCode, isPaused }) => {
      try {
        const upperCode = rideCode.toUpperCase();
        await Ride.findOneAndUpdate({ code: upperCode }, { status: isPaused ? 'paused' : 'in-progress' });
        io.to(upperCode).emit('ride-paused', { isPaused });
        console.log(`Ride ${upperCode} ${isPaused ? 'paused' : 'resumed'}`);
      } catch (err) {}
    });

    socket.on('stop-ride', async ({ rideCode }) => {
      try {
        const upperCode = rideCode.toUpperCase();
        await Ride.findOneAndUpdate({ code: upperCode }, { status: 'completed' });
        io.to(upperCode).emit('ride-stopped');
        console.log(`Ride ${upperCode} stopped/completed`);
      } catch (err) {}
    });

    socket.on('admin-help', ({ rideCode, name }) => {
      io.to(rideCode.toUpperCase()).emit('admin-help-received', { name });
    });
  
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
});

// Root Health Check
app.get('/', (req, res) => {
  res.send('Ride Buddy Mobile Server is RUNNING 🚀');
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Independent Mobile Server running on port ${PORT}`);
});
