import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * DataSource를 만들기 전에 필요한 PostgreSQL 확장을 설치한다.
 *
 * **순서가 중요하다.**
 * ```
 * ① btree_gist 설치
 * ② synchronize가 EXCLUDE 제약 생성
 * ```
 *
 * `PTSchedule`의 시간 겹침 제약은 `trainer_id`(UUID 등호)와
 * 시간 범위(`&&`)를 **한 GiST 인덱스에 섞는다.**
 * GiST는 원래 범위·기하 타입용이라 UUID 등호를 모르는데, `btree_gist`가 그것을 가르쳐준다.
 *
 * 확장 없이 `synchronize`가 돌면 이렇게 실패한다.
 * ```
 * data type uuid has no default operator class for access method "gist"
 * ```
 *
 * `synchronize`는 커넥션을 여는 시점에 바로 실행되므로 그 전에 끼어들 자리가 없다.
 * 그래서 **엔티티 없이 임시로 붙어 확장만 깔고 끊은 뒤** 실제 DataSource를 초기화한다.
 *
 * `docker-entrypoint-initdb.d`에 넣는 방법도 있으나
 * **컨테이너를 처음 만들 때만 실행되어** 기존 DB나 CI 서비스 컨테이너에는 적용되지 않는다.
 * 환경마다 다르게 동작하는 설정은 두지 않는다. @see ADR-014
 */
export async function createDataSource(
  options: DataSourceOptions,
): Promise<DataSource> {
  await installExtensions(options);
  return new DataSource(options).initialize();
}

async function installExtensions(options: DataSourceOptions): Promise<void> {
  // 엔티티를 비우고 synchronize를 꺼서 스키마에 손대지 않게 한다.
  // 이 커넥션의 목적은 확장 설치 하나뿐이다.
  const bootstrap = new DataSource({
    ...options,
    entities: [],
    synchronize: false,
    logging: false,
  });

  await bootstrap.initialize();
  try {
    await bootstrap.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
  } finally {
    // 실패하더라도 커넥션은 반드시 닫는다.
    // 남겨두면 개발 중 재시작을 반복할 때 커넥션이 누적된다.
    await bootstrap.destroy();
  }
}
