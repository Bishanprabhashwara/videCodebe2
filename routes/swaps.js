const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Swap = require('../models/Swap');
const Book = require('../models/Book');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/swaps
// @desc    Get user's swaps (both sent and received)
// @access  Private
router.get('/', [
  auth,
  query('status').optional().isIn(['pending', 'accepted', 'declined', 'completed', 'cancelled']),
  query('type').optional().isIn(['sent', 'received', 'all']),
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

    const { status, type = 'all', page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = { isActive: true };

    // Filter by type
    if (type === 'sent') {
      query.requester = req.user.id;
    } else if (type === 'received') {
      query.owner = req.user.id;
    } else {
      query.$or = [
        { requester: req.user.id },
        { owner: req.user.id }
      ];
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    const swaps = await Swap.find(query)
      .populate('requester', 'username firstName lastName avatar rating')
      .populate('owner', 'username firstName lastName avatar rating')
      .populate('requestedBook', 'title author coverImage condition')
      .populate('offeredBook', 'title author coverImage condition')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Swap.countDocuments(query);

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
    console.error('Get swaps error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching swaps'
    });
  }
});

// @route   GET /api/swaps/:id
// @desc    Get single swap by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const swap = await Swap.findById(req.params.id)
      .populate('requester', 'username firstName lastName avatar rating location')
      .populate('owner', 'username firstName lastName avatar rating location')
      .populate('requestedBook', 'title author coverImage condition description')
      .populate('offeredBook', 'title author coverImage condition description');

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    // Check if user is involved in this swap
    if (!swap.canModify(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this swap'
      });
    }

    res.json({
      success: true,
      data: { swap }
    });
  } catch (error) {
    console.error('Get swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching swap'
    });
  }
});

// @route   POST /api/swaps
// @desc    Create a new swap request
// @access  Private
router.post('/', [
  auth,
  body('requestedBookId')
    .isMongoId()
    .withMessage('Valid requested book ID is required'),
  body('offeredBookId')
    .isMongoId()
    .withMessage('Valid offered book ID is required'),
  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Message must be less than 500 characters')
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

    const { requestedBookId, offeredBookId, message = '' } = req.body;

    // Validate books exist and are available
    const [requestedBook, offeredBook] = await Promise.all([
      Book.findById(requestedBookId),
      Book.findById(offeredBookId)
    ]);

    if (!requestedBook || !requestedBook.isActive || !requestedBook.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Requested book is not available'
      });
    }

    if (!offeredBook || !offeredBook.isActive || !offeredBook.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Offered book is not available'
      });
    }

    // Check if user owns the offered book
    if (!offeredBook.canEdit(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'You can only offer books you own'
      });
    }

    // Check if user is not requesting their own book
    if (requestedBook.canEdit(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot request your own book'
      });
    }

    // Check for existing pending swap for these books
    const existingSwap = await Swap.findOne({
      requester: req.user.id,
      requestedBook: requestedBookId,
      offeredBook: offeredBookId,
      status: 'pending',
      isActive: true
    });

    if (existingSwap) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending swap request for these books'
      });
    }

    const swap = new Swap({
      requester: req.user.id,
      owner: requestedBook.owner,
      requestedBook: requestedBookId,
      offeredBook: offeredBookId,
      message
    });

    await swap.save();
    await swap.populate([
      { path: 'requester', select: 'username firstName lastName avatar rating' },
      { path: 'owner', select: 'username firstName lastName avatar rating' },
      { path: 'requestedBook', select: 'title author coverImage condition' },
      { path: 'offeredBook', select: 'title author coverImage condition' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Swap request sent successfully',
      data: { swap }
    });
  } catch (error) {
    console.error('Create swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating swap request'
    });
  }
});

// @route   PUT /api/swaps/:id/accept
// @desc    Accept a swap request
// @access  Private
router.put('/:id/accept', [
  auth,
  body('responseMessage')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Response message must be less than 500 characters'),
  body('meetingLocation')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Meeting location must be less than 200 characters'),
  body('meetingDate')
    .optional()
    .isISO8601()
    .withMessage('Meeting date must be a valid date')
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

    const swap = await Swap.findById(req.params.id);

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    // Check if user is the owner (can accept)
    if (!swap.isOwner(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Only the book owner can accept swap requests'
      });
    }

    // Check if swap is still pending
    if (swap.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This swap request is no longer pending'
      });
    }

    // Check if swap is expired
    if (swap.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'This swap request has expired'
      });
    }

    const { responseMessage, meetingLocation, meetingDate } = req.body;
    const meetingDetails = {};
    if (meetingLocation) meetingDetails.location = meetingLocation;
    if (meetingDate) meetingDetails.date = new Date(meetingDate);

    await swap.accept(responseMessage, meetingDetails);
    await swap.populate([
      { path: 'requester', select: 'username firstName lastName avatar rating' },
      { path: 'owner', select: 'username firstName lastName avatar rating' },
      { path: 'requestedBook', select: 'title author coverImage condition' },
      { path: 'offeredBook', select: 'title author coverImage condition' }
    ]);

    res.json({
      success: true,
      message: 'Swap request accepted successfully',
      data: { swap }
    });
  } catch (error) {
    console.error('Accept swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while accepting swap'
    });
  }
});

// @route   PUT /api/swaps/:id/decline
// @desc    Decline a swap request
// @access  Private
router.put('/:id/decline', [
  auth,
  body('responseMessage')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Response message must be less than 500 characters')
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

    const swap = await Swap.findById(req.params.id);

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    // Check if user is the owner (can decline)
    if (!swap.isOwner(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Only the book owner can decline swap requests'
      });
    }

    // Check if swap is still pending
    if (swap.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This swap request is no longer pending'
      });
    }

    const { responseMessage } = req.body;
    await swap.decline(responseMessage);
    await swap.populate([
      { path: 'requester', select: 'username firstName lastName avatar rating' },
      { path: 'owner', select: 'username firstName lastName avatar rating' },
      { path: 'requestedBook', select: 'title author coverImage condition' },
      { path: 'offeredBook', select: 'title author coverImage condition' }
    ]);

    res.json({
      success: true,
      message: 'Swap request declined',
      data: { swap }
    });
  } catch (error) {
    console.error('Decline swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while declining swap'
    });
  }
});

// @route   PUT /api/swaps/:id/complete
// @desc    Mark a swap as completed
// @access  Private
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const swap = await Swap.findById(req.params.id);

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    // Check if user is involved in this swap
    if (!swap.canModify(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to complete this swap'
      });
    }

    // Check if swap is accepted
    if (swap.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Only accepted swaps can be completed'
      });
    }

    await swap.complete();
    await swap.populate([
      { path: 'requester', select: 'username firstName lastName avatar rating' },
      { path: 'owner', select: 'username firstName lastName avatar rating' },
      { path: 'requestedBook', select: 'title author coverImage condition' },
      { path: 'offeredBook', select: 'title author coverImage condition' }
    ]);

    res.json({
      success: true,
      message: 'Swap marked as completed',
      data: { swap }
    });
  } catch (error) {
    console.error('Complete swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while completing swap'
    });
  }
});

// @route   PUT /api/swaps/:id/cancel
// @desc    Cancel a swap request
// @access  Private
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const swap = await Swap.findById(req.params.id);

    if (!swap) {
      return res.status(404).json({
        success: false,
        message: 'Swap not found'
      });
    }

    // Check if user is the requester (can cancel)
    if (!swap.isRequester(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Only the requester can cancel swap requests'
      });
    }

    // Check if swap can be cancelled
    if (!['pending', 'accepted'].includes(swap.status)) {
      return res.status(400).json({
        success: false,
        message: 'This swap cannot be cancelled'
      });
    }

    await swap.cancel();
    await swap.populate([
      { path: 'requester', select: 'username firstName lastName avatar rating' },
      { path: 'owner', select: 'username firstName lastName avatar rating' },
      { path: 'requestedBook', select: 'title author coverImage condition' },
      { path: 'offeredBook', select: 'title author coverImage condition' }
    ]);

    res.json({
      success: true,
      message: 'Swap request cancelled',
      data: { swap }
    });
  } catch (error) {
    console.error('Cancel swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while cancelling swap'
    });
  }
});

// @route   GET /api/swaps/pending/received
// @desc    Get pending swaps received by user
// @access  Private
router.get('/pending/received', auth, async (req, res) => {
  try {
    const swaps = await Swap.findPendingSwaps(req.user.id);

    res.json({
      success: true,
      data: { swaps }
    });
  } catch (error) {
    console.error('Get pending swaps error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending swaps'
    });
  }
});

module.exports = router;
