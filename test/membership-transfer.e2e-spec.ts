import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, daysBetween, today } from '../src/common/utils/date.util';
import {
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 회원권 양도 검증. → ADR-012
 *
 * 홀딩이 걸린 상태의 양도가 핵심이다. 단순 취소로 처리하면
 * 이미 지나간 홀딩 일수가 사라져 회원이 손해를 본다.
 */
describe('회원권 양도 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  /** 양도인 */
  let fromUserId: string;
  /** 양수인 */
  let toUserId: string;

  async function createType(options: {
    durationDays: number;
    holdingLimit?: number;
    category?: string;
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
    userId: string,
    startDate?: string,
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId,
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

    fromUserId = (
      await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'from_member',
        password: 'password1234',
        name: '양도인',
      })
    ).userId;

    toUserId = (
      await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'to_member',
        password: 'password1234',
        name: '양수인',
      })
    ).userId;
  });

  describe('기본 양도', () => {
    it('잔여 일수가 양수인에게 이전되고 원본은 종료된다', async () => {
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId, memo: '가족 양도' })
        .expect(201);

      expect(res.body.data.transferredDays).toBe(30);
      expect(res.body.data.fee).toBeNull();

      // 원본은 이력으로 남는다. 삭제되지 않는다
      const original = await getMembership(source.id);
      expect(original.status).toBe('TRANSFERRED');

      // 양수인의 새 회원권
      const created = await getMembership(res.body.data.toMembershipId);
      expect(created.startDate).toBe(today());
      expect(created.endDate).toBe(addDays(today(), 29));
    });

    it('양수인이 같은 카테고리를 보유하면 이어붙는다', async () => {
      // 날짜를 그대로 복사하면 기간이 겹쳐 두 건이 동시에 활성이 된다
      const typeId = await createType({ durationDays: 30 });
      const existing = await grant(typeId, toUserId);
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      const created = await getMembership(res.body.data.toMembershipId);
      expect(created.startDate).toBe(addDays(existing.endDate, 1));
    });

    it('수수료를 입력하면 결제가 기록된다', async () => {
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId, fee: 50_000, memo: '지인 양도' })
        .expect(201);

      expect(res.body.data.fee).toBe(50_000);
    });

    it('무료 양도는 결제를 만들지 않는다', async () => {
      // 0원짜리 결제가 쌓이면 매출 통계가 지저분해진다
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId, fee: 0 })
        .expect(201);

      expect(res.body.data.fee).toBeNull();
    });

    it('양수인의 회원권에는 결제가 연결되지 않는다', async () => {
      // 양도는 새 매출이 아니다. 복제하면 같은 돈이 두 번 계상된다
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      const created = await getMembership(res.body.data.toMembershipId);
      expect(created.payment).toBeNull();

      // 원본 결제는 양도인에게 그대로 남는다
      const original = await getMembership(source.id);
      expect(original.payment).not.toBeNull();
    });
  });

  describe('홀딩이 걸린 상태의 양도', () => {
    it('진행 중인 홀딩은 조기 종료되고 지나간 일수는 보존된다', async () => {
      // 이 프로젝트에서 가장 정확해야 하는 계산이다.
      //
      // 30일권을 10일 전에 시작 → 원래 종료일 = start + 29
      // 6일 전 ~ 4일 후 홀딩(11일) → 종료일이 11일 밀린다
      // 오늘 양도하면?
      //   단순 취소  → 홀딩 11일이 통째로 사라져 이미 홀딩이던 6일을 손해
      //   조기 종료  → 6일 전 ~ 어제(6일)만 인정 → 정확
      const typeId = await createType({ durationDays: 30, holdingLimit: 3 });
      const start = addDays(today(), -10);
      const source = await grant(typeId, fromUserId, start);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: source.id,
          startDate: addDays(today(), -6),
          endDate: addDays(today(), 4),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      // 홀딩이 -6 ~ -1 (6일)로 단축된다
      // 종료일 = start + 29 + 6
      // 잔여 = 종료일 - 오늘 + 1
      const expectedEnd = addDays(start, 29 + 6);
      const expectedRemaining = daysBetween(today(), expectedEnd) + 1;

      expect(res.body.data.transferredDays).toBe(expectedRemaining);

      const created = await getMembership(res.body.data.toMembershipId);
      expect(created.endDate).toBe(addDays(today(), expectedRemaining - 1));
    });

    it('아직 시작하지 않은 홀딩은 취소된다', async () => {
      // 홀딩된 날이 하루도 없으므로 통째로 걷어낸다
      const typeId = await createType({ durationDays: 30, holdingLimit: 3 });
      const source = await grant(typeId, fromUserId);

      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: source.id,
          startDate: addDays(today(), 5),
          endDate: addDays(today(), 9),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      // 홀딩이 없던 것과 같아야 한다
      expect(res.body.data.transferredDays).toBe(30);
    });
  });

  describe('양도권 제약', () => {
    it('양도받은 회원권은 홀딩할 수 없다', async () => {
      // 원본과 같은 종류를 참조하므로 그 종류의 holdingLimit이 적용되면 안 된다
      const typeId = await createType({ durationDays: 30, holdingLimit: 5 });
      const source = await grant(typeId, fromUserId);

      const transfer = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: transfer.body.data.toMembershipId,
          startDate: addDays(today(), 3),
          endDate: addDays(today(), 5),
        })
        .expect(409);

      expect(res.body.errorCode).toBe('HOLD_NOT_ALLOWED_FOR_TRANSFERRED');
    });

    it('양도받은 회원권을 다시 양도할 수 있다', async () => {
      // 받은 사람이 사정이 생겨 또 넘기는 일은 충분히 발생한다
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const first = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      const third = await signupAndLogin(app, TEST_GYM.id, {
        loginId: 'third_member',
        password: 'password1234',
        name: '제3자',
      });

      await request(app.getHttpServer())
        .post(`/memberships/${first.body.data.toMembershipId}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId: third.userId })
        .expect(201);
    });
  });

  describe('검증', () => {
    it('본인에게는 양도할 수 없다', async () => {
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId: fromUserId })
        .expect(400);

      expect(res.body.errorCode).toBe('TRANSFER_SAME_USER');
    });

    it('이미 양도한 회원권은 다시 양도할 수 없다', async () => {
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(409);

      expect(res.body.errorCode).toBe('INVALID_MEMBERSHIP_STATUS');
    });

    it('만료된 회원권은 양도할 수 없다', async () => {
      const typeId = await createType({ durationDays: 5 });
      const source = await grant(typeId, fromUserId, addDays(today(), -10));

      const res = await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(409);

      expect(res.body.errorCode).toBe('TRANSFER_NO_REMAINING_DAYS');
    });
  });

  describe('이력 조회', () => {
    it('준 것과 받은 것이 모두 조회된다', async () => {
      const typeId = await createType({ durationDays: 30 });
      const source = await grant(typeId, fromUserId);

      await request(app.getHttpServer())
        .post(`/memberships/${source.id}/transfer`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ toUserId })
        .expect(201);

      for (const userId of [fromUserId, toUserId]) {
        const res = await request(app.getHttpServer())
          .get(`/memberships/transfers/history?userId=${userId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        expect(res.body.data).toHaveLength(1);
      }
    });
  });
});
