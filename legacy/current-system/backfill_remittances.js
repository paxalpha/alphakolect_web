const path = require('path');
const projectDir = "/home/mayowae/public_html/alphaweb";
const { Collection, Remittance, Customer } = require(path.join(projectDir, 'backend', 'models'));

async function backfill() {
  try {
    const collections = await Collection.findAll({
      where: { status: 'Collected' }
    });

    console.log(`Found ${collections.length} collected transactions.`);

    for (const col of collections) {
      const existing = await Remittance.findOne({ where: { collectionId: col.id } });
      if (!existing) {
        console.log(`Creating remittance for collection #${col.id} (${col.customerName})`);
        const customer = await Customer.findByPk(col.customerId);
        await Remittance.create({
          collectionId: col.id,
          customerId: col.customerId,
          customerName: col.customerName,
          accountNumber: col.accountNumber || (customer ? customer.accountNumber : null),
          amount: col.amount,
          agentId: customer ? customer.agentId : null,
          merchantId: col.merchantId,
          status: 'Pending',
          notes: `Backfilled from Collection #${col.id}`
        });
      }
    }
    console.log("Backfill complete.");
    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

backfill();
