import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<{ requestId?: string }>()
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const payload = exception instanceof HttpException ? exception.getResponse() : null
    const detailedMessage =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && 'message' in payload
          ? (payload as { message: string | string[] }).message
          : exception instanceof Error
            ? exception.message
            : '服务器内部错误'
    const message = status >= 500 ? '服务器内部错误' : detailedMessage
    if (status >= 500) {
      this.logger.error(`requestId=${request.requestId ?? 'unknown'} ${detailedMessage}`, exception instanceof Error ? exception.stack : undefined)
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
      requestId: request.requestId,
    })
  }
}
