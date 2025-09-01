const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Book = require('../models/Book');
const User = require('../models/User');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/books
// @desc    Get all available books with search and filters
// @access  Public
router.get('/', [
  query('search').optional().trim().escape(),
  query('genre').optional().trim().escape(),
  query('condition').optional().isIn(['New', 'Like New', 'Very Good', 'Good', 'Fair', 'Poor']),
  query('language').optional().trim().escape(),
  query('location').optional().trim().escape(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { search, genre, condition, language, location, page = 1, limit = 12 } = req.query;
    const skip = (page - 1) * limit;

    let books;
    let total;

    if (search) {
      // Search with filters
      const filters = {};
      if (genre) filters.genre = genre;
      if (condition) filters.condition = condition;
      if (language) filters.language = language;
      if (location) filters.location = location;

      books = await Book.searchBooks(search, filters)
        .skip(skip)
        .limit(limit);

      total = await Book.searchBooks(search, filters).countDocuments();
    } else {
      // Get all with filters
      const filters = { isAvailable: true, isActive: true };
      if (genre) filters.genre = genre;
      if (condition) filters.condition = condition;
      if (language) filters.language = language;
      if (location) filters.location = { $regex: location, $options: 'i' };

      books = await Book.find(filters)
        .populate('owner', 'username firstName lastName location rating')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      total = await Book.countDocuments(filters);
    }

    res.json({
      success: true,
      data: {
        books,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalBooks: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get books error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching books'
    });
  }
});

// @route   GET /api/books/:id
// @desc    Get single book by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id)
      .populate('owner', 'username firstName lastName location rating totalSwaps avatar bio');

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book not found'
      });
    }

    // Increment view count
    await book.incrementViewCount();

    res.json({
      success: true,
      data: { book }
    });
  } catch (error) {
    console.error('Get book error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching book'
    });
  }
});

// @route   POST /api/books
// @desc    Add a new book (validations disabled for now)
// @access  Public
router.post('/', [optionalAuth], async (req, res) => {
  try {
    console.log('Book creation request received:', {
      userId: req.user?._id,
      body: req.body
    });

    const {
      title,
      author,
      genre,
      condition,
      language = 'English',
      description,
      isbn,
      publishedYear,
      publisher,
      pageCount,
      tags,
      coverImage,
      images,
      email
    } = req.body;

    console.log('Extracted book data:', {
      title, author, genre, condition, email
    });

    // Normalize/Default values so creation succeeds
    const normalizeCondition = (val) => {
      if (!val) return 'Good';
      const map = {
        excellent: 'Very Good',
        'very good': 'Very Good',
        good: 'Good',
        fair: 'Fair',
        poor: 'Poor',
        new: 'New',
        'like new': 'Like New'
      };
      const key = String(val).toLowerCase();
      return map[key] || 'Good';
    };

    const safeTitle = (req.body.title && String(req.body.title).trim()) || 'Untitled';
    const safeAuthor = (req.body.author && String(req.body.author).trim()) || 'Unknown';
    const safeGenre = (req.body.genre && String(req.body.genre).trim()) || 'General';
    const safeLanguage = (req.body.language && String(req.body.language).trim()) || 'English';
    const safeEmail = (email && String(email).trim()) || null;

    let location = '';
    let ownerId = null;
    
    // If user is authenticated, use their info
    if (req.user) {
      ownerId = req.user._id;
      // Get user's location for the book
      const user = await User.findById(req.user._id);
      if (user) {
        location = user.location || '';
      }
    }

    const book = new Book({
      title: safeTitle,
      author: safeAuthor,
      genre: safeGenre,
      condition: normalizeCondition(condition),
      language: safeLanguage,
      description,
      isbn,
      publishedYear,
      publisher,
      pageCount,
      tags,
      coverImage,
      images,
      owner: ownerId, // May be null for anonymous submissions
      ownerEmail: safeEmail,
      location: location
    });

    await book.save();
    if (ownerId) {
      await book.populate('owner', 'username firstName lastName location rating');
    }

    res.status(201).json({
      success: true,
      message: 'Book added successfully',
      data: { book }
    });
  } catch (error) {
    console.error('Add book error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error while adding book',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/books/:id
// @desc    Update a book
// @access  Private
router.put('/:id', [
  authenticateToken,
  body('title')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Title must be less than 200 characters'),
  body('author')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Author must be less than 100 characters'),
  body('genre')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Genre must be less than 50 characters'),
  body('condition')
    .optional()
    .isIn(['excellent', 'good', 'fair'])
    .withMessage('Invalid condition'),
  body('language')
    .optional()
    .trim()
    .isLength({ max: 30 })
    .withMessage('Language must be less than 30 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('isAvailable')
    .optional()
    .isBoolean()
    .withMessage('isAvailable must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book not found'
      });
    }

    // Check if user owns the book
    if (!book.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this book'
      });
    }

    // Update book fields
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        book[key] = req.body[key];
      }
    });

    await book.save();
    await book.populate('owner', 'username firstName lastName location rating');

    res.json({
      success: true,
      message: 'Book updated successfully',
      data: { book }
    });
  } catch (error) {
    console.error('Update book error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating book'
    });
  }
});

// @route   DELETE /api/books/:id
// @desc    Delete a book
// @access  Private
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: 'Book not found'
      });
    }

    // Check if user owns the book
    if (!book.canEdit(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this book'
      });
    }

    // Soft delete by marking as inactive
    book.isActive = false;
    await book.save();

    res.json({
      success: true,
      message: 'Book deleted successfully'
    });
  } catch (error) {
    console.error('Delete book error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting book'
    });
  }
});

// @route   GET /api/books/user/:userId
// @desc    Get books by user ID
// @access  Public
router.get('/user/:userId', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('available').optional().isBoolean().toBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { page = 1, limit = 12, available } = req.query;
    const skip = (page - 1) * limit;

    const filters = {
      owner: req.params.userId,
      isActive: true
    };

    if (available !== undefined) {
      filters.isAvailable = available;
    }

    const books = await Book.find(filters)
      .populate('owner', 'username firstName lastName location rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Book.countDocuments(filters);

    res.json({
      success: true,
      data: {
        books,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalBooks: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get user books error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user books'
    });
  }
});

// @route   GET /api/books/genres/list
// @desc    Get all unique genres
// @access  Public
router.get('/genres/list', async (req, res) => {
  try {
    const genres = await Book.distinct('genre', { isActive: true, isAvailable: true });
    
    res.json({
      success: true,
      data: { genres: genres.sort() }
    });
  } catch (error) {
    console.error('Get genres error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching genres'
    });
  }
});

module.exports = router;
