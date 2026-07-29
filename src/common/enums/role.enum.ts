/**
 * 사용자 역할
 *
 * SUPER_ADMIN : 서비스 운영자. gymId가 null인 유일한 역할
 * OWNER       : 헬스장 공용 운영 계정 (개인 계정 아님, 프론트 데스크 공유)
 * TRAINER     : 개인 계정. PT 계약/일정이 귀속됨
 * MEMBER      : 일반 회원
 *
 * @see ADR-005 OWNER 계정 분리 근거
 */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
  TRAINER = 'TRAINER',
  MEMBER = 'MEMBER',
}
