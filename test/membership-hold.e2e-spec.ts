import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, today } from '../src/common/utils/date.util';
import {
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 홀딩(휴회) 검증. → ADR-011
 *
 * 종료일 재계산이 핵심이다. 잘못되면 회원이 실제로 손해를 보므로
 * 수정·취소를 반복해도 값이 정확한지 확인한다.
 */
describe('회원권 홀딩 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let memberToken: string;
  let memberId: string;

  /** 홀딩 정책을 지정해 회원권 종류를 만든다 */
  async function createType(options: {
    durationDays: number;
    holdingLimit?: number;
    holdingMaxDays?: number;
  }): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/membership-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `헬스 ${options.durationDays}일`,
        category: '헬스',
        price: 100_000,
        ...options,
      })
      .expect(201);
    return res.body.data.id;
  }

  async function grant(
    typeId: string,
    startDate?: string,
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId: memberId,
        membershipTypeId: typeId,
        ...(startDate ? { startDate } : {}),
      })
      .expect(201);
    return res.body.data;
  }

  async function getMembership(id: string): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .get(`/memberships/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return res.body.data;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(app);
    await createGym(app, TEST_GYM);

    ownerToken = (await createOwner(app, TEST_GYM.id, 'gym_owner')).accessToken;

    const member = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'test_member',
      password: 'password1234',
      name: '테스트 회원',
    });
    memberToken = member.accessToken;
    memberId = member.userId;
  });

  describe('종료일 재계산', () => {
    it('홀딩 일수만큼 종료일이 밀린다', async () => {
      const typeId = await createType({ durationDays: 30, holdingLimit: 3 });
      const membership = await grant(typeId);

      // 5일간 홀딩 (양끝 포함)
      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 5),
        })
        .expect(201);

      const updated = await getMembership(membership.id);
      expect(updated.endDate).toBe(addDays(membership.endDate, 5));
    });

    it('홀딩을 여러 번 걸면 합산된다', async () => {
      const typeId = await createType({ durationDays: 100, holdingLimit: 5 });
      const membership = await grant(typeId);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 3),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 10),
          endDate: addDays(today(), 16),
        })
        .expect(201);

      // 3일 + 7일 = 10일
      const updated = await getMembership(membership.id);
      expect(updated.endDate).toBe(addDays(membership.endDate, 10));
    });

    it('수정을 반복해도 종료일이 정확하다', async () => {
      // 증분 조정(+10 후 -5)이었다면 여기서 어긋난다.
      // 전체 재계산이라 몇 번을 수정해도 결과가 같아야 한다
      const typeId = await createType({
        durationDays: 100,
        holdingLimit: 3,
        holdingMaxDays: 14,
      });
      const membership = await grant(typeId);

      const created = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 10),
        })
        .expect(201);
      const holdId = created.body.data.id;

      // 10일 → 5일 → 14일 → 3일
      for (const days of [5, 14, 3]) {
        await request(app.getHttpServer())
          .patch(`/holds/${holdId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ endDate: addDays(today(), days) })
          .expect(200);
      }

      const updated = await getMembership(membership.id);
      expect(updated.endDate).toBe(addDays(membership.endDate, 3));
    });

    it('홀딩을 취소하면 종료일이 원래대로 돌아간다', async () => {
      const typeId = await createType({ durationDays: 30, holdingLimit: 3 });
      const membership = await grant(typeId);

      const created = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 7),
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/holds/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const updated = await getMembership(membership.id);
      expect(updated.endDate).toBe(membership.endDate);
    });
  });

  describe('정책 검증', () => {
    it('홀딩 불가 회원권(limit 0)은 거부된다', async () => {
      const typeId = await createType({ durationDays: 30, holdingLimit: 0 });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 3),
        })
        .expect(409);

      expect(res.body.errorCode).toBe('HOLD_LIMIT_EXCEEDED');
    });

    it('1회 최대 일수를 초과하면 거부된다', async () => {
      const typeId = await createType({
        durationDays: 100,
        holdingLimit: 5,
        holdingMaxDays: 14,
      });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 1),
          endDate: addDays(today(), 15), // 15일
        })
        .expect(400);

      expect(res.body.errorCode).toBe('HOLD_DURATION_EXCEEDED');
    });

    it('횟수를 초과하면 거부된다', async () => {
      const typeId = await createType({ durationDays: 200, holdingLimit: 2 });
      const membership = await grant(typeId);

      for (const offset of [1, 20]) {
        await request(app.getHttpServer())
          .post('/holds')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            userMembershipId: membership.id,
            startDate: addDays(today(), offset),
            endDate: addDays(today(), offset + 2),
          })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 40),
          endDate: addDays(today(), 42),
        })
        .expect(409);

      expect(res.body.errorCode).toBe('HOLD_LIMIT_EXCEEDED');
    });

    it('기간이 겹치면 거부된다', async () => {
      // 겹치면 홀딩 일수가 이중으로 반영된다
      const typeId = await createType({ durationDays: 100, holdingLimit: 5 });
      const membership = await grant(typeId);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 5),
          endDate: addDays(today(), 10),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 8),
          endDate: addDays(today(), 12),
        })
        .expect(409);

      expect(res.body.errorCode).toBe('HOLD_OVERLAPPED');
    });

    it('회원권 기간을 벗어나면 거부된다', async () => {
      const typeId = await createType({ durationDays: 30, holdingLimit: 3 });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 40),
          endDate: addDays(today(), 45),
        })
        .expect(400);

      expect(res.body.errorCode).toBe('HOLD_OUT_OF_RANGE');
    });
  });

  describe('권한 — 회원과 데스크', () => {
    it('회원은 본인 회원권에 미래 날짜로 홀딩할 수 있다', async () => {
      const typeId = await createType({ durationDays: 100, holdingLimit: 3 });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 3),
          endDate: addDays(today(), 7),
        })
        .expect(201);

      // 회원이 직접 걸었음이 기록되어야 한다
      expect(res.body.data.createdByRole).toBe('MEMBER');
      expect(res.body.data.days).toBe(5);
    });

    it('회원은 과거 날짜로 홀딩할 수 없다', async () => {
      // 지난주에 안 나온 것을 "그때 홀딩이었다"로 돌려받는 악용을 막는다
      const typeId = await createType({ durationDays: 100, holdingLimit: 3 });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), -3),
          endDate: addDays(today(), 1),
        })
        .expect(403);

      expect(res.body.errorCode).toBe('HOLD_PAST_DATE_FORBIDDEN');
    });

    it('OWNER는 과거 날짜로 소급 처리할 수 있다', async () => {
      // "회원이 전화했는데 처리를 깜빡했다" 같은 정당한 소급이 필요하다
      const typeId = await createType({ durationDays: 100, holdingLimit: 3 });
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: today(),
          endDate: addDays(today(), 2),
          reason: '회원 요청 누락 정정',
        })
        .expect(201);

      expect(res.body.data.createdByRole).toBe('OWNER');
    });

    it('회원은 다른 회원의 회원권에 홀딩할 수 없다', async () => {
      const typeId = await createType({ durationDays: 100, holdingLimit: 3 });
      const other = await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'other_member',
        password: 'password1234',
        name: '다른 회원',
      });

      const otherMembership = await request(app.getHttpServer())
        .post('/memberships')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: other.userId, membershipTypeId: typeId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          userMembershipId: otherMembership.body.data.id,
          startDate: addDays(today(), 3),
          endDate: addDays(today(), 5),
        })
        .expect(404);

      expect(res.body.errorCode).toBe('MEMBERSHIP_NOT_FOUND');
    });
  });

  describe('조회', () => {
    it('진행 상태가 날짜로 판단된다', async () => {
      const typeId = await createType({ durationDays: 100, holdingLimit: 5 });
      const membership = await grant(typeId);

      const scheduled = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 10),
          endDate: addDays(today(), 12),
        })
        .expect(201);
      expect(scheduled.body.data.phase).toBe('SCHEDULED');

      const inProgress = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: today(),
          endDate: addDays(today(), 2),
        })
        .expect(201);
      expect(inProgress.body.data.phase).toBe('IN_PROGRESS');
    });

    it('오늘 종료 예정 목록이 조회된다', async () => {
      // 데스크가 아침에 확인해 해제를 깜빡하는 일을 줄인다.
      // 홀딩이 이틀 전부터 시작하므로 회원권도 그 이전에 시작해야 한다
      const typeId = await createType({ durationDays: 100, holdingLimit: 5 });
      const membership = await grant(typeId, addDays(today(), -10));

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), -2),
          endDate: today(),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/holds/ending-today')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].endDate).toBe(today());
    });

    it('현재 홀딩 중인 목록이 조회된다', async () => {
      const typeId = await createType({ durationDays: 100, holdingLimit: 5 });
      const membership = await grant(typeId);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: today(),
          endDate: addDays(today(), 3),
        })
        .expect(201);

      // 미래 홀딩은 포함되지 않아야 한다
      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: membership.id,
          startDate: addDays(today(), 20),
          endDate: addDays(today(), 22),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/holds/in-progress')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
    });
  });
});
