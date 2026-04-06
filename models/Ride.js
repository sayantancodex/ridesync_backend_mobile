const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sourceCoords: { type: [Number], required: true },
  destCoords: { type: [Number], required: true },
  sourceName: { type: String },
  destName: { type: String },
  routeType: { type: String, default: 'shortest' },
  riders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingRiders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, default: 'waiting' } // waiting, in-progress, completed
}, { timestamps: true });

module.exports = mongoose.model('Ride', rideSchema);
