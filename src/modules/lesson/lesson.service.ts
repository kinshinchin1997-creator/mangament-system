import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { ContractService } from '../contract/contract.service';
import {
  CreateLessonDto,
  QueryLessonDto,
  RevokeLessonDto,
  BatchAttendanceDto,
  StudentAttendanceDto,
  LessonStatusEnum,
  LessonTypeEnum,
  AttendanceStatusEnum,
  LessonResultDto,
  BatchAttendanceResultDto,
} from './dto';

/**
 * ============================================
 * 消课服务 - Lesson Service
 * ============================================
 * 
 * 核心职责：
 * 1. 上课 → 签到 → 消课的完整流程
 * 2. 每次消课自动减少未消课金额（收入确认）
 * 3. 消课金额只能通过消课操作变化，不允许直接修改
 * 4. 支持消课撤销（回滚金额）
 * 
 * 业务规则：
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    消课 = 收入确认                           │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │  消课金额计算公式：                                          │
 * │  ┌────────────────────────────────────────────────┐        │
 * │  │ 消课金额 = 消耗课时数 × 课单价                    │        │
 * │  │ 新未消课金额 = 原未消课金额 - 消课金额             │        │
 * │  │ 新剩余课时 = 原剩余课时 - 消耗课时数               │        │
 * │  └────────────────────────────────────────────────┘        │
 * │                                                             │
 * │  【重要】不允许直接修改金额！                                 │
 * │  所有金额变化必须通过以下途径：                               │
 * │  1. 消课 → 减少未消课金额                                    │
 * │  2. 撤销消课 → 恢复未消课金额                                 │
 * │  3. 退费 → 清零未消课金额                                    │
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * 异常消课处理说明：
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    异常消课场景                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │  1. 请假（LEAVE）：                                         │
 * │     - 学员提前请假，不扣课时                                  │
 * │     - 记录请假信息，但不创建消课记录                          │
 * │     - 后续可安排补课                                         │
 * │                                                             │
 * │  2. 缺勤（ABSENT）：                                        │
 * │     - 无故缺勤，根据机构规则决定是否扣课时                     │
 * │     - 方案A：不扣课时（仁慈模式）                             │
 * │     - 方案B：扣除课时（严格模式）                             │
 * │     - 本系统默认：缺勤不自动扣课，需手动处理                   │
 * │                                                             │
 * │  3. 补课（MAKEUP）：                                        │
 * │     - 因请假/调课产生的补课                                   │
 * │     - 正常消耗课时，标记为补课类型                            │
 * │     - 可关联原请假记录（可选）                                │
 * │                                                             │
 * │  4. 试听课（TRIAL）：                                       │
 * │     - 新学员试听，可能不绑定合同                              │
 * │     - 如绑定合同，可配置是否扣课时                            │
 * │     - 本系统：试听课也正常消课（计入收入）                     │
 * │                                                             │
 * │  5. 撤销消课（REVOKE）：                                    │
 * │     - 错误消课的纠正机制                                      │
 * │     - 必须提供撤销原因                                       │
 * │     - 自动回滚：课时恢复 + 未消课金额恢复                      │
 * │     - 已结课合同撤销后状态恢复为正常                          │
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class LessonService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ContractService))
    private contractService: ContractService,
  ) {}

  // ============================================
  // 一、核心消课流程
  // ============================================

  /**
   * 创建消课记录（单个学员）
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION createLesson(dto, user):
   *   // ===== 1. 前置校验 =====
   *   合同 = 查询合同(dto.contractId)
   *   IF 合同不存在:
   *     抛出异常("合同不存在")
   *   IF 合同状态 != 正常:
   *     抛出异常("合同状态异常，无法消课")
   *   IF 合同.剩余课时 < dto.lessonCount:
   *     抛出异常("剩余课时不足")
   *   
   *   教师 = 查询教师(dto.teacherId)
   *   IF 教师不存在 OR 教师已离职:
   *     抛出异常("教师不可用")
   *   
   *   // ===== 2. 计算金额（核心！不允许直接修改金额）=====
   *   课单价 = 合同.unitPrice
   *   消课金额 = dto.lessonCount × 课单价
   *   新剩余课时 = 合同.剩余课时 - dto.lessonCount
   *   新未消课金额 = 新剩余课时 × 课单价
   *   
   *   // ===== 3. 事务操作（确保原子性）=====
   *   BEGIN TRANSACTION:
   *     // 3.1 创建消课记录（记录变化前后快照）
   *     消课记录 = INSERT Lesson {
   *       lessonNo: 生成消课单号(),
   *       contractId: dto.contractId,
   *       studentId: 合同.studentId,
   *       teacherId: dto.teacherId,
   *       lessonCount: dto.lessonCount,
   *       unitPrice: 课单价,
   *       lessonAmount: 消课金额,       // 本次确认收入
   *       beforeRemain: 合同.剩余课时,   // 消课前剩余
   *       afterRemain: 新剩余课时,       // 消课后剩余
   *       beforeUnearned: 合同.unearned, // 消课前未消课金额
   *       afterUnearned: 新未消课金额,   // 消课后未消课金额
   *       status: 正常
   *     }
   *     
   *     // 3.2 更新合同（减少课时和未消课金额）
   *     UPDATE Contract SET
   *       usedLessons = usedLessons + dto.lessonCount,
   *       remainLessons = 新剩余课时,
   *       unearned = 新未消课金额,
   *       status = IF 新剩余课时 == 0 THEN 已完结 ELSE 保持不变
   *   COMMIT
   *   
   *   RETURN 消课记录
   * ```
   */
  async create(createDto: CreateLessonDto, currentUser: any): Promise<LessonResultDto> {
    // ===== 1. 前置校验 =====
    
    // 1.1 校验合同
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { 
        student: true, 
        package: true, 
        campus: true 
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }
    if (contract.status !== 1) {
      throw new BadRequestException('该合同不是正常状态，无法消课');
    }
    if (contract.remainLessons < createDto.lessonCount) {
      throw new BadRequestException(
        `剩余课时不足，当前剩余 ${contract.remainLessons} 课时，请求消耗 ${createDto.lessonCount} 课时`
      );
    }

    // 1.2 校验教师
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: createDto.teacherId },
    });
    if (!teacher) {
      throw new NotFoundException('教师不存在');
    }
    if (teacher.status !== 1) {
      throw new BadRequestException('该教师已离职，无法授课');
    }

    // ===== 2. 计算金额（核心逻辑！）=====
    // 【重要】金额只能通过这里计算得出，不接受外部传入
    const unitPrice = Number(contract.unitPrice);
    const lessonAmount = DecimalUtil.toNumber(
      DecimalUtil.multiply(unitPrice.toString(), createDto.lessonCount.toString())
    );

    // 计算消课后的新状态
    const newRemainLessons = contract.remainLessons - createDto.lessonCount;
    const newUsedLessons = contract.usedLessons + createDto.lessonCount;
    const newUnearned = DecimalUtil.toNumber(
      DecimalUtil.multiply(unitPrice.toString(), newRemainLessons.toString())
    );

    // 生成消课单号
    const lessonNo = NumberGenerator.generateLessonRecordNo();

    // ===== 3. 事务操作 =====
    const lesson = await this.prisma.$transaction(async (tx) => {
      // 3.1 创建消课记录
      const record = await tx.lesson.create({
        data: {
          lessonNo,
          contractId: createDto.contractId,
          studentId: contract.studentId,
          campusId: contract.campusId,
          teacherId: createDto.teacherId,
          lessonDate: new Date(createDto.lessonDate),
          lessonTime: createDto.lessonTime,
          duration: createDto.duration,
          lessonCount: createDto.lessonCount,
          unitPrice,
          lessonAmount,
          // 消课前后快照（用于审计和撤销恢复）
          beforeRemain: contract.remainLessons,
          afterRemain: newRemainLessons,
          beforeUnearned: Number(contract.unearned),
          afterUnearned: newUnearned,
          status: LessonStatusEnum.NORMAL,
          createdById: currentUser.userId,
          remark: createDto.remark,
          // 快照数据（防止关联数据变更后丢失历史）
          snapshotData: {
            contract: {
              id: contract.id,
              contractNo: contract.contractNo,
            },
            student: {
              id: contract.student.id,
              name: contract.student.name,
              code: contract.student.code,
            },
            teacher: {
              id: teacher.id,
              name: teacher.name,
            },
            package: {
              id: contract.package.id,
              name: contract.package.name,
            },
          },
        },
      });

      // 3.2 更新合同（核心：减少课时和未消课金额）
      await tx.contract.update({
        where: { id: createDto.contractId },
        data: {
          usedLessons: newUsedLessons,
          remainLessons: newRemainLessons,
          unearned: newUnearned,
          // 如果课时消耗完毕，更新合同状态为"已完结"
          status: newRemainLessons === 0 ? 2 : contract.status,
        },
      });

      return record;
    });

    // ===== 4. 返回结果 =====
    return {
      lessonNo: lesson.lessonNo,
      studentName: contract.student.name,
      lessonCount: lesson.lessonCount,
      lessonAmount: lesson.lessonAmount.toNumber(),
      beforeRemain: lesson.beforeRemain,
      afterRemain: lesson.afterRemain,
      beforeUnearned: lesson.beforeUnearned.toNumber(),
      afterUnearned: lesson.afterUnearned.toNumber(),
    };
  }

  // ============================================
  // 二、批量签到消课（上课→签到→消课流程）
  // ============================================

  /**
   * 批量签到消课
   * 
   * 业务场景：
   * 教师上完一节课后，批量为所有学员签到
   * 根据签到状态决定是否消课
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION batchAttendance(dto, user):
   *   结果 = { 成功数: 0, 请假数: 0, 缺勤数: 0, 详情: [], 失败: [] }
   *   
   *   FOR EACH 签到信息 IN dto.attendances:
   *     SWITCH 签到信息.status:
   *       CASE 已签到(ATTENDED):
   *         // 正常消课
   *         TRY:
   *           消课结果 = 创建消课(签到信息)
   *           结果.成功数++
   *           结果.详情.push(消课结果)
   *         CATCH 错误:
   *           结果.失败.push({ contractId, reason: 错误信息 })
   *       
   *       CASE 请假(LEAVE):
   *         // 不消课，仅记录请假
   *         记录请假日志(签到信息)
   *         结果.请假数++
   *       
   *       CASE 缺勤(ABSENT):
   *         // 根据配置决定是否扣课
   *         IF 缺勤扣课策略 == 扣课:
   *           创建消课(签到信息, 类型=缺勤扣课)
   *         ELSE:
   *           仅记录缺勤日志
   *         结果.缺勤数++
   *       
   *       CASE 补课(MAKEUP):
   *         // 补课正常消课，标记类型
   *         创建消课(签到信息, 类型=补课)
   *         结果.成功数++
   *   
   *   RETURN 结果
   * ```
   */
  async batchAttendance(
    dto: BatchAttendanceDto,
    currentUser: any
  ): Promise<BatchAttendanceResultDto> {
    const result: BatchAttendanceResultDto = {
      successCount: 0,
      leaveCount: 0,
      absentCount: 0,
      results: [],
      failures: [],
    };

    // 校验教师
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: dto.teacherId },
    });
    if (!teacher || teacher.status !== 1) {
      throw new BadRequestException('教师不存在或已离职');
    }

    // 逐个处理签到
    for (const attendance of dto.attendances) {
      try {
        switch (attendance.status) {
          // ===== 正常签到 → 消课 =====
          case AttendanceStatusEnum.ATTENDED:
            const lessonResult = await this.create(
              {
                contractId: attendance.contractId,
                teacherId: dto.teacherId,
                lessonDate: dto.lessonDate,
                lessonTime: dto.lessonTime,
                duration: dto.duration,
                lessonCount: attendance.lessonCount || 1,
                lessonType: LessonTypeEnum.NORMAL,
                remark: attendance.remark,
              },
              currentUser
            );
            result.results.push(lessonResult);
            result.successCount++;
            break;

          // ===== 请假 → 不消课 =====
          case AttendanceStatusEnum.LEAVE:
            /*
             * 【请假处理说明】
             * 
             * 请假不扣课时，但需要记录：
             * 1. 可以创建一个"请假记录"表（本示例简化，仅记录日志）
             * 2. 请假后可安排补课
             * 3. 补课时使用 MAKEUP 类型消课
             * 
             * 实际项目中可扩展：
             * - LeaveRecord 表：记录请假详情
             * - 请假审批流程
             * - 请假与补课关联
             */
            // TODO: 记录请假日志（可扩展为请假记录表）
            result.leaveCount++;
            break;

          // ===== 缺勤 → 根据策略处理 =====
          case AttendanceStatusEnum.ABSENT:
            /*
             * 【缺勤处理说明】
             * 
             * 缺勤处理有两种策略：
             * 
             * 策略A - 仁慈模式（本系统默认）：
             * - 缺勤不自动扣课时
             * - 管理员可手动决定是否扣课
             * - 适用于：小型机构、注重口碑
             * 
             * 策略B - 严格模式：
             * - 无故缺勤自动扣课时
             * - 相当于放弃本次课程
             * - 适用于：大型机构、课程资源紧张
             * 
             * 可通过系统配置切换策略
             */
            // 当前采用仁慈模式：缺勤仅记录，不扣课
            // TODO: 从系统配置读取缺勤策略
            // if (absencePolicy === 'STRICT') {
            //   await this.create({ ...dto, lessonType: LessonTypeEnum.ABSENCE_DEDUCT }, user);
            // }
            result.absentCount++;
            break;

          // ===== 补课 → 正常消课，标记类型 =====
          case AttendanceStatusEnum.MAKEUP:
            /*
             * 【补课处理说明】
             * 
             * 补课场景：
             * 1. 学员之前请假，现在补上
             * 2. 调课后的补课
             * 3. 特殊安排的加课
             * 
             * 补课正常消耗课时，但标记为补课类型
             * 便于统计和区分正常消课
             */
            const makeupResult = await this.create(
              {
                contractId: attendance.contractId,
                teacherId: dto.teacherId,
                lessonDate: dto.lessonDate,
                lessonTime: dto.lessonTime,
                duration: dto.duration,
                lessonCount: attendance.lessonCount || 1,
                lessonType: LessonTypeEnum.MAKEUP,
                remark: `补课${attendance.remark ? ': ' + attendance.remark : ''}`,
              },
              currentUser
            );
            result.results.push(makeupResult);
            result.successCount++;
            break;

          default:
            result.failures.push({
              contractId: attendance.contractId,
              reason: `未知的签到状态: ${attendance.status}`,
            });
        }
      } catch (error: any) {
        // 记录失败
        result.failures.push({
          contractId: attendance.contractId,
          reason: error.message || '消课失败',
        });
      }
    }

    return result;
  }

  // ============================================
  // 三、撤销消课（回滚金额）
  // ============================================

  /**
   * 撤销消课
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION revoke(id, reason, user):
   *   消课记录 = 查询消课记录(id)
   *   IF 消课记录不存在:
   *     抛出异常("消课记录不存在")
   *   IF 消课记录.status != 正常:
   *     抛出异常("该记录已被撤销")
   *   
   *   合同 = 查询合同(消课记录.contractId)
   *   
   *   // 计算恢复后的状态
   *   恢复后剩余课时 = 合同.剩余课时 + 消课记录.lessonCount
   *   恢复后未消课金额 = 恢复后剩余课时 × 合同.课单价
   *   
   *   BEGIN TRANSACTION:
   *     // 1. 标记消课记录为已撤销
   *     UPDATE Lesson SET
   *       status = 已撤销,
   *       revokeReason = reason,
   *       revokedAt = NOW(),
   *       revokedById = user.id
   *     
   *     // 2. 恢复合同课时和金额
   *     UPDATE Contract SET
   *       usedLessons = usedLessons - 消课记录.lessonCount,
   *       remainLessons = 恢复后剩余课时,
   *       unearned = 恢复后未消课金额,
   *       status = IF 原状态 == 已完结 THEN 正常 ELSE 保持不变
   *   COMMIT
   *   
   *   RETURN 更新后的消课记录
   * ```
   */
  async revoke(id: string, dto: RevokeLessonDto, currentUser: any) {
    // 1. 校验消课记录
    const record = await this.prisma.lesson.findUnique({
      where: { id },
      include: { contract: true },
    });

    if (!record) {
      throw new NotFoundException('消课记录不存在');
    }
    if (record.status !== LessonStatusEnum.NORMAL) {
      throw new BadRequestException('该消课记录已被撤销，无法重复操作');
    }

    // 2. 计算恢复后的状态
    const contract = record.contract;
    const unitPrice = Number(contract.unitPrice);
    const newRemainLessons = contract.remainLessons + record.lessonCount;
    const newUsedLessons = contract.usedLessons - record.lessonCount;
    const newUnearned = DecimalUtil.toNumber(
      DecimalUtil.multiply(unitPrice.toString(), newRemainLessons.toString())
    );

    // 3. 事务操作
    await this.prisma.$transaction(async (tx) => {
      // 3.1 标记消课记录为已撤销
      await tx.lesson.update({
        where: { id },
        data: {
          status: LessonStatusEnum.REVOKED,
          revokeReason: dto.reason,
          revokedAt: new Date(),
          revokedById: currentUser.userId,
        },
      });

      // 3.2 恢复合同课时和金额
      await tx.contract.update({
        where: { id: record.contractId },
        data: {
          usedLessons: newUsedLessons,
          remainLessons: newRemainLessons,
          unearned: newUnearned,
          // 如果合同原来是"已完结"，恢复为"正常"
          status: contract.status === 2 ? 1 : contract.status,
        },
      });
    });

    // 4. 返回更新后的记录
    return this.findOne(id);
  }

  // ============================================
  // 四、查询方法
  // ============================================

  /**
   * 查询消课记录列表
   */
  async findAll(query: QueryLessonDto) {
    const {
      page = 1,
      pageSize = 20,
      contractId,
      studentId,
      teacherId,
      campusId,
      status,
      lessonType,
      startDate,
      endDate,
    } = query;

    const where: any = {};

    if (contractId) where.contractId = contractId;
    if (studentId) where.studentId = studentId;
    if (teacherId) where.teacherId = teacherId;
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;
    // lessonType 需要从 remark 或扩展字段判断（当前 schema 未包含此字段）

    if (startDate && endDate) {
      where.lessonDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.lesson.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          student: { select: { id: true, name: true, code: true } },
          teacher: { select: { id: true, name: true } },
          contract: {
            select: {
              id: true,
              contractNo: true,
              remainLessons: true,
              unearned: true,
            },
          },
          campus: { select: { id: true, name: true } },
          createdBy: { select: { id: true, realName: true } },
          revokedBy: { select: { id: true, realName: true } },
        },
        orderBy: { lessonDate: 'desc' },
      }),
      this.prisma.lesson.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取消课详情
   */
  async findOne(id: string) {
    const record = await this.prisma.lesson.findUnique({
      where: { id },
      include: {
        student: true,
        teacher: true,
        campus: true,
        contract: {
          include: {
            package: true,
          },
        },
        createdBy: { select: { id: true, realName: true } },
        revokedBy: { select: { id: true, realName: true } },
      },
    });

    if (!record) {
      throw new NotFoundException('消课记录不存在');
    }

    return record;
  }

  // ============================================
  // 五、统计方法
  // ============================================

  /**
   * 消课统计
   */
  async getStatistics(query: {
    campusId?: string;
    teacherId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { campusId, teacherId, startDate, endDate } = query;
    const where: any = { status: LessonStatusEnum.NORMAL };

    if (campusId) where.campusId = campusId;
    if (teacherId) where.teacherId = teacherId;
    if (startDate && endDate) {
      where.lessonDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // 汇总统计
    const summary = await this.prisma.lesson.aggregate({
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
    });

    // 按教师分组
    const byTeacher = await this.prisma.lesson.groupBy({
      by: ['teacherId'],
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
    });

    // 获取教师名称
    const teacherIds = byTeacher.map((t) => t.teacherId);
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t.name]));

    return {
      summary: {
        totalRecords: summary._count,
        totalLessons: summary._sum.lessonCount || 0,
        totalAmount: Number(summary._sum.lessonAmount || 0),
      },
      byTeacher: byTeacher.map((t) => ({
        teacherId: t.teacherId,
        teacherName: teacherMap.get(t.teacherId) || '未知',
        recordCount: t._count,
        lessonCount: t._sum.lessonCount || 0,
        amount: Number(t._sum.lessonAmount || 0),
      })),
    };
  }

  /**
   * 获取今日消课汇总
   */
  async getTodayStatistics(campusId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = {
      status: LessonStatusEnum.NORMAL,
      lessonDate: { gte: today, lt: tomorrow },
    };
    if (campusId) where.campusId = campusId;

    const stats = await this.prisma.lesson.aggregate({
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
    });

    return {
      date: today.toISOString().slice(0, 10),
      recordCount: stats._count,
      lessonCount: stats._sum.lessonCount || 0,
      amount: Number(stats._sum.lessonAmount || 0),
    };
  }

  /**
   * 获取合同的消课历史
   */
  async getContractLessons(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractNo: true,
        totalLessons: true,
        usedLessons: true,
        remainLessons: true,
        unitPrice: true,
        unearned: true,
        paidAmount: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    const lessons = await this.prisma.lesson.findMany({
      where: { contractId },
      include: {
        teacher: { select: { id: true, name: true } },
        createdBy: { select: { id: true, realName: true } },
      },
      orderBy: { lessonDate: 'desc' },
    });

    // 计算已确认收入
    const earnedAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(
        contract.paidAmount.toString(),
        contract.unearned.toString()
      )
    );

    return {
      contract: {
        ...contract,
        earnedAmount,
      },
      lessons,
      summary: {
        totalRecords: lessons.filter((l) => l.status === 1).length,
        revokedRecords: lessons.filter((l) => l.status === 2).length,
      },
    };
  }
}
