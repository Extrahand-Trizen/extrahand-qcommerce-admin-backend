import '../models/register';
import { connectDatabase, disconnectDatabase } from '../config/database';
import SellerListing from '../models/SellerListing';
import SellerPayout from '../models/SellerPayout';

async function main() {
  await connectDatabase();
  console.log('Syncing indexes...');
  await SellerListing.syncIndexes();
  await SellerPayout.syncIndexes();
  const listingIndexes = await SellerListing.collection.getIndexes();
  const payoutIndexes = await SellerPayout.collection.getIndexes();
  console.log('SellerListing indexes:', Object.keys(listingIndexes));
  console.log('SellerPayout indexes:', Object.keys(payoutIndexes));

  // Run explain on SellerListing query
  const sampleSellerId = '666666666666666666666666';
  const listingExplain: any = await SellerListing.find({ sellerId: sampleSellerId, status: 'ACTIVE' })
    .sort({ updatedAt: -1 })
    .explain('executionStats');

  console.log('\n--- SellerListing Explain ---');
  console.log('winningPlan stage:', listingExplain.queryPlanner?.winningPlan?.stage || listingExplain.queryPlanner?.winningPlan?.inputStage?.stage);
  console.log('indexName:', listingExplain.queryPlanner?.winningPlan?.inputStage?.indexName || listingExplain.queryPlanner?.winningPlan?.indexName);
  console.log('totalDocsExamined:', listingExplain.executionStats?.totalDocsExamined);
  console.log('totalKeysExamined:', listingExplain.executionStats?.totalKeysExamined);

  // Run explain on SellerPayout query
  const payoutExplain: any = await SellerPayout.find({ sellerId: sampleSellerId })
    .sort({ requestedAt: -1 })
    .explain('executionStats');

  console.log('\n--- SellerPayout Explain ---');
  console.log('winningPlan stage:', payoutExplain.queryPlanner?.winningPlan?.stage || payoutExplain.queryPlanner?.winningPlan?.inputStage?.stage);
  console.log('indexName:', payoutExplain.queryPlanner?.winningPlan?.inputStage?.indexName || payoutExplain.queryPlanner?.winningPlan?.indexName);
  console.log('totalDocsExamined:', payoutExplain.executionStats?.totalDocsExamined);
  console.log('totalKeysExamined:', payoutExplain.executionStats?.totalKeysExamined);

  await disconnectDatabase();
}

main().catch(console.error);
