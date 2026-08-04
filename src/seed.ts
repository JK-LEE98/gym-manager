import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from './app.module';
import { User } from './users/entities/user.entity';
import { Gym } from './gyms/entities/gym.entity';
import { Role } from './common/enums/role.enum';

/**
 * 초기 데이터 시드. Spring의 CommandLineRunner에 해당한다.
 *
 * SUPER_ADMIN은 API로 만들 수 없다. 헬스장 등록 권한을 가진 최고 권한 계정을
 * 누구나 호출 가능한 엔드포인트로 노출할 수는 없기 때문이다.
 * 그래서 애플리케이션 밖에서 최초 1명만 심는다.
 *
 * 실행: npm run seed
 * 여러 번 실행해도 안전하다(멱등).
 */

const BCRYPT_ROUNDS = 10;

/**
 * 개발 환경에서 회원가입을 테스트하려면 gymId가 필요하다. Gym API(#4) 완성 전까지의 발판.
 *
 * id를 고정한 이유
 * - 이름으로 판단하면 헬스장명을 바꿨을 때 중복 생성된다. PK 기준이 안전하다
 * - 테스트 스크립트에 gymId를 하드코딩할 수 있어 매번 조회할 필요가 없다
 */
const DEV_GYM = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '테스트 헬스장',
  address: '서울시 강남구 테헤란로 123',
  phone: '02-0000-0000',
} as const;

async function seed(): Promise<void> {
  // HTTP 서버 없이 DI 컨테이너만 띄운다
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const config = app.get(ConfigService);
    const dataSource = app.get(DataSource);
    const userRepo = dataSource.getRepository(User);
    const gymRepo = dataSource.getRepository(Gym);

    // --- SUPER_ADMIN ---
    const existingAdmin = await userRepo.findOne({
      where: { role: Role.SUPER_ADMIN },
    });

    if (existingAdmin) {
      console.log(`⏭  SUPER_ADMIN 이미 존재 (${existingAdmin.loginId})`);
    } else {
      const loginId = config.getOrThrow<string>('SEED_ADMIN_LOGIN_ID');
      const password = config.getOrThrow<string>('SEED_ADMIN_PASSWORD');

      await userRepo.save(
        userRepo.create({
          loginId,
          password: await bcrypt.hash(password, BCRYPT_ROUNDS),
          name: config.getOrThrow<string>('SEED_ADMIN_NAME'),
          role: Role.SUPER_ADMIN,
          // SUPER_ADMIN은 특정 헬스장에 속하지 않는 유일한 역할이다
          gymId: null,
        }),
      );
      console.log(`✅ SUPER_ADMIN 생성 (${loginId})`);
    }

    // --- 개발용 헬스장 ---
    if (config.get('NODE_ENV') === 'development') {
      const existingGym = await gymRepo.findOne({ where: { id: DEV_GYM.id } });

      if (existingGym) {
        console.log(`⏭  개발용 헬스장 이미 존재 (${existingGym.id})`);
      } else {
        const gym = await gymRepo.save(gymRepo.create(DEV_GYM));
        console.log(`✅ 개발용 헬스장 생성 (${gym.id})`);
      }
    }
  } finally {
    await app.close();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ 시드 실패:', error);
    process.exit(1);
  });
