import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { MembershipType } from '../entities/membership-type.entity';

export class CreateMembershipTypeDto {
  /** 판매 명칭. 예: "헬스 3개월" */
  @IsString()
  @Length(1, 100)
  name: string;

  /**
   * 회원권 성격. 예: "헬스", "락커", "운동복", "PT"
   *
   * 같은 카테고리의 회원권을 추가로 부여하면 기존 종료일 다음날부터 이어진다.
   * 헬스장이 자유롭게 정한다.
   */
  @IsString()
  @Length(1, 50)
  category: string;

  /** 유효 기간(일) */
  @IsInt()
  @Min(1)
  durationDays: number;

  /** 판매 가격(원) */
  @IsInt()
  @Min(0)
  price: number;
}

export class UpdateMembershipTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;
}

export class MembershipTypeQueryDto {
  /**
   * 기본값은 판매 중인 것만. true를 주면 중지된 것도 포함.
   *
   * 쿼리스트링은 항상 문자열이라 `"true"`가 들어온다.
   * `@Type(() => Boolean)`으로는 해결되지 않는다 — `Boolean("false")`가 `true`이기 때문이다.
   * 빈 문자열이 아니면 전부 참이 되어 `false`를 보내도 참이 된다.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

export class MembershipTypeResponseDto {
  id: string;
  name: string;
  category: string;
  durationDays: number;
  price: number;
  isActive: boolean;

  static from(type: MembershipType): MembershipTypeResponseDto {
    const dto = new MembershipTypeResponseDto();
    dto.id = type.id;
    dto.name = type.name;
    dto.category = type.category;
    dto.durationDays = type.durationDays;
    dto.price = type.price;
    dto.isActive = type.isActive;
    return dto;
  }
}
