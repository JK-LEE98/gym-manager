import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import {
  envValidationOptions,
  envValidationSchema,
} from '../config/env.validation';

/**
 * **TypeORM CLI 전용 DataSource.**
 *
 * `migration:generate`·`run`·`revert`는 NestJS 밖에서 실행되므로
 * `ConfigModule`도 DI 컨테이너도 없다. `.env`를 직접 읽어야 한다.
 *
 * ---
 *
 * **앱과 설정이 갈라지면 안 된다.**
 * 여기서 만든 마이그레이션이 앱이 보는 스키마와 달라지면
 * 마이그레이션을 도입한 의미가 없어진다.
 * 그래서 `AppModule`과 **같은 검증 스키마**를 통과시킨다.
 *
 * ---
 *
 * `synchronize`는 여기서 절대 켜지 않는다. CLI가 스키마를 건드릴 이유가 없고,
 * 켜면 `migration:generate`가 "차이 없음"을 보게 되어 빈 파일이 나온다.
 */
loadEnv({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  // 이미 셸에 있는 값을 덮어쓰지 않는다. CI가 환경변수로 주입할 여지를 남긴다
  override: false,
});

/**
 * CLI가 쓰는 값만. 검증을 통과한 뒤에만 이 타입으로 다룬다.
 *
 * Joi의 `validate()`는 `any`를 돌려주므로 여기서 한 번만 좁힌다.
 * 필드마다 단언하면 "검증했다"는 사실이 코드에 드러나지 않는다.
 */
interface DatabaseEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
}

const result = envValidationSchema.validate(process.env, envValidationOptions);

if (result.error) {
  const details = result.error.details
    .map((d) => `  - ${d.message}`)
    .join('\n');
  throw new Error(`환경변수 검증 실패\n${details}`);
}

const env = result.value as DatabaseEnv;

export const dataSourceOptions = {
  type: 'postgres' as const,
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,

  // ts-node로 실행할 때는 .ts, 빌드 후에는 .js가 잡힌다
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],

  synchronize: false,
};

/** CLI가 `-d` 옵션으로 찾는 기본 내보내기 */
export default new DataSource(dataSourceOptions);
