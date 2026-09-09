import dns from 'node:dns';
import { MongoClient } from 'mongodb';

dns.setServers(['8.8.8.8', '8.8.4.4']);

async function run() {
  const uri = 'mongodb+srv://user:user@cluster0.tfvlujk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  const client = await MongoClient.connect(uri);

  try {
    const col = client.db('extrahand').collection('customerorders');
    const now = new Date();

    const result = await col.findOneAndUpdate(
      { orderNumber: 'QC-MTSLLUIQ-6WK8' },
      {
        $set: {
          status: 'assigned',
          assignmentStatus: 'assigned',
          executionPhase: 'assigned',
          executionPhaseUpdatedAt: now,
          assignedAt: now,
          partnerAcceptedAt: now,
          confirmed: false,
          confirmedAt: null,
          confirmed_at: null,
          startedAt: null,
          inProgressAt: null,
          onTheWayAt: null,
          arrivedAt: null,
          completedAt: null,
          updatedAt: now,
        },
        $unset: {
          startOtp: '',
        },
      },
      { returnDocument: 'after' },
    );

    console.log('Reset successful!');
    console.log(
      JSON.stringify(
        {
          orderNumber: result?.orderNumber,
          status: result?.status,
          assignmentStatus: result?.assignmentStatus,
          executionPhase: result?.executionPhase,
          assignedAt: result?.assignedAt,
          partnerAcceptedAt: result?.partnerAcceptedAt,
          confirmed: result?.confirmed,
          startedAt: result?.startedAt,
          onTheWayAt: result?.onTheWayAt,
          arrivedAt: result?.arrivedAt,
          startOtp: result?.startOtp,
          assigneeId: result?.assigneeId,
          partnerId: result?.partnerId,
          assignedHelperName: result?.assignedHelperName,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

void run();
