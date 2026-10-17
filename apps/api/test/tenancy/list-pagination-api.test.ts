import { InvitationList, MemberList } from '@alphakolect/contracts';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { expectError, tenancyFixtures, uniqueEmail } from '../support/tenancy.js';

// O9 through the real app (decided by the owner, 2026-10-11; P5 plan §10 P5.8; ADR-16's frozen contracts): the
// members list, oldest first, and the invitations list, newest first — the open ones (pending and unexpired) unless
// status=all — page by page, with cursors bound to their list and status filter. The business always comes from the
// session: a cursor carries a position only.

const { app, auth } = await createTestApp();
const fx = tenancyFixtures(app, auth);
const { call } = fx;

/** Every page of a list from its first, joined. */
async function walk<T>(token: string, path: string, limit: number, items: (body: unknown) => T[]) {
  const all: T[] = [];
  let cursor: string | null = null;
  const sep = path.includes('?') ? '&' : '?';
  for (let n = 0; n < 100; n++) {
    const res = await call(token, 'get', `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const page = items(res.body);
    expect(page.length).toBeLessThanOrEqual(limit);
    all.push(...page);
    cursor = (res.body as { nextCursor: string | null }).nextCursor;
    if (!cursor) return all;
  }
  throw new Error('the walk did not end');
}

describe('the members, oldest first, page by page', () => {
  it('the pages join into the whole list; the last one has no cursor', async () => {
    const b = await fx.business();
    const added = [];
    for (let i = 0; i < 4; i++) added.push((await fx.member(b, i % 2 ? 'agent' : 'staff')).membershipId);
    const whole = MemberList.parse((await call(b.owner.token, 'get', '/v1/merchant/members?limit=100')).body);
    expect(whole.items.map((m) => m.membershipId)).toEqual([b.owner.membershipId, ...added]);
    expect(whole.nextCursor).toBeNull();
    for (const limit of [1, 2, 3]) {
      const joined = await walk(
        b.owner.token,
        '/v1/merchant/members',
        limit,
        (x) => MemberList.parse(x).items,
      );
      expect(
        joined.map((m) => m.membershipId),
        `limit ${limit}`,
      ).toEqual(whole.items.map((m) => m.membershipId));
    }
  });

  it('another business’s cursor positions within this business only: nothing of the other’s appears', async () => {
    const [a, b] = [await fx.business(), await fx.business()];
    await fx.member(a, 'agent');
    await fx.member(b, 'agent');
    const aCursor = (await call(a.owner.token, 'get', '/v1/merchant/members?limit=1')).body
      .nextCursor as string;
    const res = await call(b.owner.token, 'get', `/v1/merchant/members?cursor=${aCursor}`);
    expect(res.status).toBe(200);
    const ids = MemberList.parse(res.body).items.map((m) => m.membershipId);
    const aIds = MemberList.parse((await call(a.owner.token, 'get', '/v1/merchant/members')).body).items.map(
      (m) => m.membershipId,
    );
    expect(ids.filter((id) => aIds.includes(id))).toEqual([]);
  });
});

describe('the invitations, newest first: open by default, or all', () => {
  it('open is pending and unexpired; all is every one; both page by page', async () => {
    const b = await fx.business();
    const invite = async (tag: string) =>
      (
        await call(b.owner.token, 'post', '/v1/merchant/invitations', {
          email: uniqueEmail(tag),
          kind: 'agent',
        })
      ).body.invitationId as string;
    const ids = [await invite('i0'), await invite('i1'), await invite('i2'), await invite('i3')];
    await call(b.owner.token, 'post', `/v1/merchant/invitations/${ids[1]}/revoke`);
    const newestFirst = [...ids].reverse();
    const open = await walk(
      b.owner.token,
      '/v1/merchant/invitations',
      1,
      (x) => InvitationList.parse(x).items,
    );
    expect(open.map((i) => i.invitationId)).toEqual(newestFirst.filter((id) => id !== ids[1]));
    expect(open.every((i) => i.status === 'pending')).toBe(true);
    const all = await walk(
      b.owner.token,
      '/v1/merchant/invitations?status=all',
      2,
      (x) => InvitationList.parse(x).items,
    );
    expect(all.map((i) => i.invitationId)).toEqual(newestFirst);
  });

  it('a cursor belongs to its list and status: another status’s, another list’s, a forged or impossible one is 400 INVALID_CURSOR', async () => {
    const b = await fx.business();
    for (const tag of ['c0', 'c1'])
      await call(b.owner.token, 'post', '/v1/merchant/invitations', {
        email: uniqueEmail(tag),
        kind: 'agent',
      });
    await fx.member(b, 'agent');
    const allCursor = (await call(b.owner.token, 'get', '/v1/merchant/invitations?status=all&limit=1')).body
      .nextCursor as string;
    const membersCursor = (await call(b.owner.token, 'get', '/v1/merchant/members?limit=1')).body
      .nextCursor as string;
    const month99 = (cursor: string) => {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { at: string };
      value.at = value.at.replace(/^(\d{4})-\d{2}/, '$1-99');
      return Buffer.from(JSON.stringify(value)).toString('base64url');
    };
    for (const path of [
      `/v1/merchant/invitations?cursor=${allCursor}`, // status=all's cursor on the open list
      `/v1/merchant/invitations?status=all&cursor=${membersCursor}`,
      `/v1/merchant/members?cursor=${allCursor}`,
      `/v1/merchant/invitations?status=all&cursor=${month99(allCursor)}`,
      `/v1/merchant/members?cursor=${month99(membersCursor)}`,
      `/v1/merchant/members?cursor=not-a-cursor`,
    ])
      expectError(await call(b.owner.token, 'get', path), 400, 'INVALID_CURSOR');
    expectError(
      await call(b.owner.token, 'get', '/v1/merchant/invitations?status=expired'),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await call(b.owner.token, 'get', '/v1/merchant/members?limit=0'), 400, 'VALIDATION_ERROR');
  });
});
