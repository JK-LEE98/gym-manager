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
 * 미이행 PT 계약이 있는 계정의 강등·삭제 차단. → 이슈 #37
 *
 * **원인이 하나다.** 계정 상태를 바꾸기 전에 그 계정에 걸린 의무를 확인하지 않았다.
 * 트레이너를 강등하면 `TrainerProfile`이 지워지고 담당 관계가 끊기며,
 * 삭제하면 계약이 조회에서 통째로 사라진다.
 * 1:1 전속이라 **대체 트레이너도 없어** 회원은 잔여 횟수를 쓸 방법이 없다.
 */
describe('계정 변경 가드 (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let memberId: string;
  let trainerId: string;
  let contractId: string;

  async function promote(loginId: string, name: string): Promise<string> {
    const trainer = await signupAndLogin(app, TEST_GYM.id, {
      loginId,
      password: 'password1234',
      name,
    });
    await request(app.getHttpServer())
      .patch(`/users/${trainer.userId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'TRAINER' })
      .expect(200);

    return trainer.userId;
  }

  function demote(userId: string) {
    return request(app.getHttpServer())
      .patch(`/users/${userId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MEMBER' });
  }

  function remove(userId: string) {
    return request(app.getHttpServer())
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
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
    ownerToken = (await createOwner(app, TEST_GYM.id, 'owner_grd')).accessToken;

    const member = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ loginId: 'pt_member', password: 'password1234', name: '홍길동' })
      .expect(201);
    memberId = member.body.data.id;

    trainerId = await promote('trainer_grd', '김트레이너');

    const contract = await request(app.getHttpServer())
      .post('/pt/contracts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        memberId,
        trainerId,
        totalSessions: 10,
        amount: 800_000,
        startDate: today(),
        endDate: addDays(today(), 90),
      })
      .expect(201);
    contractId = contract.body.data.id;
  });

  describe('트레이너', () => {
    it('진행 중인 계약이 있으면 강등할 수 없다', async () => {
      const res = await demote(trainerId).expect(409);

      expect(res.body.errorCode).toBe('TRAINER_HAS_ACTIVE_CONTRACT');
    });

    it('진행 중인 계약이 있으면 삭제할 수 없다', async () => {
      // 강등은 재승격으로 되돌릴 수 있지만 삭제는 계약이 조회에서 사라진다
      const res = await remove(trainerId).expect(409);

      expect(res.body.errorCode).toBe('TRAINER_HAS_ACTIVE_CONTRACT');
    });

    it('막힌 뒤에도 역할이 그대로다', async () => {
      // 검사를 트랜잭션 안에서 하면 프로필이 지워진 뒤 롤백되는 순서 문제가 생긴다
      await demote(trainerId).expect(409);

      const res = await request(app.getHttpServer())
        .get(`/users/${trainerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.role).toBe('TRAINER');
      expect(res.body.data.trainerProfile).toBeDefined();
    });

    it('계약을 취소하면 강등할 수 있다', async () => {
      await request(app.getHttpServer())
        .patch(`/pt/contracts/${contractId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await demote(trainerId).expect(200);
    });

    it('계약이 없는 트레이너는 영향을 받지 않는다', async () => {
      // 헬스장 전체가 잠기면 안 된다. 계약이 걸린 계정만 막혀야 한다
      const other = await promote('trainer_free', '나트레이너');

      await demote(other).expect(200);
    });
  });

  describe('회원', () => {
    it('잔여 횟수가 남으면 삭제할 수 없다', async () => {
      // 돈을 받은 수업이 증발한다
      const res = await remove(memberId).expect(409);

      expect(res.body.errorCode).toBe('MEMBER_HAS_ACTIVE_CONTRACT');
    });

    it('계약을 취소하면 삭제할 수 있다', async () => {
      await request(app.getHttpServer())
        .patch(`/pt/contracts/${contractId}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await remove(memberId).expect(204);
    });

    it('계약이 없는 회원은 영향을 받지 않는다', async () => {
      const other = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ loginId: 'no_pt', password: 'password1234', name: '무계약' })
        .expect(201);

      await remove(other.body.data.id).expect(204);
    });
  });
});
