import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// Customers for tests that call every endpoint of the registry (the authorization matrix, the policy test, the
// isolation matrix; P7): a customer of a business in a given branch, made as the table owner, and sample bodies for the
// customers' commands.

/** A phone number no other test uses (normalised: +234 and ten digits). */
export const uniquePhone = () =>
  `+234${String(randomBytes(5).readUIntBE(0, 5) % 10_000_000_000).padStart(10, '0')}`;

export async function customerOf(owner: pg.Client, merchantId: string, branchId: string): Promise<string> {
  return (
    await owner.query(
      `INSERT INTO customers.customers (merchant_id, branch_id, full_name, phone) VALUES ($1, $2, 'Matrix customer', $3)
       RETURNING id`,
      [merchantId, branchId, uniquePhone()],
    )
  ).rows[0].id as string;
}

/** Valid request bodies of the customers' commands, in the caller's own branch. */
export const customerBodies = {
  createCustomer: (w: { branchId: string }) => ({
    branchId: w.branchId,
    fullName: 'Matrix customer',
    phone: uniquePhone(),
  }),
  updateCustomer: () => ({ nickname: `Nick ${randomBytes(3).toString('hex')}` }),
  assignCustomerAgent: () => ({ agentMembershipId: null }),
  createAgentCustomer: (w: { branchId: string }) => ({
    branchId: w.branchId,
    fullName: 'Field customer',
    phone: uniquePhone(),
  }),
};

/** The business's customer rows, for the snapshots that prove a refused call changed nothing. */
export const CUSTOMERS_SNAPSHOT_SQL = `
  'customers', (SELECT json_agg(c ORDER BY c.id) FROM customers.customers c WHERE c.merchant_id = $1),
  'assignments', (SELECT json_agg(a ORDER BY a.id) FROM customers.assignments a WHERE a.merchant_id = $1)`;
