import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, today } from '../src/common/utils/date.util';
import {
  TEST_GYM,
  clearDatabase,
  createGym,
  createOwner,
  createTestApp,
} from './setup/e2e-setup';

/**
 * 회원 상태·만료 필터 검증. → ADR-015
 *
 * 핵심은 셋이다.
 * ① `expiringInDays`가 범위가 아니라 정확값인가 (중복 발송 방지)
 * ② 이어붙인 회원권이 임박으로 잘못 잡히지 않는가
 * ③ 상태 탭이 서로 겹치지 않는가
 */
describe('회원 필터 조회 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  const typeIds = new Map<string, string>();

  /** 카테고리별 회원권 종류를 만들어 캐시한다 */
  async function typeFor(category: string): Promise<string> {
    const cached = typeIds.get(category);
    if (cached) return cached;

    const res = await request(app.getHttpServer())
      .post('/membership-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `${category} 30일`,
        category,
        durationDays: 30,
        price: 100_000,
        holdingLimit: 3,
      })
      .expect(201);

    typeIds.set(category, res.body.data.id);
    return res.body.data.id;
  }

  async function createMember(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        loginId: `m_${Math.random().toString(36).slice(2, 10)}`,
        password: 'password1234',
        name,
      })
      .expect(201);
    return res.body.data.id;
  }

  /**
   * 종료일이 `endDate`가 되도록 시작일을 역산해 부여한다.
   *
   * ⚠️ 30일권이므로 `endDate`가 30일 이상 미래면 **시작일도 미래가 된다.**
   * "오늘 이용 중"인 회원을 만들려면 `endDate`를 29일 이내로 잡아야 한다.
   */
  async function grant(
    userId: string,
    category: string,
    endDate: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        userId,
        membershipTypeId: await typeFor(category),
        startDate: addDays(endDate, -29),
      })
      .expect(201);
  }

  /** 조건에 맞는 회원 이름 목록 */
  async function names(query: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/users?role=MEMBER&limit=100&${query}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return res.body.data.items.map((u: { name: string }) => u.name).sort();
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(app);
    typeIds.clear();
    await createGym(app, TEST_GYM);
    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_flt')).accessToken;
  });

  describe('만료 임박 — 정확값', () => {
    beforeEach(async () => {
      // D-3, D-5, D-7 회원을 각각 만든다
      await grant(await createMember('삼일'), '헬스', addDays(today(), 3));
      await grant(await createMember('오일'), '헬스', addDays(today(), 5));
      await grant(await createMember('칠일'), '헬스', addDays(today(), 7));
    });

    it('정확히 N일 남은 회원만 나온다', async () => {
      // 범위(<=)로 구현하면 세 명이 다 나온다.
      // 매일 돌릴 때 한 사람에게 문자가 여러 번 가는 것을 막는 지점이다
      expect(await names('expiringInDays=3')).toEqual(['삼일']);
      expect(await names('expiringInDays=5')).toEqual(['오일']);
      expect(await names('expiringInDays=7')).toEqual(['칠일']);
    });

    it('해당하는 회원이 없으면 빈 목록', async () => {
      expect(await names('expiringInDays=4')).toEqual([]);
    });

    it('이어붙인 회원권은 임박이 아니다', async () => {
      // 헬스 3일 남았지만 그 뒤로 회원권이 이어져 있다.
      // 개별 endDate만 보면 임박으로 잡혀 "곧 만료됩니다" 문자가 잘못 나간다
      const id = await createMember('이어붙임');
      await grant(id, '헬스', addDays(today(), 3));
      await grant(id, '헬스', addDays(today(), 33));

      expect(await names('expiringInDays=3')).toEqual(['삼일']);
      expect(await names('expiringInDays=33')).toEqual(['이어붙임']);
    });
  });

  describe('카테고리 구분', () => {
    it('카테고리를 지정하면 그 회원권만 본다', async () => {
      // 헬스는 D-95인데 락커가 D-3인 회원.
      // 카테고리 없이 뭉치면 락커 임박이 헬스에 가려진다
      const id = await createMember('락커임박');
      await grant(id, '헬스', addDays(today(), 95));
      await grant(id, '락커', addDays(today(), 3));

      expect(await names('category=락커&expiringInDays=3')).toEqual([
        '락커임박',
      ]);
      expect(await names('category=헬스&expiringInDays=3')).toEqual([]);
    });

    it('카테고리를 생략하면 어느 하나라도 해당하면 나온다', async () => {
      const id = await createMember('락커임박');
      await grant(id, '헬스', addDays(today(), 95));
      await grant(id, '락커', addDays(today(), 3));

      expect(await names('expiringInDays=3')).toEqual(['락커임박']);
    });
  });

  describe('만료 후 — 범위', () => {
    it('N일 이내에 만료된 회원이 나온다', async () => {
      await grant(await createMember('어제만료'), '헬스', addDays(today(), -1));
      await grant(await createMember('한달전'), '헬스', addDays(today(), -20));
      await grant(await createMember('작년'), '헬스', addDays(today(), -400));

      expect(await names('expiredWithinDays=30')).toEqual([
        '어제만료',
        '한달전',
      ]);
    });

    it('오늘 만료되는 회원은 아직 만료가 아니다', async () => {
      // endDate가 오늘이면 오늘까지 이용할 수 있다. D-day는 0이다
      await grant(await createMember('오늘까지'), '헬스', today());

      expect(await names('expiredWithinDays=30')).toEqual([]);
      expect(await names('expiringInDays=0')).toEqual(['오늘까지']);
    });
  });

  describe('상태 탭', () => {
    let activeId: string;
    let holdId: string;

    beforeEach(async () => {
      activeId = await createMember('이용중');
      await grant(activeId, '헬스', addDays(today(), 20));

      holdId = await createMember('홀딩중');
      await grant(holdId, '헬스', addDays(today(), 20));
      const list = await request(app.getHttpServer())
        .get(`/memberships?userId=${holdId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/holds')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          userMembershipId: list.body.data[0].id,
          startDate: today(),
          endDate: addDays(today(), 5),
        })
        .expect(201);

      await grant(await createMember('만료됨'), '헬스', addDays(today(), -10));
      await createMember('회원권없음');
    });

    it('ACTIVE와 ON_HOLD는 겹치지 않는다', async () => {
      // 겹치면 "활성 12명 + 홀딩 3명"을 더해 전체를 셀 수 없다
      expect(await names('membershipStatus=ACTIVE')).toEqual(['이용중']);
      expect(await names('membershipStatus=ON_HOLD')).toEqual(['홀딩중']);
    });

    it('EXPIRED는 기간 제한 없이 전부', async () => {
      await grant(
        await createMember('아주오래전'),
        '헬스',
        addDays(today(), -900),
      );

      expect(await names('membershipStatus=EXPIRED')).toEqual([
        '만료됨',
        '아주오래전',
      ]);
    });

    it('NONE은 회원권을 산 적이 없는 회원', async () => {
      expect(await names('membershipStatus=NONE')).toEqual(['회원권없음']);
    });

    it('ALL은 전체', async () => {
      expect(await names('membershipStatus=ALL')).toHaveLength(4);
    });

    it('EXPIRING은 14일 이내', async () => {
      await grant(await createMember('십사일'), '헬스', addDays(today(), 14));
      await grant(await createMember('십오일'), '헬스', addDays(today(), 15));

      expect(await names('membershipStatus=EXPIRING')).toEqual(['십사일']);
    });
  });

  describe('신규 회원', () => {
    it('운동을 시작한 지 N일 이내인 회원', async () => {
      await grant(await createMember('오늘시작'), '헬스', addDays(today(), 29));
      await grant(await createMember('열흘전'), '헬스', addDays(today(), 19));

      expect(await names('startedWithinDays=7')).toEqual(['오늘시작']);
    });

    it('이어서 재등록한 회원은 신규가 아니다', async () => {
      // 공백 없이 이어붙였으므로 계속 다니던 회원이다
      const id = await createMember('계속다님');
      await grant(id, '헬스', addDays(today(), -1));
      await grant(id, '헬스', addDays(today(), 29));

      expect(await names('startedWithinDays=7')).toEqual([]);
    });

    it('1년 넘게 쉬었다 돌아오면 신규로 본다', async () => {
      // 공백 400일. 사실상 새로 시작하는 회원이라 쿠폰·만족도 조사 대상이다
      const id = await createMember('복귀');
      await grant(id, '헬스', addDays(today(), -400));
      await grant(id, '헬스', addDays(today(), 29));

      expect(await names('startedWithinDays=7')).toEqual(['복귀']);
    });
  });

  describe('권한', () => {
    it('페이지네이션이 유지된다', async () => {
      // 필터가 조인이면 회원이 중복 행으로 나와 total이 부풀어 오른다
      const id = await createMember('회원권세개');
      await grant(id, '헬스', addDays(today(), 10));
      await grant(id, '락커', addDays(today(), 10));
      await grant(id, '운동복', addDays(today(), 10));

      const res = await request(app.getHttpServer())
        .get('/users?role=MEMBER&membershipStatus=ACTIVE')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.items).toHaveLength(1);
    });
  });
});
