import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import {
  CreateRefundDto,
  ApproveRefundDto,
  CompleteRefundDto,
  QueryRefundDto,
  RefundPreviewDto,
  RefundStatus,
  RefundType,
  RiskCheckResult,
} from './dto';

/**
 * ============================================
 * 退费服务
 * ============================================
 * 
 * 核心职责：
 * 1. 退费预览（计算可退金额）
 * 2. 退费申请（含风控校验）
 * 3. 退费审批（审批流）
 * 4. 退费打款确认
 * 5. 退费风控分析
 * 
 * 审批流状态：
 * ┌──────────┐    ┌──────────┐    ┌──────────┐
 * │ PENDING  │───▶│ APPROVED │───▶│ COMPLETED│
 * │ 待审批   │    │ 已通过   │    │ 已完成   │
 * └──────────┘    └──────────┘    └──────────┘
 *       │
 *       ▼
 * ┌──────────┐
 * │ REJECTED │
 * │ 已驳回   │
 * └──────────┘
 * 
 * 可退金额计算公式：
 * 可退金额 = 未消课金额 = 剩余课时 × 课时单价
 * 实退金额 = 可退金额 - 扣除金额（违约金等）
 */
@Injectable()
export class RefundService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // 风控配置（可从数据库或配置中心读取）
  // ============================================
  
  /**
   * 【风控规则配置点 1】
   * 可以将这些阈值配置到数据库 SystemConfig 表中
   * 实现动态调整风控参数
   */
  private readonly RISK_CONFIG = {
    // 单人退费率阈值
    STUDENT_REFUND_RATE_WARNING: 0.3,  // 30% 触发警告
    STUDENT_REFUND_RATE_BLOCK: 0.5,    // 50% 阻断退费
    
    // 校区退费率阈值（月度）
    CAMPUS_REFUND_RATE_WARNING: 0.1,   // 10% 触发警告
    CAMPUS_REFUND_RATE_BLOCK: 0.2,     // 20% 需要更高级别审批
    
    // 金额阈值
    HIGH_AMOUNT_THRESHOLD: 10000,      // 高额退费阈值
    
    // 统计周期（天）
    STATISTICS_PERIOD_DAYS: 30,
  };

  // ============================================
  // 一、退费预览
  // ============================================

  /**
   * 退费预览 - 计算可退金额
   * 
   * 业务逻辑：
   * 1. 查询合同信息
   * 2. 校验合同状态是否可退费
   * 3. 计算可退金额（基于未消课金额）
   * 4. 执行风控检查
   * 5. 返回预览信息
   * 
   * @param previewDto 预览请求
   * @returns 退费预览信息
   */
  async preview(previewDto: RefundPreviewDto) {
    const { contractId, deductAmount = 0 } = previewDto;

    // 1. 查询合同信息
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        student: true,
        package: true,
        campus: true,
      },
    });
    if (!contract) throw new NotFoundException('合同不存在');

    // 2. 校验合同状态
    if (contract.status !== 1) {
      throw new BadRequestException('该合同不是正常状态，无法退费');
    }

    // 3. 计算可退金额
    // 可退金额 = 未消课金额 = 剩余课时 × 课时单价
    const refundableAmount = DecimalUtil.toNumber(contract.unearned.toString());
    const actualAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(refundableAmount.toString(), deductAmount.toString())
    );

    if (actualAmount < 0) {
      throw new BadRequestException('扣除金额不能大于可退金额');
    }

    // 4. 执行风控检查
    const riskCheck = await this.checkRefundRisk(contract.studentId, contract.campusId, refundableAmount);

    // 5. 返回预览信息
    return {
      contract: {
        id: contract.id,
        contractNo: contract.contractNo,
        studentId: contract.studentId,
        studentName: contract.student.name,
        studentCode: contract.student.code,
        packageName: contract.package.name,
        campusId: contract.campusId,
        campusName: contract.campus.name,
      },
      calculation: {
        // 金额计算
        paidAmount: Number(contract.paidAmount),           // 已付金额
        contractAmount: Number(contract.contractAmount),    // 合同金额
        
        // 课时信息
        totalLessons: contract.totalLessons,               // 总课时
        usedLessons: contract.usedLessons,                 // 已用课时
        remainLessons: contract.remainLessons,             // 剩余课时
        
        // 单价
        unitPrice: Number(contract.unitPrice),             // 课时单价
        
        // 退费金额
        refundableAmount,                                  // 可退金额（未消课金额）
        deductAmount,                                      // 扣除金额
        actualAmount,                                      // 实退金额
      },
      riskCheck,  // 风控检查结果
    };
  }

  // ============================================
  // 二、退费风控
  // ============================================

  /**
   * 【风控规则入口】退费风控检查
   * 
   * 检查维度：
   * 1. 单人退费率 - 该学员历史退费情况
   * 2. 校区退费率 - 该校区近期退费情况
   * 3. 金额风控 - 大额退费特殊关注
   * 
   * 【风控规则配置点 2】
   * 可以在这里扩展更多风控规则：
   * - 新签合同X天内退费（冲动消费保护）
   * - 同一课包多人退费（课程质量问题）
   * - 同一销售员客户退费率
   * - 季节性退费异常检测
   * 
   * @param studentId 学员ID
   * @param campusId 校区ID
   * @param refundAmount 退费金额
   * @returns 风控检查结果
   */
  async checkRefundRisk(
    studentId: string,
    campusId: string,
    refundAmount: number,
  ): Promise<RiskCheckResult> {
    const warnings: string[] = [];
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    // ============================================
    // 风控维度1：单人退费率检查
    // ============================================
    const studentHistory = await this.getStudentRefundHistory(studentId);
    const studentRefundRate = studentHistory.totalContracts > 0
      ? studentHistory.refundedContracts / studentHistory.totalContracts
      : 0;

    /**
     * 【风控规则配置点 3】
     * 单人退费率规则可扩展：
     * - 按时间段区分（近3个月 vs 历史全部）
     * - 按金额权重计算（大额合同权重更高）
     * - 按课程类型区分（试听课 vs 正式课）
     */
    if (studentRefundRate >= this.RISK_CONFIG.STUDENT_REFUND_RATE_BLOCK) {
      warnings.push(`⚠️ 高风险：该学员退费率达 ${(studentRefundRate * 100).toFixed(1)}%，历史有 ${studentHistory.refundedContracts} 次退费`);
      riskLevel = 'HIGH';
    } else if (studentRefundRate >= this.RISK_CONFIG.STUDENT_REFUND_RATE_WARNING) {
      warnings.push(`⚠️ 警告：该学员退费率达 ${(studentRefundRate * 100).toFixed(1)}%`);
      if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
    }

    // ============================================
    // 风控维度2：校区退费率检查
    // ============================================
    const campusHistory = await this.getCampusRefundHistory(campusId);
    const campusRefundRate = campusHistory.periodPaidAmount > 0
      ? campusHistory.periodRefundAmount / campusHistory.periodPaidAmount
      : 0;

    /**
     * 【风控规则配置点 4】
     * 校区退费率规则可扩展：
     * - 按月度/季度/年度统计
     * - 与其他校区对比（相对阈值）
     * - 环比增长率（本月比上月增长多少）
     */
    if (campusRefundRate >= this.RISK_CONFIG.CAMPUS_REFUND_RATE_BLOCK) {
      warnings.push(`⚠️ 高风险：该校区近期退费率达 ${(campusRefundRate * 100).toFixed(1)}%，需要高级别审批`);
      riskLevel = 'HIGH';
    } else if (campusRefundRate >= this.RISK_CONFIG.CAMPUS_REFUND_RATE_WARNING) {
      warnings.push(`⚠️ 警告：该校区近期退费率达 ${(campusRefundRate * 100).toFixed(1)}%`);
      if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
    }

    // ============================================
    // 风控维度3：金额风控
    // ============================================
    /**
     * 【风控规则配置点 5】
     * 金额风控规则可扩展：
     * - 单笔金额阈值
     * - 累计金额阈值（月度）
     * - 审批权限分级（金额越大审批级别越高）
     */
    if (refundAmount >= this.RISK_CONFIG.HIGH_AMOUNT_THRESHOLD) {
      warnings.push(`⚠️ 大额退费：退费金额 ¥${refundAmount.toFixed(2)} 超过阈值，需要老板审批`);
      if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
    }

    return {
      passed: riskLevel !== 'HIGH',  // HIGH 级别阻断
      riskLevel,
      warnings,
      studentRefundRate,
      campusRefundRate,
      details: {
        studentHistory,
        campusHistory,
      },
    };
  }

  /**
   * 获取学员退费历史统计
   * 
   * 【风控规则配置点 6】
   * 可扩展统计维度：
   * - 近N个月的退费情况
   * - 按课程类型分类统计
   * - 退费原因分析
   */
  private async getStudentRefundHistory(studentId: string) {
    // 查询该学员所有合同
    const contracts = await this.prisma.contract.findMany({
      where: { studentId },
      select: {
        id: true,
        status: true,
        paidAmount: true,
      },
    });

    // 查询该学员已完成的退费
    const refunds = await this.prisma.refund.findMany({
      where: {
        contract: { studentId },
        status: RefundStatus.COMPLETED,
      },
      select: {
        actualAmount: true,
      },
    });

    const totalContracts = contracts.length;
    const refundedContracts = contracts.filter(c => c.status === 3).length; // status=3 表示已退费
    const totalPaid = contracts.reduce((sum, c) => sum + Number(c.paidAmount), 0);
    const totalRefunded = refunds.reduce((sum, r) => sum + Number(r.actualAmount), 0);

    return {
      totalContracts,
      refundedContracts,
      totalPaid,
      totalRefunded,
    };
  }

  /**
   * 获取校区退费历史统计（近30天）
   * 
   * 【风控规则配置点 7】
   * 可扩展统计周期：
   * - 周统计
   * - 月统计
   * - 季度统计
   */
  private async getCampusRefundHistory(campusId: string) {
    const periodDays = this.RISK_CONFIG.STATISTICS_PERIOD_DAYS;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    // 查询近期收款
    const payments = await this.prisma.payment.findMany({
      where: {
        campusId,
        paidAt: { gte: startDate },
        status: 1,
      },
      select: { amount: true },
    });

    // 查询近期退费（已完成）
    const refunds = await this.prisma.refund.findMany({
      where: {
        campusId,
        refundedAt: { gte: startDate },
        status: RefundStatus.COMPLETED,
      },
      select: { actualAmount: true },
    });

    // 查询近期合同数
    const contracts = await this.prisma.contract.count({
      where: {
        campusId,
        createdAt: { gte: startDate },
      },
    });

    const periodPaidAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const periodRefundAmount = refunds.reduce((sum, r) => sum + Number(r.actualAmount), 0);

    return {
      periodContracts: contracts,
      periodRefunds: refunds.length,
      periodPaidAmount,
      periodRefundAmount,
    };
  }

  // ============================================
  // 三、创建退费申请
  // ============================================

  /**
   * 创建退费申请
   * 
   * 业务流程：
   * 1. 校验合同是否存在且可退费
   * 2. 检查是否有进行中的退费申请
   * 3. 计算可退金额和实退金额
   * 4. 执行风控检查
   * 5. 创建退费申请记录
   * 6. 返回申请详情
   * 
   * 【风控规则配置点 8】
   * 可在此处添加前置校验：
   * - 新签合同X天内不允许退费
   * - 特殊标记学员需要人工审核
   * - 促销活动期间退费限制
   */
  async create(createDto: CreateRefundDto, currentUser: any) {
    const { contractId, reason, refundType = RefundType.NORMAL, deductAmount = 0 } = createDto;

    // 1. 查询合同信息
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        student: true,
        package: true,
        campus: true,
      },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) {
      throw new BadRequestException('该合同不是正常状态，无法退费');
    }

    // 2. 检查是否有进行中的退费申请
    const existingRefund = await this.prisma.refund.findFirst({
      where: {
        contractId,
        status: { in: [RefundStatus.PENDING, RefundStatus.APPROVED] },
      },
    });
    if (existingRefund) {
      throw new BadRequestException('该合同已有进行中的退费申请');
    }

    // 3. 计算金额
    const refundableAmount = DecimalUtil.toNumber(contract.unearned.toString());
    const actualAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(refundableAmount.toString(), deductAmount.toString())
    );

    if (actualAmount < 0) {
      throw new BadRequestException('扣除金额不能大于可退金额');
    }

    // 4. 执行风控检查
    /**
     * 【风控规则配置点 9】
     * 可以根据风控结果决定是否允许创建申请：
     * - HIGH 风险：阻断创建，提示需要人工介入
     * - MEDIUM 风险：允许创建，但自动升级审批级别
     * - LOW 风险：正常创建
     */
    const riskCheck = await this.checkRefundRisk(
      contract.studentId,
      contract.campusId,
      refundableAmount
    );

    // 如果风控不通过，可以选择阻断或标记
    // if (!riskCheck.passed) {
    //   throw new BadRequestException('该退费申请触发风控规则，请联系管理员处理');
    // }

    // 5. 创建退费申请
    const refundNo = NumberGenerator.generateRefundNo();

    const refund = await this.prisma.refund.create({
      data: {
        refundNo,
        contractId,
        campusId: contract.campusId,
        remainLessons: contract.remainLessons,
        unitPrice: Number(contract.unitPrice),
        refundableAmount,
        deductAmount,
        actualAmount,
        reason,
        refundType,
        status: RefundStatus.PENDING,  // 初始状态：待审批
        createdById: currentUser.userId,
        snapshotData: {
          // 申请时的合同快照
          contract: {
            id: contract.id,
            contractNo: contract.contractNo,
            paidAmount: Number(contract.paidAmount),
            contractAmount: Number(contract.contractAmount),
            totalLessons: contract.totalLessons,
            usedLessons: contract.usedLessons,
            remainLessons: contract.remainLessons,
            unearned: Number(contract.unearned),
          },
          // 学员信息快照
          student: {
            id: contract.student.id,
            name: contract.student.name,
            code: contract.student.code,
          },
          // 课包信息快照
          package: {
            id: contract.package.id,
            name: contract.package.name,
          },
          // 风控检查结果（转换为普通对象）
          riskCheck: JSON.parse(JSON.stringify(riskCheck)),
        },
      },
    });

    return this.findOne(refund.id);
  }

  // ============================================
  // 四、查询退费列表
  // ============================================

  /**
   * 查询退费列表
   */
  async findAll(query: QueryRefundDto) {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      campusId,
      status,
      refundType,
      startDate,
      endDate,
    } = query;

    const where: any = {};

    // 关键词搜索
    if (keyword) {
      where.OR = [
        { refundNo: { contains: keyword } },
        { contract: { contractNo: { contains: keyword } } },
        { contract: { student: { name: { contains: keyword } } } },
      ];
    }

    // 筛选条件
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;
    if (refundType) where.refundType = refundType;
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59'),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: {
            include: {
              student: { select: { id: true, name: true, code: true } },
              package: { select: { id: true, name: true } },
            },
          },
          campus: { select: { id: true, name: true } },
          createdBy: { select: { id: true, realName: true } },
          approvedBy: { select: { id: true, realName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.refund.count({ where }),
    ]);

    // 为每条记录添加状态名称
    const dataWithStatus = data.map(item => ({
      ...item,
      statusName: this.getStatusName(item.status),
      refundTypeName: this.getRefundTypeName(item.refundType),
    }));

    return new PaginatedResponseDto(dataWithStatus, total, page, pageSize);
  }

  /**
   * 获取待审批列表
   */
  async findPending() {
    const data = await this.prisma.refund.findMany({
      where: { status: RefundStatus.PENDING },
      include: {
        contract: {
          include: {
            student: { select: { id: true, name: true, code: true } },
            campus: { select: { id: true, name: true } },
            package: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },  // 先申请先处理
    });

    return data.map(item => ({
      ...item,
      statusName: this.getStatusName(item.status),
      refundTypeName: this.getRefundTypeName(item.refundType),
    }));
  }

  /**
   * 获取退费详情
   */
  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            student: true,
            campus: true,
            package: true,
          },
        },
        campus: true,
        createdBy: { select: { id: true, realName: true } },
        approvedBy: { select: { id: true, realName: true } },
      },
    });

    if (!refund) throw new NotFoundException('退费申请不存在');

    return {
      ...refund,
      statusName: this.getStatusName(refund.status),
      refundTypeName: this.getRefundTypeName(refund.refundType),
    };
  }

  // ============================================
  // 五、审批退费
  // ============================================

  /**
   * 审批退费申请
   * 
   * 业务流程：
   * 1. 校验退费申请状态（必须是待审批）
   * 2. 记录审批结果
   * 3. 如果通过，可以调整实退金额
   * 4. 更新状态为"已通过"或"已驳回"
   * 
   * 审批流状态变更：
   * - 通过：PENDING(0) -> APPROVED(1)
   * - 驳回：PENDING(0) -> REJECTED(2)
   * 
   * 【风控规则配置点 10】
   * 可在审批时添加额外校验：
   * - 审批权限验证（金额越大需要越高级别审批）
   * - 双人审批（大额退费需要两人同意）
   * - 审批时效（超过X天未审批自动提醒）
   */
  async approve(id: string, approveDto: ApproveRefundDto, currentUser: any) {
    const refund = await this.findOne(id);

    // 1. 校验状态
    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('该退费申请不是待审批状态');
    }

    // 2. 确定新状态
    const newStatus = approveDto.approved ? RefundStatus.APPROVED : RefundStatus.REJECTED;

    // 3. 调整实退金额（仅审批通过时）
    let actualAmount = Number(refund.actualAmount);
    if (approveDto.approved && approveDto.actualAmount !== undefined) {
      if (approveDto.actualAmount > Number(refund.refundableAmount)) {
        throw new BadRequestException('调整后的金额不能大于可退金额');
      }
      actualAmount = approveDto.actualAmount;
    }

    // 4. 更新退费申请
    const updated = await this.prisma.refund.update({
      where: { id },
      data: {
        status: newStatus,
        approvedAt: new Date(),
        approvedById: currentUser.userId,
        approveRemark: approveDto.remark,
        actualAmount: approveDto.approved ? actualAmount : undefined,
      },
    });

    return this.findOne(updated.id);
  }

  // ============================================
  // 六、完成退费打款
  // ============================================

  /**
   * 完成退费（确认打款）
   * 
   * 业务流程：
   * 1. 校验退费申请状态（必须是已通过）
   * 2. 在事务中：
   *    a. 更新退费状态为"已完成"
   *    b. 更新合同状态为"已退费"
   *    c. 清零合同的剩余课时和未消课金额
   * 3. 返回完成后的退费详情
   * 
   * 状态变更：APPROVED(1) -> COMPLETED(3)
   * 
   * 【风控规则配置点 11】
   * 可在打款确认时添加校验：
   * - 银行账户合规性验证
   * - 打款金额二次确认
   * - 打款审批链验证
   */
  async complete(id: string, completeDto: CompleteRefundDto, currentUser: any) {
    const refund = await this.findOne(id);

    // 1. 校验状态
    if (refund.status !== RefundStatus.APPROVED) {
      throw new BadRequestException('该退费申请不是已通过状态，无法确认打款');
    }

    // 2. 事务处理
    await this.prisma.$transaction(async (tx) => {
      // 2a. 更新退费状态
      await tx.refund.update({
        where: { id },
        data: {
          status: RefundStatus.COMPLETED,
          refundMethod: completeDto.refundMethod,
          refundAccount: completeDto.refundAccount,
          transactionNo: completeDto.transactionNo,
          refundedAt: new Date(),
        },
      });

      // 2b. 更新合同状态
      await tx.contract.update({
        where: { id: refund.contractId },
        data: {
          status: 3,        // 3-已退费
          unearned: 0,      // 清零未消课金额
          remainLessons: 0, // 清零剩余课时
        },
      });

      // 2c. 更新学员状态（可选）
      /**
       * 【风控规则配置点 12】
       * 可以在这里更新学员状态：
       * - 如果学员没有其他有效合同，更新为"退学"
       * - 记录学员退费标记，用于后续风控
       */
      // const otherActiveContracts = await tx.contract.count({
      //   where: {
      //     studentId: refund.contract.studentId,
      //     status: 1,
      //     id: { not: refund.contractId },
      //   },
      // });
      // if (otherActiveContracts === 0) {
      //   await tx.student.update({
      //     where: { id: refund.contract.studentId },
      //     data: { status: 3 },  // 3-退学
      //   });
      // }
    });

    return this.findOne(id);
  }

  /**
   * 取消退费申请
   * 只有待审批状态可以取消
   */
  async cancel(id: string, currentUser: any) {
    const refund = await this.findOne(id);

    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('只有待审批的退费申请可以取消');
    }

    // 只有申请人或管理员可以取消
    if (refund.createdById !== currentUser.userId && !currentUser.roles.includes('BOSS')) {
      throw new BadRequestException('只有申请人或管理员可以取消退费申请');
    }

    await this.prisma.refund.update({
      where: { id },
      data: { status: RefundStatus.CANCELLED },
    });

    return this.findOne(id);
  }

  // ============================================
  // 七、退费统计
  // ============================================

  /**
   * 退费统计
   */
  async getStatistics(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: RefundStatus.COMPLETED };

    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.refundedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59'),
      };
    }

    // 汇总统计
    const stats = await this.prisma.refund.aggregate({
      where,
      _count: true,
      _sum: {
        actualAmount: true,
        remainLessons: true,
        deductAmount: true,
      },
    });

    // 按退费类型统计
    const byType = await this.prisma.refund.groupBy({
      by: ['refundType'],
      where,
      _count: true,
      _sum: { actualAmount: true },
    });

    // 按校区统计
    const byCampus = await this.prisma.refund.groupBy({
      by: ['campusId'],
      where,
      _count: true,
      _sum: { actualAmount: true },
    });

    // 获取校区名称
    const campusIds = byCampus.map(c => c.campusId);
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: campusIds } },
      select: { id: true, name: true },
    });
    const campusMap = new Map(campuses.map(c => [c.id, c.name]));

    return {
      summary: {
        totalCount: stats._count,
        totalAmount: Number(stats._sum.actualAmount || 0),
        totalLessons: stats._sum.remainLessons || 0,
        totalDeduct: Number(stats._sum.deductAmount || 0),
      },
      byType: byType.map((t) => ({
        type: t.refundType,
        typeName: this.getRefundTypeName(t.refundType),
        count: t._count,
        amount: Number(t._sum.actualAmount || 0),
      })),
      byCampus: byCampus.map((c) => ({
        campusId: c.campusId,
        campusName: campusMap.get(c.campusId) || '未知校区',
        count: c._count,
        amount: Number(c._sum.actualAmount || 0),
      })),
    };
  }

  /**
   * 获取退费率报表
   * 
   * 【风控规则配置点 13】
   * 用于管理层监控各校区退费情况
   */
  async getRefundRateReport(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate + 'T23:59:59');

    // 获取各校区收款和退费数据
    const campuses = await this.prisma.campus.findMany({
      where: { status: 1 },
      select: { id: true, name: true },
    });

    const reports = await Promise.all(
      campuses.map(async (campus) => {
        // 期间收款
        const payments = await this.prisma.payment.aggregate({
          where: {
            campusId: campus.id,
            paidAt: { gte: start, lte: end },
            status: 1,
          },
          _sum: { amount: true },
          _count: true,
        });

        // 期间退费
        const refunds = await this.prisma.refund.aggregate({
          where: {
            campusId: campus.id,
            refundedAt: { gte: start, lte: end },
            status: RefundStatus.COMPLETED,
          },
          _sum: { actualAmount: true },
          _count: true,
        });

        const paidAmount = Number(payments._sum.amount || 0);
        const refundAmount = Number(refunds._sum.actualAmount || 0);
        const refundRate = paidAmount > 0 ? refundAmount / paidAmount : 0;

        return {
          campusId: campus.id,
          campusName: campus.name,
          paidAmount,
          paidCount: payments._count,
          refundAmount,
          refundCount: refunds._count,
          refundRate,
          refundRatePercent: (refundRate * 100).toFixed(2) + '%',
          riskLevel: refundRate >= 0.2 ? 'HIGH' : refundRate >= 0.1 ? 'MEDIUM' : 'LOW',
        };
      })
    );

    return reports.sort((a, b) => b.refundRate - a.refundRate);
  }

  // ============================================
  // 辅助方法
  // ============================================

  private getStatusName(status: number): string {
    const statusMap: Record<number, string> = {
      [RefundStatus.PENDING]: '待审批',
      [RefundStatus.APPROVED]: '已通过（待打款）',
      [RefundStatus.REJECTED]: '已驳回',
      [RefundStatus.COMPLETED]: '已完成',
      [RefundStatus.CANCELLED]: '已取消',
    };
    return statusMap[status] || '未知状态';
  }

  private getRefundTypeName(type: string): string {
    const types: Record<string, string> = {
      [RefundType.NORMAL]: '正常退费',
      [RefundType.TRANSFER]: '转校退费',
      [RefundType.TERMINATE]: '终止合作',
    };
    return types[type] || type;
  }
}
