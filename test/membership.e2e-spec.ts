import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, daysBetween, today } from '../src/common/utils/date.util';
import {
  OTHER_GYM,
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 회원권 도메인 검증. → ADR-010
 *
 * 날짜 계산이 핵심이라 눈으로 확인하기 어렵다.
 * 특히 자동 이어붙이기는 카테고리·종료일이 얽혀 있어 수동 검증이 부정확하다.
 */
describe('회원권 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let memberId: string;

  /** 회원권 종류를 만들고 id를 반환한다 */
  async function createType(
    name: string,
    category: string,
    durationDays: number,
    price = 100_000,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/membership-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name, category, durationDays, price })
      .expect(201);
    return res.body.data.id;
  }

  async function grant(
    typeId: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberId, membershipTypeId: typeId, ...body })
      .expect(201);
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

    const owner = await createOwner(app, TEST_GYM.id, 'gym_owner');
    ownerToken = owner.accessToken;

    const member = await signupAndLogin(app, TEST_GYM.id, {
      loginId: 'test_member',
      password: 'password1234',
      name: '테스트 회원',
    });
    memberId = member.userId;
  });

  describe('회원권 종류', () => {
    it('등록하면 판매 중 상태가 된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/membership-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: '헬스 3개월',
          category: '헬스',
          durationDays: 90,
          price: 270_000,
        })
        .expect(201);

      expect(res.body.data.category).toBe('헬스');
      expect(res.body.data.isActive).toBe(true);
    });

    it('판매 중지하면 목록에서 빠지지만 삭제되지는 않는다', async () => {
      const typeId = await createType('헬스 3개월', '헬스', 90);

      await request(app.getHttpServer())
        .patch(`/membership-types/${typeId}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const active = await request(app.getHttpServer())
        .get('/membership-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(active.body.data).toHaveLength(0);

      // 이미 판매된 회원권이 참조하므로 물리 삭제하지 않는다
      const all = await request(app.getHttpServer())
        .get('/membership-types?includeInactive=true')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0].isActive).toBe(false);
    });

    it('판매 중지된 종류로는 부여할 수 없다', async () => {
      const typeId = await createType('헬스 3개월', '헬스', 90);
      await request(app.getHttpServer())
        .patch(`/membership-types/${typeId}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/memberships')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: memberId, membershipTypeId: typeId })
        .expect(400);

      expect(res.body.errorCode).toBe('MEMBERSHIP_TYPE_INACTIVE');
    });
  });

  describe('종료일 계산', () => {
    it('1일권은 시작일 당일에 끝난다', async () => {
      // durationDays - 1을 하지 않으면 1일권이 이틀이 된다
      const typeId = await createType('1일권', '헬스', 1);
      const membership = await grant(typeId);

      expect(membership.startDate).toBe(today());
      expect(membership.endDate).toBe(today());
    });

    it('30일권은 시작일 포함 30일간 유효하다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);
      const membership = await grant(typeId);

      expect(daysBetween(membership.startDate, membership.endDate)).toBe(29);
    });

    it('시작일을 지정하면 그 날부터 계산한다', async () => {
      // "오늘 결제하고 다음 주부터 이용" 하는 회원이 있다
      const typeId = await createType('헬스 30일', '헬스', 30);
      const nextWeek = addDays(today(), 7);

      const membership = await grant(typeId, { startDate: nextWeek });

      expect(membership.startDate).toBe(nextWeek);
      expect(membership.endDate).toBe(addDays(nextWeek, 29));
    });
  });

  describe('자동 이어붙이기', () => {
    it('같은 카테고리를 추가하면 기존 종료일 다음날부터 시작한다', async () => {
      // 만료 임박 상태에서 추가 결제해도 잔여 기간이 버려지지 않아야 한다
      const shortType = await createType('헬스 30일', '헬스', 30);
      const longType = await createType('헬스 365일', '헬스', 365);

      const first = await grant(shortType);
      const second = await grant(longType);

      expect(second.startDate).toBe(addDays(first.endDate, 1));
      expect(second.endDate).toBe(addDays(second.startDate, 364));
    });

    it('다른 카테고리는 오늘부터 시작한다', async () => {
      // 헬스와 락커는 동시에 진행되어야 한다
      const healthType = await createType('헬스 365일', '헬스', 365);
      const lockerType = await createType('락커 365일', '락커', 365);

      await grant(healthType);
      const locker = await grant(lockerType);

      expect(locker.startDate).toBe(today());
    });

    it('세 번 연속 부여하면 차례로 이어진다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);

      const first = await grant(typeId);
      const second = await grant(typeId);
      const third = await grant(typeId);

      expect(second.startDate).toBe(addDays(first.endDate, 1));
      expect(third.startDate).toBe(addDays(second.endDate, 1));
    });

    it('취소된 회원권 뒤에는 이어붙이지 않는다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);

      const first = await grant(typeId);
      await request(app.getHttpServer())
        .patch(`/memberships/${first.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const second = await grant(typeId);

      expect(second.startDate).toBe(today());
    });

    it('시작일을 명시하면 이어붙이기보다 우선한다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);
      await grant(typeId);

      const explicit = addDays(today(), 100);
      const second = await grant(typeId, { startDate: explicit });

      expect(second.startDate).toBe(explicit);
    });
  });

  describe('잔여일', () => {
    it('만료일이 오늘이면 0이다 (D-day)', async () => {
      const typeId = await createType('1일권', '헬스', 1);
      const membership = await grant(typeId);

      expect(membership.daysUntilExpiry).toBe(0);
    });

    it('30일권을 오늘 시작하면 29다', async () => {
      // "N일 남음"이 아니라 D-day 표기다. 오늘까지 이용 가능하면 0
      const typeId = await createType('헬스 30일', '헬스', 30);
      const membership = await grant(typeId);

      expect(membership.daysUntilExpiry).toBe(29);
    });
  });

  describe('결제 기록', () => {
    it('부여 시 결제가 함께 생성된다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30, 150_000);
      const membership = await grant(typeId);

      expect(membership.payment).toEqual({
        amount: 150_000,
        method: 'MANUAL',
      });
    });

    it('금액을 지정하면 할인 판매가 된다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30, 150_000);
      const membership = await grant(typeId, { amount: 120_000 });

      expect(membership.payment.amount).toBe(120_000);
    });

    it('메모는 형식을 강제하지 않는다', async () => {
      const typeId = await createType('헬스 12개월', '헬스', 365);
      const memo = '*26.08.06 H12 + 락커12 [카 55만]';

      const membership = await grant(typeId, { memo });

      expect(membership.memo).toBe(memo);
    });
  });

  describe('회원 조회에 회원권 포함', () => {
    it('회원 상세에 이용 중인 회원권이 카테고리별로 나온다', async () => {
      const healthType = await createType('헬스 365일', '헬스', 365);
      const lockerType = await createType('락커 365일', '락커', 365);
      await grant(healthType);
      await grant(lockerType);

      const res = await request(app.getHttpServer())
        .get(`/users/${memberId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const categories = res.body.data.memberships.map(
        (m: { category: string }) => m.category,
      );
      expect(categories).toContain('헬스');
      expect(categories).toContain('락커');
    });

    it('회원 목록에도 회원권이 함께 조회된다', async () => {
      const typeId = await createType('헬스 365일', '헬스', 365);
      await grant(typeId);

      const res = await request(app.getHttpServer())
        .get('/users?name=테스트')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const target = res.body.data.items.find(
        (u: { id: string }) => u.id === memberId,
      );
      expect(target.memberships).toHaveLength(1);
      expect(target.memberships[0].daysUntilExpiry).toBe(364);
    });

    it('취소된 회원권은 요약에서 제외된다', async () => {
      const typeId = await createType('헬스 365일', '헬스', 365);
      const membership = await grant(typeId);

      await request(app.getHttpServer())
        .patch(`/memberships/${membership.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/users/${memberId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.memberships).toHaveLength(0);
    });
  });

  describe('연장·취소', () => {
    it('연장하면 종료일이 뒤로 밀린다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);
      const membership = await grant(typeId);

      const res = await request(app.getHttpServer())
        .patch(`/memberships/${membership.id}/extend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ days: 7, reason: '시설 공사로 인한 휴관 보상' })
        .expect(200);

      expect(res.body.data.endDate).toBe(addDays(membership.endDate, 7));
      // 사유가 메모에 누적되어 나중에 추적할 수 있어야 한다
      expect(res.body.data.memo).toContain('시설 공사');
    });

    it('취소된 회원권은 다시 변경할 수 없다', async () => {
      const typeId = await createType('헬스 30일', '헬스', 30);
      const membership = await grant(typeId);

      await request(app.getHttpServer())
        .patch(`/memberships/${membership.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/memberships/${membership.id}/extend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ days: 7, reason: '테스트' })
        .expect(409);

      expect(res.body.errorCode).toBe('INVALID_MEMBERSHIP_STATUS');
    });
  });

  describe('테넌트 격리', () => {
    it('다른 헬스장 회원에게는 부여할 수 없다', async () => {
      await createGym(app, OTHER_GYM);
      const other = await signupAndLogin(app, OTHER_GYM.id, {
        loginId: 'other_member',
        password: 'password1234',
        name: '타 헬스장 회원',
      });
      const typeId = await createType('헬스 30일', '헬스', 30);

      const res = await request(app.getHttpServer())
        .post('/memberships')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: other.userId, membershipTypeId: typeId })
        .expect(404);

      expect(res.body.errorCode).toBe('USER_NOT_FOUND');
    });
  });
});
