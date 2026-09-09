import dns from 'node:dns';
import { MongoClient, ObjectId } from 'mongodb';

dns.setServers(['8.8.8.8', '8.8.4.4']);

async function run() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  const client = await MongoClient.connect(uri);

  try {
    const col = client.db('extrahand').collection('customerorders');
    const partnerProfileId = new ObjectId('6a9fd6905d9688bd97ffa943');
    const partnerUid = '1Ac3f3DFTnXb8BJGT4tZg1OX3TZ2';
    const partnerName = 'Test User';
    const partnerPhone = '+919999999999';
    const now = new Date();

    const result = await col.findOneAndUpdate(
      { orderNumber: 'QC-MTSLLUIQ-6WK8' },
      {
        $set: {
          assigneeId: partnerProfileId,
          assigneeUid: partnerUid,
          partnerId: partnerProfileId,
          partnerUid: partnerUid,
          assignedHelperName: partnerName,
          assignedToName: partnerName,
          assigneeName: partnerName,
          assignedAt: now,
          partnerAcceptedAt: now,
          assignmentStatus: 'assigned',
          status: 'assigned',
          confirmed: false,
          executionPhase: 'assigned',
          assignedTo: {
            userId: partnerUid,
            profileId: partnerProfileId.toString(),
            name: partnerName,
            phone: partnerPhone,
            role: 'helper',
            assignedAt: now,
          },
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );

    console.log('Assignment successful!');
    console.log('Order:', result?.orderNumber);
    console.log('Status:', result?.status);
    console.log('Assignment status:', result?.assignmentStatus);
    console.log('AssigneeId:', result?.assigneeId);
    console.log('AssigneeUid:', result?.assigneeUid);
    console.log('PartnerId:', result?.partnerId);
    console.log('PartnerUid:', result?.partnerUid);
    console.log('AssignedHelperName:', result?.assignedHelperName);
    console.log('Confirmed:', result?.confirmed);
    console.log('ExecutionPhase:', result?.executionPhase);
    console.log('AssignedTo:', result?.assignedTo);
    console.log('UpdatedAt:', result?.updatedAt);

    const foundOrders = await col
      .find({
        $or: [
          { partnerId: partnerProfileId },
          { assigneeId: partnerProfileId },
          { partnerUid: partnerUid },
          { assigneeUid: partnerUid },
          { 'assignedTo.userId': partnerUid },
          { 'assignedTo.profileId': String(partnerProfileId) },
        ],
        status: {
          $in: [
            'assigned',
            'started',
            'in_progress',
            'review',
            'completed',
            'cancelled',
            'PAID',
            'open',
          ],
        },
      })
      .toArray();

    console.log('\nVerified: findQcOrdersForPartner matches:', foundOrders.length, 'order(s)');
    foundOrders.forEach((o) => {
      console.log(` - Order #${o.orderNumber}: status="${o.status}", assigneeId="${o.assigneeId}", confirmed=${o.confirmed}`);
    });
  } finally {
    await client.close();
  }
}

void run();
