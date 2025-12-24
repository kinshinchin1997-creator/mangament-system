import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * HTTP异常过滤器
 * 统一异常响应格式
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as any;
        message = res.message || message;
        errors = res.errors || null;

        // 处理 class-validator 的验证错误
        if (Array.isArray(res.message)) {
          message = res.message[0];
          errors = res.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // 开发环境打印错误堆栈
    if (process.env.NODE_ENV === 'development') {
      console.error('Exception:', exception);
    }

    response.status(status).json({
      code: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

