const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  swap: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Swap',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
reviewSchema.index({ reviewer: 1 });
reviewSchema.index({ reviewee: 1 });
reviewSchema.index({ swap: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ createdAt: -1 });

// Compound indexes
reviewSchema.index({ reviewee: 1, isActive: 1 });
reviewSchema.index({ reviewer: 1, reviewee: 1, swap: 1 }, { unique: true });

// Static method to find user's reviews
reviewSchema.statics.findUserReviews = function(userId) {
  return this.find({
    reviewee: userId,
    isActive: true
  })
    .populate('reviewer', 'username firstName lastName avatar')
    .populate('swap', 'requestedBook offeredBook')
    .sort({ createdAt: -1 });
};

// Static method to calculate user's average rating
reviewSchema.statics.calculateUserRating = async function(userId) {
  const result = await this.aggregate([
    {
      $match: {
        reviewee: new mongoose.Types.ObjectId(userId),
        isActive: true
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  return result.length > 0 ? {
    averageRating: Math.round(result[0].averageRating * 10) / 10,
    totalReviews: result[0].totalReviews
  } : {
    averageRating: 0,
    totalReviews: 0
  };
};

// Method to check if user can edit this review
reviewSchema.methods.canEdit = function(userId) {
  return this.reviewer.toString() === userId.toString();
};

// Post-save middleware to update user rating
reviewSchema.post('save', async function() {
  if (this.isModified('rating') || this.isNew) {
    const User = mongoose.model('User');
    const ratingData = await this.constructor.calculateUserRating(this.reviewee);
    
    await User.findByIdAndUpdate(this.reviewee, {
      rating: ratingData.averageRating,
      totalRatings: ratingData.totalReviews
    });
  }
});

// Post-remove middleware to update user rating
reviewSchema.post('remove', async function() {
  const User = mongoose.model('User');
  const ratingData = await this.constructor.calculateUserRating(this.reviewee);
  
  await User.findByIdAndUpdate(this.reviewee, {
    rating: ratingData.averageRating,
    totalRatings: ratingData.totalReviews
  });
});

module.exports = mongoose.model('Review', reviewSchema);
