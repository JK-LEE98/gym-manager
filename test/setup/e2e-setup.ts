import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

/**
 * E2E 테스트용 애플리케이션을 띄운다.
 *
 * `configureApp`을 그대로 사용하므로 전역 파이프·인터셉터·필터가
 * 운영과 동일하게 적용된다. 테스트가 실제와 다른 환경을 검증하는 일이 없다.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Rate Limit은 ThrottlerModule의 skipIf로 테스트 환경에서 비활성화된다.
  // overrideGuard로는 처리되지 않는다 — APP_GUARD를 useClass로 등록하면
  // ThrottlerGuard 토큰을 거치지 않고 별도 인스턴스가 생성되기 때문이다.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}

/**
 * 테이블을 비운다.
 *
 * 테스트 간 데이터가 남으면 실행 순서에 따라 결과가 달라진다.
 * TRUNCATE ... CASCADE로 FK 제약을 무시하고 한 번에 지운다.
 */
export async function clearDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas
    .map((entity) => `"${entity.tableName}"`)
    .join(', ');

  await dataSource.query(`TRUNCATE ${tables} CASCADE`);
}

/** 테스트에서 반복적으로 쓰는 고정 데이터 */
export const TEST_GYM = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '테스트 헬스장',
} as const;

export const OTHER_GYM = {
  id: '00000000-0000-4000-8000-000000000002',
  name: '다른 헬스장',
} as const;

export const TEST_MEMBER = {
  loginId: 'test_member',
  password: 'password1234',
  name: '테스트 회원',
} as const;

/** 헬스장을 직접 INSERT한다. 헬스장 생성 API는 SUPER_ADMIN 토큰이 필요해 순환이 생긴다 */
export async function createGym(
  app: INestApplication,
  gym: { id: string; name: string },
): Promise<void> {
  await app
    .get(DataSource)
    .query('INSERT INTO gyms (id, name) VALUES ($1, $2)', [gym.id, gym.name]);
}

/** 회원가입 후 로그인까지 수행하고 Access Token을 반환한다 */
export async function signupAndLogin(
  app: INestApplication,
  gymId: string,
  credentials: { loginId: string; password: string; name: string },
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ gymId, ...credentials })
    .expect(201);

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ loginId: credentials.loginId, password: credentials.password })
    .expect(200);

  return {
    accessToken: login.body.data.accessToken,
    refreshToken: login.body.data.refreshToken,
    userId: signup.body.data.id,
  };
}
