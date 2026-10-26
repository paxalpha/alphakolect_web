import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { uniquePhone } from './customers.js';

// Savings for tests that call every endpoint of the registry (the authorization matrix, the policy test, the isolation
// matrix; P8): a business's package, and a collection its agent recorded for an enrolled customer of theirs — made with
// the savings functions, as the API would — and sample bodies for the savings commands.

export type SavingsResources = {
  packageId: string;
  /** An enrolled customer of the agent's. */
  customerId: string;
  /** A recorded collection, for the cancellation. */
  collectionId: string;
  /** Another, for the remittance. */
  remittedId: string;
  agentMembershipId: string;
};

export async function savingsResources(
  owner: pg.Client,
  merchantId: string,
  branchId: string,
  ownerSessionId: string,
  /** The agent whose customer it is; a new one when not given. */
  agent?: { membershipId: string; sessionId: string },
): Promise<SavingsResources> {
  const one = async (sql: string, params: unknown[]) => (await owner.query(sql, params)).rows[0];
  const packageId = (
    await one(`SELECT id FROM savings.create_package($1, $2, 'fixed', 100000, 'first_contribution', NULL)`, [
      ownerSessionId,
      `Matrix ${randomBytes(3).toString('hex')}`,
    ])
  ).id as string;
  let agentMembershipId = agent?.membershipId;
  let agentSession = agent?.sessionId;
  if (!agentMembershipId || !agentSession) {
    const identityId = (
      await one(
        `INSERT INTO identity.identities (email, email_verified_at) VALUES ($1, now()) RETURNING id`,
        [`matrix-agent-${randomBytes(6).toString('hex')}@example.test`],
      )
    ).id as string;
    agentMembershipId = (
      await one(
        `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind) VALUES ($1, $2, 'agent') RETURNING id`,
        [merchantId, identityId],
      )
    ).id as string;
    agentSession = (
      await one(
        `SELECT session_id FROM identity.create_session($1, 'agent', $2, 'full', $3, 86400, 1209600, NULL, NULL)`,
        [identityId, agentMembershipId, createHash('sha256').update(randomBytes(32)).digest('hex')],
      )
    ).session_id as string;
  }
  const customerId = (
    await one(`SELECT id FROM customers.create_customer($1, $2, 'Saver', $3, NULL, NULL, NULL, $4)`, [
      ownerSessionId,
      branchId,
      uniquePhone(),
      agentMembershipId,
    ])
  ).id as string;
  await owner.query(`SELECT * FROM savings.enrol_customer($1, $2, $3)`, [
    ownerSessionId,
    customerId,
    packageId,
  ]);
  const recorded = async () =>
    (
      await one(`SELECT id FROM savings.record_collection($1, $2, 100000, $3)`, [
        agentSession,
        customerId,
        `matrix-${randomBytes(8).toString('hex')}`,
      ])
    ).id as string;
  return {
    packageId,
    customerId,
    collectionId: await recorded(),
    remittedId: await recorded(),
    agentMembershipId,
  };
}

/** Valid request bodies of the savings commands. */
export const savingsBodies = {
  createSavingsPackage: () => ({
    name: `Matrix ${randomBytes(3).toString('hex')}`,
    kind: 'flexible',
    amountMinor: '5000',
    feeRule: 'percentage',
    feeRateBp: 200,
  }),
  updateSavingsPackage: () => ({ name: `Matrix ${randomBytes(3).toString('hex')}` }),
  enrolCustomer: (w: { savings: SavingsResources }) => ({ packageId: w.savings.packageId }),
  cancelCollection: () => ({ reason: 'Recorded by mistake' }),
  createRemittance: (w: { savings: SavingsResources }) => ({
    agentMembershipId: w.savings.agentMembershipId,
    collectionIds: [w.savings.remittedId],
    cashMinor: '100000',
  }),
  createWithdrawal: () => ({ wallet: 'savings', amountMinor: '1' }),
  createTargetTransfer: () => ({ amountMinor: '1' }),
  setTargetGoal: () => ({ goalAmountMinor: '100000', goalDate: null }),
  recordCollection: (w: { savings: SavingsResources }) => ({
    customerId: w.savings.customerId,
    amountMinor: '100000',
  }),
};

/** The business's savings rows, for the snapshots that prove a refused call changed nothing. */
export const SAVINGS_SNAPSHOT_SQL = `
  'packages', (SELECT json_agg(p ORDER BY p.id) FROM savings.packages p WHERE p.merchant_id = $1),
  'enrolments', (SELECT json_agg(e ORDER BY e.id) FROM savings.enrolments e WHERE e.merchant_id = $1),
  'collections', (SELECT json_agg(c ORDER BY c.id) FROM savings.collections c WHERE c.merchant_id = $1),
  'remittances', (SELECT count(*) FROM savings.remittances r WHERE r.merchant_id = $1),
  'movements', (SELECT count(*) FROM savings.movements m WHERE m.merchant_id = $1),
  'goals', (SELECT json_agg(g ORDER BY g.id) FROM savings.target_goals g WHERE g.merchant_id = $1)`;
