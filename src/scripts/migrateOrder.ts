import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';

async function run() {
  const targetOrderNumber = 'QC-MTSLLUIQ-6WK8';
  console.log(`Connecting to MongoDB to migrate order: ${targetOrderNumber}...`);
  await connectDatabase();

  try {
    const order = await CustomerOrder.findOne({
      $or: [
        { orderNumber: targetOrderNumber },
        { orderNumber: `#${targetOrderNumber}` },
        { orderNumber: targetOrderNumber.replace(/^#/, '') },
        { orderNumber: new RegExp(targetOrderNumber.replace(/[-_]/g, ''), 'i') },
      ],
    });

    if (!order) {
      console.error(`Order not found with orderNumber: ${targetOrderNumber}`);
      const recentOrders = await CustomerOrder.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .select('orderNumber status createdAt userId')
        .lean();
      console.log('Recent 5 orders in customerorders:', recentOrders);
      return;
    }

    console.log('Found order before migration:');
    console.log(JSON.stringify(order.toObject(), null, 2));

    // Backfill all Task-parity fields
    if (!order.title) {
      order.title = `Quick Commerce Order #${order.orderNumber}`;
    }

    if (!order.description) {
      const itemsSummary = (order.items || [])
        .map((i) => `${i.quantity}x ${i.name}`)
        .join(', ');
      order.description = itemsSummary
        ? `Quick commerce delivery: ${itemsSummary}`
        : `Quick commerce delivery #${order.orderNumber}`;
    }

    if (!order.category) {
      order.category = 'delivery';
    }
    if (!order.categorySlug) {
      order.categorySlug = 'delivery_logistics';
    }
    if (!order.categoryLabel) {
      order.categoryLabel = 'Delivery & Logistics';
    }
    if (!order.subcategory) {
      order.subcategory = 'quick_commerce_delivery';
    }

    if (!order.bookingSource) {
      order.bookingSource = 'quick_commerce';
    }
    if (!order.bookingOrderId) {
      order.bookingOrderId = order.orderNumber || order._id.toString();
    }
    if (!order.bookingItemId) {
      order.bookingItemId = (order.items?.[0] as any)?._id?.toString() || order._id.toString();
    }

    if (!order.urgency) {
      order.urgency = 'urgent';
    }
    if (!order.priority) {
      order.priority = 'high';
    }

    if (!order.budget || !order.budget.amount) {
      const deliveryFee = (order.deliveryFeePaise ?? 0) / 100;
      const totalAmount = (order.amountPaise ?? 0) / 100;
      const amt = deliveryFee > 0 ? deliveryFee : Math.round(totalAmount * 0.1) || 50;
      order.budget = {
        amount: amt,
        min: amt,
        max: amt,
        currency: 'INR',
        type: 'fixed',
      };
    }

    if (
      !order.location ||
      !order.location.address ||
      (order.location.coordinates?.[0] === 0 && order.location.coordinates?.[1] === 0)
    ) {
      const coords =
        order.address?.coordinates &&
        Array.isArray(order.address.coordinates) &&
        order.address.coordinates.length >= 2
          ? order.address.coordinates
          : ([78.3728, 17.4486] as [number, number]);

      const locAddress =
        [
          order.address?.line1,
          order.address?.line2,
          order.address?.city,
          order.address?.state,
          order.address?.pinCode,
        ]
          .filter(Boolean)
          .join(', ') ||
        (order as any).shopAddress ||
        'Delivery Address';

      const city = order.address?.city || (order as any).shopCity || 'Hyderabad';
      order.location = {
        type: 'Point',
        coordinates: coords,
        address: locAddress,
        city,
        state: order.address?.state || 'Andhra Pradesh',
        pinCode: order.address?.pinCode || '535558',
        country: 'India',
        taskArea: city,
      };
    }

    if (!order.scheduledDate) {
      order.scheduledDate = order.createdAt || new Date();
    }
    if (!order.scheduledTimeStart) {
      order.scheduledTimeStart = 'Immediate';
    }
    if (!order.scheduledTimeEnd) {
      order.scheduledTimeEnd = '30-45 mins';
    }

    if (!order.requesterUid && order.userId) {
      order.requesterUid = order.userId;
    }

    try {
      const profilesCol = CustomerOrder.db.collection('profiles');
      const userProfile = await profilesCol.findOne({
        $or: [{ uid: order.userId }, { _id: Types.ObjectId.isValid(order.userId) ? new Types.ObjectId(order.userId) : null }].filter(Boolean) as any,
      });
      if (userProfile?._id) {
        order.requesterId = userProfile._id as any;
        console.log(`Resolved requesterId from profiles: ${userProfile._id}`);
      } else if (order.userId && Types.ObjectId.isValid(order.userId)) {
        order.requesterId = new Types.ObjectId(order.userId);
      }
    } catch (profileErr) {
      console.warn('Could not query profiles collection:', profileErr);
    }

    // Check if partner assigned in assignedTo or assigneeId
    const hasAssignedPartner = Boolean(
      order.assigneeId ||
        order.partnerId ||
        order.assignedTo?.userId ||
        order.assignedTo?.profileId,
    );

    if (hasAssignedPartner) {
      const helperProfileId =
        order.assigneeId ||
        order.partnerId ||
        (order.assignedTo?.profileId && Types.ObjectId.isValid(order.assignedTo.profileId)
          ? new Types.ObjectId(order.assignedTo.profileId)
          : null);

      const helperUid =
        order.assigneeUid ||
        order.partnerUid ||
        order.assignedTo?.userId ||
        null;

      const helperName =
        order.assignedHelperName ||
        order.assignedTo?.name ||
        null;

      order.assigneeId = helperProfileId as any;
      order.partnerId = helperProfileId as any;
      order.assigneeUid = helperUid;
      order.partnerUid = helperUid;
      order.assignedHelperName = helperName;
      order.assignedToName = helperName;
      order.assigneeName = helperName;

      if (!order.assignedAt) {
        order.assignedAt = order.assignedTo?.assignedAt || new Date();
      }
      if (!order.partnerAcceptedAt) {
        order.partnerAcceptedAt = order.assignedAt || new Date();
      }
      if (!order.assignmentStatus || order.assignmentStatus === 'pending') {
        order.assignmentStatus = 'assigned';
      }
      if (order.confirmed === undefined) {
        order.confirmed = false;
      }
      if (!order.executionPhase) {
        order.executionPhase = 'assigned';
      }
      if (order.status === 'open' || order.status === 'PAID') {
        order.status = 'assigned';
      }
    } else {
      order.assigneeId = null;
      order.assigneeUid = null;
      order.partnerId = null;
      order.partnerUid = null;
      order.assignedHelperName = null;
      order.assignedToName = null;
      order.assigneeName = null;
      order.assignmentStatus = 'pending';
    }

    if (order.isDeletedByCustomer === undefined) {
      order.isDeletedByCustomer = false;
    }
    if (order.isDeletedBySupport === undefined) {
      order.isDeletedBySupport = false;
    }

    await order.save();

    // Ensure null values are explicitly persisted to the MongoDB document
    await CustomerOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          assigneeId: order.assigneeId ?? null,
          assigneeUid: order.assigneeUid ?? null,
          partnerId: order.partnerId ?? null,
          partnerUid: order.partnerUid ?? null,
          assignedHelperName: order.assignedHelperName ?? null,
          assignedToName: order.assignedToName ?? null,
          assigneeName: order.assigneeName ?? null,
          assignedAt: order.assignedAt ?? null,
          partnerAcceptedAt: order.partnerAcceptedAt ?? null,
        },
      },
    );
    console.log('\nOrder migrated and saved successfully!');

    const updated = await CustomerOrder.findById(order._id).lean();
    console.log('\nUpdated order in MongoDB:');
    console.log(JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await disconnectDatabase();
    console.log('MongoDB disconnected.');
  }
}

void run();
