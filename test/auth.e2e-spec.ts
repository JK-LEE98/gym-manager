import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  RefreshToken,
  RevokeReason,
} from '../src/auth/entities/refresh-token.entity';
import {
  TEST_GYM,
  TEST_MEMBER,
  clearDatabase,
  createGym,
  createTestApp,
  signupAndLogin,
} from './setup/e2e-setup';

/**
 * 지금까지 curl로 손으로 돌리던 검증을 자동화한 것이다.
 * 시나리오와 기대값이 그대로 대응된다.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(app);
    await createGym(app, TEST_GYM);
  });

  describe('회원가입', () => {
    it('가입에 성공하면 MEMBER 역할로 생성된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ gymId: TEST_GYM.id, ...TEST_MEMBER })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.loginId).toBe(TEST_MEMBER.loginId);
      expect(res.body.data.role).toBe('MEMBER');
      expect(res.body.data.gymId).toBe(TEST_GYM.id);
    });

    it('role을 함께 보내면 400으로 거부된다', async () => {
      // whitelist + forbidNonWhitelisted가 권한 상승 시도를 차단하는지 확인한다
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ gymId: TEST_GYM.id, ...TEST_MEMBER, role: 'OWNER' })
        .expect(400);

      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('중복 아이디는 409를 반환한다', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ gymId: TEST_GYM.id, ...TEST_MEMBER })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ gymId: TEST_GYM.id, ...TEST_MEMBER })
        .expect(409);

      expect(res.body.errorCode).toBe('DUPLICATE_LOGIN_ID');
    });

    it('존재하지 않는 헬스장이면 404를 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          gymId: '00000000-0000-4000-8000-000000009999',
          ...TEST_MEMBER,
        })
        .expect(404);

      expect(res.body.errorCode).toBe('GYM_NOT_FOUND');
    });
  });

  describe('로그인', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ gymId: TEST_GYM.id, ...TEST_MEMBER })
        .expect(201);
    });

    it('성공 시 토큰 쌍과 사용자 정보를 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ loginId: TEST_MEMBER.loginId, password: TEST_MEMBER.password })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.user.loginId).toBe(TEST_MEMBER.loginId);
    });

    it('비밀번호가 틀린 경우와 아이디가 없는 경우의 응답이 동일하다', async () => {
      // 사용자 열거 방지. 두 응답이 구분되면 계정 존재 여부가 드러난다 → ADR-008
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ loginId: TEST_MEMBER.loginId, password: 'wrong-password' })
        .expect(401);

      const noSuchUser = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ loginId: 'nobody_here', password: 'wrong-password' })
        .expect(401);

      expect(wrongPassword.body).toEqual(noSuchUser.body);
      expect(wrongPassword.body.errorCode).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('내 정보 조회', () => {
    it('토큰 없이 호출하면 401이다', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect(res.body.errorCode).toBe('UNAUTHORIZED');
    });

    it('토큰이 있으면 DB에서 조회한 실제 정보를 반환한다', async () => {
      const { accessToken } = await signupAndLogin(
        app,
        TEST_GYM.id,
        TEST_MEMBER,
      );

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // 토큰 payload에는 없는 필드가 채워져 있어야 한다
      expect(res.body.data.name).toBe(TEST_MEMBER.name);
      expect(res.body.data.loginId).toBe(TEST_MEMBER.loginId);
    });
  });

  describe('Refresh Token Rotation', () => {
    it('갱신하면 새 토큰 쌍이 발급된다', async () => {
      const { refreshToken } = await signupAndLogin(
        app,
        TEST_GYM.id,
        TEST_MEMBER,
      );

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('회전된 토큰을 재제출하면 탈취로 판단해 전체 세션을 종료한다', async () => {
      const { refreshToken: r1, userId } = await signupAndLogin(
        app,
        TEST_GYM.id,
        TEST_MEMBER,
      );

      // R1 → R2 정상 회전
      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(200);
      const r2 = refreshed.body.data.refreshToken;

      // 이미 폐기된 R1 재제출 → 재사용 감지
      const reuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(401);
      expect(reuse.body.errorCode).toBe('TOKEN_REUSE_DETECTED');

      // 공격자가 가진 R2도 함께 무효화되어야 한다
      const afterDetection = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r2 })
        .expect(401);
      expect(afterDetection.body.errorCode).toBe('INVALID_REFRESH_TOKEN');

      // DB에 폐기 사유가 구분되어 남는지 확인한다.
      // 사유가 없으면 로그아웃 토큰의 재제출까지 탈취로 오판한다
      const tokens = await app
        .get(DataSource)
        .getRepository(RefreshToken)
        .find({ where: { userId }, order: { createdAt: 'ASC' } });

      expect(tokens).toHaveLength(2);
      expect(tokens[0].revokedReason).toBe(RevokeReason.ROTATED);
      expect(tokens[1].revokedReason).toBe(RevokeReason.REUSE_DETECTED);
    });

    it('위조된 토큰은 401이다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not.a.valid.token' })
        .expect(401);

      expect(res.body.errorCode).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('로그아웃', () => {
    it('allDevices=true면 모든 세션이 종료된다', async () => {
      const { accessToken, refreshToken, userId } = await signupAndLogin(
        app,
        TEST_GYM.id,
        TEST_MEMBER,
      );

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ allDevices: true })
        .expect(204);

      // 로그아웃된 토큰의 재제출은 탈취가 아니라 단순 무효 처리여야 한다
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      expect(res.body.errorCode).toBe('INVALID_REFRESH_TOKEN');

      const tokens = await app
        .get(DataSource)
        .getRepository(RefreshToken)
        .find({ where: { userId } });
      expect(tokens[0].revokedReason).toBe(RevokeReason.LOGOUT);
    });
  });
});
