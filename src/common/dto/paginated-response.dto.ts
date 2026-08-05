import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * 목록 조회 공통 쿼리.
 *
 * `@Type(() => Number)`가 필요한 이유: 쿼리스트링은 항상 문자열이다.
 * ValidationPipe의 transform 옵션과 함께 동작해 `"1"`을 `1`로 변환한다.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** 한 번에 가져올 최대 개수. 상한을 두어 과도한 조회를 막는다 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PaginatedResponseDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;

  static of<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
  ): PaginatedResponseDto<T> {
    const dto = new PaginatedResponseDto<T>();
    dto.items = items;
    dto.total = total;
    dto.page = page;
    dto.limit = limit;
    dto.totalPages = Math.ceil(total / limit);
    return dto;
  }
}
