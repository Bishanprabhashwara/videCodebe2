const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  author: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  isbn: {
    type: String,
    trim: true,
    sparse: true // Allows multiple null values but unique non-null values
  },
  genre: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  language: {
    type: String,
    required: true,
    trim: true,
    default: 'English'
  },
  condition: {
    type: String,
    required: true,
    enum: ['New', 'Like New', 'Very Good', 'Good', 'Fair', 'Poor'],
    default: 'Good'
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  coverImage: {
    type: String,
    default: null
  },
  images: [{
    type: String
  }],
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  ownerEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  publishedYear: {
    type: Number,
    min: 1000,
    max: new Date().getFullYear() + 1
  },
  publisher: {
    type: String,
    trim: true,
    maxlength: 100
  },
  pageCount: {
    type: Number,
    min: 1
  },
  location: {
    type: String,
    trim: true,
    maxlength: 100
  },
  viewCount: {
    type: Number,
    default: 0
  },
  swapCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for better query performance
bookSchema.index({ title: 'text', author: 'text', description: 'text' });
bookSchema.index({ owner: 1 });
bookSchema.index({ genre: 1 });
bookSchema.index({ condition: 1 });
bookSchema.index({ language: 1 });
bookSchema.index({ isAvailable: 1, isActive: 1 });
bookSchema.index({ location: 1 });
bookSchema.index({ createdAt: -1 });

// Virtual for book's full display name
bookSchema.virtual('displayName').get(function() {
  return `${this.title} by ${this.author}`;
});

// Static method to find available books
bookSchema.statics.findAvailable = function(filters = {}) {
  return this.find({
    isAvailable: true,
    isActive: true,
    ...filters
  }).populate('owner', 'username firstName lastName location rating');
};

// Static method to search books
bookSchema.statics.searchBooks = function(query, filters = {}) {
  const searchCriteria = {
    $and: [
      { isAvailable: true, isActive: true },
      {
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { author: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
          { tags: { $in: [new RegExp(query, 'i')] } }
        ]
      }
    ]
  };

  if (filters.genre) searchCriteria.$and.push({ genre: filters.genre });
  if (filters.condition) searchCriteria.$and.push({ condition: filters.condition });
  if (filters.language) searchCriteria.$and.push({ language: filters.language });
  if (filters.location) searchCriteria.$and.push({ location: { $regex: filters.location, $options: 'i' } });

  return this.find(searchCriteria)
    .populate('owner', 'username firstName lastName location rating')
    .sort({ createdAt: -1 });
};

// Method to increment view count
bookSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

// Method to check if user can edit this book
bookSchema.methods.canEdit = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Transform output (remove sensitive data)
bookSchema.methods.toJSON = function() {
  const book = this.toObject();
  return book;
};

module.exports = mongoose.model('Book', bookSchema);
