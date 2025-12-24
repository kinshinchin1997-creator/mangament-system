import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 操作日志拦截器
 * 记录关键业务操作
 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // 只记录写操作
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (response) => {
        try {
          await this.prisma.operationLog.create({
            data: {
              userId: user?.userId || 'anonymous',
              userName: user?.realName || 'anonymous',
              module: this.extractModule(url),
              action: this.mapMethodToAction(method),
              beforeData: body,
              afterData: response,
              ip: request.ip || request.connection?.remoteAddress,
              userAgent: request.headers['user-agent'],
            },
          });
        } catch (error) {
          // 日志记录失败不影响主流程
          console.error('Failed to log operation:', error);
        }
      }),
    );
  }

  private extractModule(url: string): string {
    // /api/v1/module/... -> module
    const parts = url.split('/').filter(Boolean);
    return parts[2] || 'unknown';
  }

  private mapMethodToAction(method: string): string {
    const actionMap: Record<string, string> = {
      POST: 'CREATE',
      PUT: 'UPDATE',
      PATCH: 'UPDATE',
      DELETE: 'DELETE',
    };
    return actionMap[method] || 'UNKNOWN';
  }
}

