/**
 * Track E — verify the prep pick-checklist flow end to end against local Mongo.
 *   npx ts-node src/scripts/testPrepChecklist.ts <sellerId>
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import Seller from '../models/Seller';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';
import { generateHandoverCode } from '../services/QcOrderService';

const TAG = /^QC-CLTEST-/;

async function main() {
  await connectDatabase();
  const arg = process.argv[2];
  if (!arg || !Types.ObjectId.isValid(arg)) {
    console.error('Usage: ts-node src/scripts/testPrepChecklist.ts <sellerId>');
    process.exit(1);
  }
  const sellerId = new Types.ObjectId(arg);
  if (!(await Seller.findById(sellerId))) { console.error('no such seller'); process.exit(1); }
  const sid = String(sellerId);

  await CustomerOrder.deleteMany({ orderNumber: TAG });

  const items = [
    { productSlug: 'cl-rice', masterProductId: new Types.ObjectId(), name: 'Rice', unit: '5 kg', quantity: 2, unitPricePaise: 45000, lineTotalPaise: 90000 },
    { productSlug: 'cl-oil', masterProductId: new Types.ObjectId(), name: 'Oil', unit: '1 L', quantity: 1, unitPricePaise: 18000, lineTotalPaise: 18000 },
    { productSlug: 'cl-tomato', masterProductId: new Types.ObjectId(), name: 'Tomatoes', unit: '1 kg', quantity: 2, unitPricePaise: 4000, lineTotalPaise: 8000 },
    { productSlug: 'cl-milk', masterProductId: new Types.ObjectId(), name: 'Milk', unit: '1 L', quantity: 1, unitPricePaise: 6800, lineTotalPaise: 6800 },
  ];
  const order = await CustomerOrder.create({
    userId: 'cl-customer', sellerId,
    orderNumber: `QC-CLTEST-${Date.now().toString(36).toUpperCase()}`,
    status: 'PAID', paymentStatus: 'PAID', fulfillmentStatus: 'PENDING_ACCEPT',
    acceptDeadline: new Date(Date.now() + 90_000), handoverCode: generateHandoverCode(),
    fulfillmentEvents: [{ action: 'PLACED', by: 'system', at: new Date() }],
    items,
    address: { line1: 'x', city: 'Hyderabad', pinCode: '500081', name: 'CL', phone: '9848012345' },
    deliveryInstructions: [], partnerTipPaise: 0,
    itemTotalPaise: 122800, deliveryFeePaise: 0, handlingFeePaise: 0, couponDiscountPaise: 0, amountPaise: 122800,
  });
  const id = String(order._id);
  console.log(`order ${order.orderNumber}  (${items.length} items)\n`);

  await OrderFulfillmentService.transition(sid, id, 'accept', { prepMinutes: 20 });
  const afterStart = await OrderFulfillmentService.transition(sid, id, 'start-preparing');
  console.log('start-preparing -> status:', afterStart.order.fulfillmentStatus,
    ' preparingStartedAt:', !!afterStart.order.preparingStartedAt,
    ' allUnchecked:', afterStart.order.items.every((i: { preparationChecked?: boolean }) => !i.preparationChecked));

  // Try mark-ready with nothing checked -> must 409
  try {
    await OrderFulfillmentService.transition(sid, id, 'mark-ready');
    console.log('✗ mark-ready allowed with unchecked items — BUG');
  } catch (e) {
    console.log('mark-ready (0 checked) -> rejected ✓  "' + (e as Error).message + '"');
  }

  // Check 3 of 4
  await OrderFulfillmentService.setItemPrepCheck(sid, id, 0, true);
  await OrderFulfillmentService.setItemPrepCheck(sid, id, 1, true);
  const three = await OrderFulfillmentService.setItemPrepCheck(sid, id, 2, true);
  console.log('checked 3/4:', three.order.items.map((i: { name: string; preparationChecked?: boolean }) => `${i.name}:${i.preparationChecked ? '☑' : '☐'}`).join('  '));
  try {
    await OrderFulfillmentService.transition(sid, id, 'mark-ready');
    console.log('✗ mark-ready allowed at 3/4 — BUG');
  } catch (e) {
    console.log('mark-ready (3/4) -> rejected ✓  "' + (e as Error).message + '"');
  }

  // Uncheck one (persistence check) then re-check all 4
  await OrderFulfillmentService.setItemPrepCheck(sid, id, 0, false);
  const reloaded = await CustomerOrder.findById(id).lean();
  console.log('after uncheck item 0, persisted state:', reloaded!.items.map((i) => i.preparationChecked ? '☑' : '☐').join(' '));

  await OrderFulfillmentService.setItemPrepCheck(sid, id, 0, true);
  await OrderFulfillmentService.setItemPrepCheck(sid, id, 3, true);
  const ready = await OrderFulfillmentService.transition(sid, id, 'mark-ready');
  console.log('\nmark-ready (4/4) -> status:', ready.order.fulfillmentStatus, ' readyAt:', !!ready.order.readyAt, '  ✓');

  await CustomerOrder.deleteMany({ orderNumber: TAG });
  console.log('cleaned up.');
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
