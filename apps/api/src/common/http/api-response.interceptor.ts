import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ requestId?: string }>()
    return next.handle().pipe(
      map((data) => ({ code: 0, message: 'ok', data, requestId: request.requestId })),
    )
  }
}
