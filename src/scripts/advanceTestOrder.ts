/**
 * Push the newest QC-TEST- order for a seller to a given stage, so you can land
 * on a specific screen in the app. Does NOT touch any other orders.
 *   npx ts-node src/scripts/advanceTestOrder.ts <sellerId> <accepted|preparing|ready|handed_over>
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import CustomerOrder from '../models/CustomerOrder';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';

type Stage = 'accepted' | 'preparing' | 'ready' | 'handed_over';
const ORDER: Stage[] = ['accepted', 'preparing', 'ready', 'handed_over'];

async function main() {
  await connectDatabase();
  const sid = process.argv[2];
  const stage = (process.argv[3] || 'preparing') as Stage;
  if (!sid || !ORDER.includes(stage)) {
    console.error('Usage: advanceTestOrder.ts <sellerId> <accepted|preparing|ready|handed_over>');
    process.exit(1);
  }

  const o = await CustomerOrder.findOne({ sellerId: sid, orderNumber: /^QC-TEST-/ }).sort({ createdAt: -1 });
  if (!o) { console.error('no QC-TEST- order for that seller — seed one first'); process.exit(1); }
  const id = String(o._id);
  const want = ORDER.indexOf(stage);

  if (o.fulfillmentStatus === 'PENDING_ACCEPT') {
    await OrderFulfillmentService.transition(sid, id, 'accept', { prepMinutes: 20 });
  }
  if (want >= ORDER.indexOf('preparing')) {
    await OrderFulfillmentService.transition(sid, id, 'start-preparing');
  }
  if (want >= ORDER.indexOf('ready')) {
    const fresh = await CustomerOrder.findById(id).lean();
    for (let i = 0; i < (fresh?.items.length ?? 0); i += 1) {
      await OrderFulfillmentService.setItemPrepCheck(sid, id, i, true);
    }
    await OrderFulfillmentService.transition(sid, id, 'mark-ready');
  }
  if (want >= ORDER.indexOf('handed_over')) {
    const fresh = await CustomerOrder.findById(id).lean();
    await OrderFulfillmentService.transition(sid, id, 'mark-handed-over', { handoverCode: fresh?.handoverCode });
  }

  const f = await CustomerOrder.findById(id).lean();
  console.log(`\n${f?.orderNumber} -> ${f?.fulfillmentStatus}`);
  console.log('handoverCode:', f?.handoverCode);
  console.log('events:', f?.fulfillmentEvents.map((e) => e.action).join(' → '));
  console.log('readyAt:', f?.readyAt?.toISOString() ?? '-');
  await disconnectDatabase();
}
main().catch((e) => { console.error(e); process.exit(1); });
