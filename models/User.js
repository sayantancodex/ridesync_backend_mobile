const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  bloodGroup: { type: String, required: true },
  drivingLicenseNumber: { type: String, required: true },
  emergencyNumbers: { type: [String], required: true },
  relativesDetails: { type: String, default: '' },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
