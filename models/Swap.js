const mongoose = require('mongoose');

const swapSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedBook: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  offeredBook: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'completed', 'cancelled'],
    default: 'pending'
  },
  message: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  responseMessage: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  meetingLocation: {
    type: String,
    trim: true,
    maxlength: 200
  },
  meetingDate: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
swapSchema.index({ requester: 1 });
swapSchema.index({ owner: 1 });
swapSchema.index({ requestedBook: 1 });
swapSchema.index({ offeredBook: 1 });
swapSchema.index({ status: 1 });
swapSchema.index({ createdAt: -1 });
swapSchema.index({ expiresAt: 1 });

// Compound indexes
swapSchema.index({ requester: 1, status: 1 });
swapSchema.index({ owner: 1, status: 1 });

// Virtual for swap duration
swapSchema.virtual('duration').get(function() {
  if (this.completedAt) {
    return this.completedAt - this.createdAt;
  }
  return Date.now() - this.createdAt;
});

// Static method to find user's swaps
swapSchema.statics.findUserSwaps = function(userId, status = null) {
  const query = {
    $or: [
      { requester: userId },
      { owner: userId }
    ],
    isActive: true
  };

  if (status) {
    query.status = status;
  }

  return this.find(query)
    .populate('requester', 'username firstName lastName avatar rating')
    .populate('owner', 'username firstName lastName avatar rating')
    .populate('requestedBook', 'title author coverImage condition')
    .populate('offeredBook', 'title author coverImage condition')
    .sort({ createdAt: -1 });
};

// Static method to find pending swaps for a user
swapSchema.statics.findPendingSwaps = function(userId) {
  return this.find({
    owner: userId,
    status: 'pending',
    isActive: true,
    expiresAt: { $gt: new Date() }
  })
    .populate('requester', 'username firstName lastName avatar rating')
    .populate('requestedBook', 'title author coverImage condition')
    .populate('offeredBook', 'title author coverImage condition')
    .sort({ createdAt: -1 });
};

// Method to check if swap is expired
swapSchema.methods.isExpired = function() {
  return this.expiresAt < new Date() && this.status === 'pending';
};

// Method to accept swap
swapSchema.methods.accept = function(responseMessage = '', meetingDetails = {}) {
  this.status = 'accepted';
  this.responseMessage = responseMessage;
  if (meetingDetails.location) this.meetingLocation = meetingDetails.location;
  if (meetingDetails.date) this.meetingDate = meetingDetails.date;
  return this.save();
};

// Method to decline swap
swapSchema.methods.decline = function(responseMessage = '') {
  this.status = 'declined';
  this.responseMessage = responseMessage;
  return this.save();
};

// Method to complete swap
swapSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  return this.save();
};

// Method to cancel swap
swapSchema.methods.cancel = function() {
  this.status = 'cancelled';
  return this.save();
};

// Method to check if user can modify this swap
swapSchema.methods.canModify = function(userId) {
  return this.requester.toString() === userId.toString() || 
         this.owner.toString() === userId.toString();
};

// Method to check if user is the owner (can accept/decline)
swapSchema.methods.isOwner = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Method to check if user is the requester
swapSchema.methods.isRequester = function(userId) {
  return this.requester.toString() === userId.toString();
};

// Pre-save middleware to handle book availability
swapSchema.pre('save', async function(next) {
  if (this.isModified('status')) {
    const Book = mongoose.model('Book');
    
    if (this.status === 'accepted') {
      // Mark both books as unavailable
      await Book.findByIdAndUpdate(this.requestedBook, { isAvailable: false });
      await Book.findByIdAndUpdate(this.offeredBook, { isAvailable: false });
    } else if (this.status === 'completed') {
      // Update swap counts and keep books unavailable (they've been swapped)
      await Book.findByIdAndUpdate(this.requestedBook, { $inc: { swapCount: 1 } });
      await Book.findByIdAndUpdate(this.offeredBook, { $inc: { swapCount: 1 } });
      
      // Update user swap counts
      const User = mongoose.model('User');
      await User.findByIdAndUpdate(this.requester, { $inc: { totalSwaps: 1 } });
      await User.findByIdAndUpdate(this.owner, { $inc: { totalSwaps: 1 } });
    } else if (this.status === 'declined' || this.status === 'cancelled') {
      // Make books available again
      await Book.findByIdAndUpdate(this.requestedBook, { isAvailable: true });
      await Book.findByIdAndUpdate(this.offeredBook, { isAvailable: true });
    }
  }
  next();
});

module.exports = mongoose.model('Swap', swapSchema);
