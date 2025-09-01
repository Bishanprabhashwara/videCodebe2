const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Review = require('../models/Review');
const Swap = require('../models/Swap');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/reviews
// @desc    Create a review after a completed swap
// @access  Private
router.post('/', [
  auth,
  body('swapId')
    .isMongoId()
    .withMessage('Valid swap ID is required'),
  body('revieweeId')
    .isMongoId()
    .withMessage('Valid reviewee ID is required'),
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Comment must be less than 500 characters')
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

    const { swapId, revieweeId, rating, comment = '' } = req.body;

    // Validate swap exists and is completed
    const swap = await Swap.findById(swapId);
    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    if (swap.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only review completed swaps'
      });
    }

    // Check if user was involved in the swap
    if (!swap.canModify(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to review this swap'
      });
    }

    // Check if reviewee was the other party in the swap
    const isValidReviewee = (swap.requester.toString() === revieweeId && swap.owner.toString() === req.user.id) ||
                           (swap.owner.toString() === revieweeId && swap.requester.toString() === req.user.id);

    if (!isValidReviewee) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reviewee for this swap'
      });
    }

    // Check if review already exists
    const existingReview = await Review.findOne({
      reviewer: req.user.id,
      reviewee: revieweeId,
      swap: swapId
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this swap'
      });
    }

    const review = new Review({
      reviewer: req.user.id,
      reviewee: revieweeId,
      swap: swapId,
      rating,
      comment
    });

    await review.save();
    await review.populate([
      { path: 'reviewer', select: 'username firstName lastName avatar' },
      { path: 'reviewee', select: 'username firstName lastName avatar' },
      { path: 'swap', select: 'requestedBook offeredBook' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating review'
    });
  }
});

// @route   GET /api/reviews/user/:userId
// @desc    Get reviews for a user
// @access  Public
router.get('/user/:userId', [
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

    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({
      reviewee: req.params.userId,
      isActive: true
    })
      .populate('reviewer', 'username firstName lastName avatar')
      .populate('swap', 'requestedBook offeredBook')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({
      reviewee: req.params.userId,
      isActive: true
    });

    // Calculate rating statistics
    const ratingStats = await Review.calculateUserRating(req.params.userId);

    res.json({
      success: true,
      data: {
        reviews,
        ratingStats,
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
    console.error('Get user reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching reviews'
    });
  }
});

// @route   GET /api/reviews/:id
// @desc    Get single review by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('reviewer', 'username firstName lastName avatar')
      .populate('reviewee', 'username firstName lastName avatar')
      .populate('swap', 'requestedBook offeredBook');

    if (!review || !review.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      data: { review }
    });
  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching review'
    });
  }
});

// @route   PUT /api/reviews/:id
// @desc    Update a review
// @access  Private
router.put('/:id', [
  auth,
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Comment must be less than 500 characters')
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

    const review = await Review.findById(req.params.id);

    if (!review || !review.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user can edit this review
    if (!review.canEdit(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this review'
      });
    }

    const { rating, comment } = req.body;

    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    await review.save();
    await review.populate([
      { path: 'reviewer', select: 'username firstName lastName avatar' },
      { path: 'reviewee', select: 'username firstName lastName avatar' },
      { path: 'swap', select: 'requestedBook offeredBook' }
    ]);

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating review'
    });
  }
});

// @route   DELETE /api/reviews/:id
// @desc    Delete a review (soft delete)
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review || !review.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user can delete this review (reviewer or admin)
    if (!review.canEdit(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review'
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
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting review'
    });
  }
});

// @route   GET /api/reviews/swap/:swapId/eligible
// @desc    Check if user can review a swap
// @access  Private
router.get('/swap/:swapId/eligible', auth, async (req, res) => {
  try {
    const swap = await Swap.findById(req.params.swapId);

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    if (swap.status !== 'completed') {
      return res.json({
        success: true,
        data: { canReview: false, reason: 'Swap not completed' }
      });
    }

    if (!swap.canModify(req.user.id)) {
      return res.json({
        success: true,
        data: { canReview: false, reason: 'Not involved in swap' }
      });
    }

    // Determine who the user can review
    const otherPartyId = swap.requester.toString() === req.user.id 
      ? swap.owner.toString() 
      : swap.requester.toString();

    // Check if already reviewed
    const existingReview = await Review.findOne({
      reviewer: req.user.id,
      reviewee: otherPartyId,
      swap: req.params.swapId
    });

    if (existingReview) {
      return res.json({
        success: true,
        data: { canReview: false, reason: 'Already reviewed' }
      });
    }

    res.json({
      success: true,
      data: { 
        canReview: true, 
        revieweeId: otherPartyId,
        swap: {
          id: swap._id,
          requestedBook: swap.requestedBook,
          offeredBook: swap.offeredBook
        }
      }
    });
  } catch (error) {
    console.error('Check review eligibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking review eligibility'
    });
  }
});

module.exports = router;
