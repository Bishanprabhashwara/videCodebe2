const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Book = require('../models/Book');
const Swap = require('../models/Swap');
const Review = require('../models/Review');
const { auth, requireAdmin } = require('../middleware/auth');

const router = express.Router();


// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/dashboard', [auth, requireAdmin], async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      blockedUsers,
      totalBooks,
      availableBooks,
      totalSwaps,
      pendingSwaps,
      completedSwaps,
      totalReviews,
      recentUsers,
      recentBooks,
      recentSwaps
    ] = await Promise.all([
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: true, isBlocked: false }),
      User.countDocuments({ isBlocked: true }),
      Book.countDocuments({ isActive: true }),
      Book.countDocuments({ isActive: true, isAvailable: true }),
      Swap.countDocuments(),
      Swap.countDocuments({ status: 'pending' }),
      Swap.countDocuments({ status: 'completed' }),
      Review.countDocuments({ isActive: true }),
      User.find({ isActive: true })
        .select('username email firstName lastName createdAt')
        .sort({ createdAt: -1 })
        .limit(5),
      Book.find({ isActive: true })
        .populate('owner', 'username')
        .select('title author genre createdAt')
        .sort({ createdAt: -1 })
        .limit(5),
      Swap.find()
        .populate('requester', 'username')
        .populate('owner', 'username')
        .populate('requestedBook', 'title')
        .populate('offeredBook', 'title')
        .select('status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
    ]);

    res.json({
      success: true,
      data: {
        statistics: {
          users: {
            total: totalUsers,
            active: activeUsers,
            blocked: blockedUsers
          },
          books: {
            total: totalBooks,
            available: availableBooks
          },
          swaps: {
            total: totalSwaps,
            pending: pendingSwaps,
            completed: completedSwaps
          },
          reviews: {
            total: totalReviews
          }
        },
        recent: {
          users: recentUsers,
          books: recentBooks,
          swaps: recentSwaps
        }
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard data'
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination and filtering
// @access  Private (Admin only)
router.get('/users', [
  auth,
  requireAdmin,
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('status').optional().isIn(['active', 'blocked', 'all']),
  query('role').optional().isIn(['user', 'admin', 'all'])
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

    const { page = 1, limit = 20, search, status = 'all', role = 'all' } = req.query;
    const skip = (page - 1) * limit;

    // Build filter query
    let filter = { isActive: true };

    if (status === 'blocked') {
      filter.isBlocked = true;
    } else if (status === 'active') {
      filter.isBlocked = false;
    }

    if (role !== 'all') {
      filter.role = role;
    }

    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .select('-password -emailVerificationToken -passwordResetToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
});

// @route   PUT /api/admin/users/:id/block
// @desc    Block/unblock a user
// @access  Private (Admin only)
router.put('/users/:id/block', [
  auth,
  requireAdmin,
  body('blocked').isBoolean().withMessage('Blocked status must be boolean'),
  body('reason').optional().trim().isLength({ max: 200 }).withMessage('Reason must be less than 200 characters')
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

    const { blocked, reason = '' } = req.body;

    const user = await User.findById(req.params.id);
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent blocking other admins
    if (user.role === 'admin' && user._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Cannot block other administrators'
      });
    }

    user.isBlocked = blocked;
    if (blocked && reason) {
      user.blockReason = reason;
    } else if (!blocked) {
      user.blockReason = undefined;
    }

    await user.save();

    res.json({
      success: true,
      message: `User ${blocked ? 'blocked' : 'unblocked'} successfully`,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isBlocked: user.isBlocked,
          blockReason: user.blockReason
        }
      }
    });
  } catch (error) {
    console.error('Admin block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
});

// @route   PUT /api/admin/users/:id/role
// @desc    Change user role
// @access  Private (Admin only)
router.put('/users/:id/role', [
  auth,
  requireAdmin,
  body('role').isIn(['user', 'admin']).withMessage('Role must be user or admin')
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

    const { role } = req.body;

    const user = await User.findById(req.params.id);
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent changing own role
    if (user._id.toString() === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Cannot change your own role'
      });
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: `User role updated to ${role} successfully`,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('Admin change role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user role'
    });
  }
});

// @route   GET /api/admin/books
// @desc    Get all books with pagination and filtering
// @access  Private (Admin only)
router.get('/books', [
  auth,
  requireAdmin,
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('genre').optional().trim(),
  query('condition').optional().isIn(['excellent', 'good', 'fair', 'poor']),
  query('availability').optional().isIn(['available', 'unavailable', 'all'])
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

    const { page = 1, limit = 20, search, genre, condition, availability = 'all' } = req.query;
    const skip = (page - 1) * limit;

    // Build filter query
    let filter = { isActive: true };

    if (availability === 'available') {
      filter.isAvailable = true;
    } else if (availability === 'unavailable') {
      filter.isAvailable = false;
    }

    if (genre) {
      filter.genre = { $regex: genre, $options: 'i' };
    }

    if (condition) {
      filter.condition = condition;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { isbn: { $regex: search, $options: 'i' } }
      ];
    }

    const books = await Book.find(filter)
      .populate('owner', 'username email firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Book.countDocuments(filter);

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
    console.error('Admin get books error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching books'
    });
  }
});

// @route   DELETE /api/admin/books/:id
// @desc    Delete a book (admin override)
// @access  Private (Admin only)
router.delete('/books/:id', [auth, requireAdmin], async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book || !book.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Book not found'
      });
    }

    // Check for active swaps
    const activeSwaps = await Swap.countDocuments({
      $or: [
        { requestedBook: req.params.id },
        { offeredBook: req.params.id }
      ],
      status: { $in: ['pending', 'accepted'] }
    });

    if (activeSwaps > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete book with active swap requests'
      });
    }

    // Soft delete
    book.isActive = false;
    await book.save();

    res.json({
      success: true,
      message: 'Book deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete book error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting book'
    });
  }
});

// @route   GET /api/admin/swaps
// @desc    Get all swaps with pagination and filtering
// @access  Private (Admin only)
router.get('/swaps', [
  auth,
  requireAdmin,
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['pending', 'accepted', 'declined', 'completed', 'cancelled', 'all'])
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

    const { page = 1, limit = 20, status = 'all' } = req.query;
    const skip = (page - 1) * limit;

    // Build filter query
    let filter = {};
    if (status !== 'all') {
      filter.status = status;
    }

    const swaps = await Swap.find(filter)
      .populate('requester', 'username email firstName lastName')
      .populate('owner', 'username email firstName lastName')
      .populate('requestedBook', 'title author')
      .populate('offeredBook', 'title author')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Swap.countDocuments(filter);

    res.json({
      success: true,
      data: {
        swaps,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalSwaps: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Admin get swaps error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching swaps'
    });
  }
});

// @route   GET /api/admin/reviews
// @desc    Get all reviews with pagination and filtering
// @access  Private (Admin only)
router.get('/reviews', [
  auth,
  requireAdmin,
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('rating').optional().isInt({ min: 1, max: 5 }).toInt()
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

    const { page = 1, limit = 20, rating } = req.query;
    const skip = (page - 1) * limit;

    // Build filter query
    let filter = { isActive: true };
    if (rating) {
      filter.rating = rating;
    }

    const reviews = await Review.find(filter)
      .populate('reviewer', 'username email firstName lastName')
      .populate('reviewee', 'username email firstName lastName')
      .populate('swap', 'status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments(filter);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Admin get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching reviews'
    });
  }
});

// @route   DELETE /api/admin/reviews/:id
// @desc    Delete a review (admin override)
// @access  Private (Admin only)
router.delete('/reviews/:id', [auth, requireAdmin], async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review || !review.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Soft delete
    review.isActive = false;
    await review.save();

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting review'
    });
  }
});

module.exports = router;
