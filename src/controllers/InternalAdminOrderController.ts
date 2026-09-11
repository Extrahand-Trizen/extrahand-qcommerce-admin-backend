import { Request, Response } from 'express';
import CustomerOrder from '../models/CustomerOrder';
import { emitOrderUpdated } from '../socket/orderSocket';

function orderQuery(id: string) {
  return {
    $or: [
      ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
      { orderNumber: id },
      { orderNumber: id.startsWith('#') ? id : `#${id}` },
    ],
  };
}

function dashboardStatus(order: any): 'open' | 'assigned' | 'completed' | 'cancelled' {
  const status = String(order.status || '').toUpperCase();
  const fulfillment = String(order.fulfillmentStatus || '').toUpperCase();
  if (['CANCELLED', 'FAILED'].includes(status) || ['REJECTED', 'CANCELLED'].includes(fulfillment)) {
    return 'cancelled';
  }
  if (status === 'DELIVERED' || fulfillment === 'HANDED_OVER') return 'completed';
  if (order.assignedTo?.name || order.assigneeName || order.assignedHelperName) return 'assigned';
  return 'open';
}

function toDashboardOrder(order: any) {
  const amount = typeof order.amount === 'number' ? order.amount : (order.amountPaise || 0) / 100;
  return {
    ...order,
    id: String(order._id),
    amount,
    amountPaise: order.amountPaise || Math.round(amount * 100),
    status: dashboardStatus(order),
    shopName: order.shopName || 'Shop',
    opsAdminName: order.opsAdmin?.name || 'Durgamshiva',
    assignedHelperName: order.assignedTo?.name || order.assignedHelperName || null,
  };
}

export class InternalAdminOrderController {
  static async listOrders(req: Request, res: Response): Promise<void> {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || 'all').trim();
    const shop = String(req.query.shop || 'all').trim();
    const category = String(req.query.category || 'all').trim();
    const subcategory = String(req.query.subcategory || 'all').trim();
    const assignedTo = String(req.query.assignedTo || 'all').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '20'), 10)));
    const filter: Record<string, any> = {};

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      filter.$or = [
        { orderNumber: regex },
        { shopName: regex },
        { 'address.name': regex },
        { 'address.phone': regex },
        { 'address.line1': regex },
        { 'assignedTo.name': regex },
        { 'opsAdmin.name': regex },
      ];
    }
    if (shop !== 'all') filter.shopName = { $regex: `^${shop}$`, $options: 'i' };
    if (category !== 'all') filter.shopCategory = { $regex: `^${category}$`, $options: 'i' };
    if (subcategory !== 'all') filter.shopSubcategory = { $regex: `^${subcategory}$`, $options: 'i' };
    if (assignedTo === 'unassigned') {
      filter['assignedTo.name'] = { $in: [null, ''] };
    } else if (assignedTo !== 'all') {
      filter['assignedTo.name'] = { $regex: assignedTo, $options: 'i' };
    }
    if (status === 'cancelled') filter.$or = [{ status: { $in: ['CANCELLED', 'FAILED'] } }, { fulfillmentStatus: { $in: ['REJECTED', 'CANCELLED'] } }];
    if (status === 'completed') filter.$or = [{ status: 'DELIVERED' }, { fulfillmentStatus: 'HANDED_OVER' }];
    if (status === 'assigned') filter['assignedTo.name'] = { $exists: true, $nin: [null, ''] };
    if (status === 'open') filter.status = { $in: ['PENDING_PAYMENT', 'PAID', 'CONFIRMED'] };

    const sortDirection = String(req.query.deadlineSortOrder || 'desc') === 'asc' ? 1 : -1;
    const [total, rawOrders] = await Promise.all([
      CustomerOrder.countDocuments(filter),
      CustomerOrder.find(filter)
        .sort({ deadline: sortDirection, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      success: true,
      data: rawOrders.map(toDashboardOrder),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }

  static async getOrder(req: Request, res: Response): Promise<void> {
    const order = await CustomerOrder.findOne(orderQuery(req.params.id)).lean();
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    res.json({ success: true, data: toDashboardOrder(order) });
  }

  static async assignHelper(req: Request, res: Response): Promise<void> {
    const { helperUid, helperProfileId, helperName, helperPhone, role = 'helper' } = req.body;
    if (!helperUid && !helperProfileId && !helperName) {
      res.status(400).json({ success: false, error: 'Helper details are required' });
      return;
    }
    const order = await CustomerOrder.findOne(orderQuery(req.params.id));
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    const now = new Date();
    order.assignedTo = {
      userId: helperUid || order.assignedTo?.userId,
      profileId: helperProfileId || order.assignedTo?.profileId,
      name: helperName || order.assignedTo?.name,
      phone: helperPhone || order.assignedTo?.phone,
      role,
      assignedAt: now,
    };
    order.assignedHelperName = helperName || order.assignedHelperName || null;
    order.assignedAt = now;
    order.assignmentStatus = 'assigned';
    if (!['DELIVERED', 'CANCELLED'].includes(String(order.status))) order.status = 'CONFIRMED';
    await order.save();
    emitOrderUpdated(order);
    res.json({ success: true, data: toDashboardOrder(order.toObject()), message: 'Helper assigned successfully' });
  }

  static async updateOrderStatus(req: Request, res: Response): Promise<void> {
    const requestedStatus = String(req.body?.status || '').toLowerCase();
    if (!requestedStatus) {
      res.status(400).json({ success: false, error: 'Status is required' });
      return;
    }
    const order = await CustomerOrder.findOne(orderQuery(req.params.id));
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    const now = new Date();
    if (requestedStatus === 'completed') {
      order.status = 'DELIVERED';
      order.fulfillmentStatus = 'HANDED_OVER';
      order.completedAt = order.completedAt || now;
    } else if (requestedStatus === 'cancelled') {
      order.status = 'CANCELLED';
      order.cancelledAt = order.cancelledAt || now;
    } else if (requestedStatus === 'assigned') {
      order.status = 'CONFIRMED';
    } else {
      order.status = 'CONFIRMED';
    }
    await order.save();
    emitOrderUpdated(order);
    res.json({ success: true, data: toDashboardOrder(order.toObject()), message: 'Order status updated successfully' });
  }
}