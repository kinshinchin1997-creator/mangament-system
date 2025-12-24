import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 预收款余额报表服务
 * 
 * 预收款余额 = 所有正常合同的剩余课时对应金额
 * 计算公式：∑(合同已收金额 / 总课时 * 剩余课时)
 */
@Injectable()
export class PrepaidBalanceService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取预收款余额汇总
   */
  async getSummary(campusId?: string) {
    const where: any = { status: 1 }; // 正常状态合同
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      select: {
        paidAmount: true,
        totalLessons: true,
        remainLessons: true,
        usedLessons: true,
      },
    });

    let totalPrepaidBalance = 0;
    let totalRemainLessons = 0;
    let totalUsedLessons = 0;
    let totalPaidAmount = 0;

    for (const contract of contracts) {
      const unitPrice = contract.paidAmount.toNumber() / contract.totalLessons;
      const prepaidBalance = unitPrice * contract.remainLessons;
      
      totalPrepaidBalance += prepaidBalance;
      totalRemainLessons += contract.remainLessons;
      totalUsedLessons += contract.usedLessons;
      totalPaidAmount += contract.paidAmount.toNumber();
    }

    // 已确认收入 = 总收款 - 预收款余额
    const confirmedRevenue = totalPaidAmount - totalPrepaidBalance;

    return {
      totalContracts: contracts.length,
      totalPaidAmount: DecimalUtil.format(totalPaidAmount.toString()),
      totalPrepaidBalance: DecimalUtil.format(totalPrepaidBalance.toString()),
      confirmedRevenue: DecimalUtil.format(confirmedRevenue.toString()),
      totalRemainLessons,
      totalUsedLessons,
      consumptionRate: contracts.length > 0
        ? ((totalUsedLessons / (totalUsedLessons + totalRemainLessons)) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * 按校区统计预收款余额
   */
  async getByCampus() {
    const campuses = await this.prisma.campus.findMany({
      where: { status: 1 },
      include: {
        contracts: {
          where: { status: 1 },
          select: {
            paidAmount: true,
            totalLessons: true,
            remainLessons: true,
          },
        },
      },
    });

    const result = campuses.map((campus) => {
      let prepaidBalance = 0;
      let remainLessons = 0;

      for (const contract of campus.contracts) {
        const unitPrice = contract.paidAmount.toNumber() / contract.totalLessons;
        prepaidBalance += unitPrice * contract.remainLessons;
        remainLessons += contract.remainLessons;
      }

      return {
        campusId: campus.id,
        campusName: campus.name,
        contractCount: campus.contracts.length,
        remainLessons,
        prepaidBalance: DecimalUtil.format(prepaidBalance.toString()),
      };
    });

    // 按预收款余额降序排列
    result.sort((a, b) => parseFloat(b.prepaidBalance) - parseFloat(a.prepaidBalance));

    return result;
  }

  /**
   * 按课包统计预收款余额
   */
  async getByPackage(campusId?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        package: { select: { id: true, name: true, category: true } },
      },
    });

    const packageMap = new Map<string, any>();

    for (const contract of contracts) {
      const pkgId = contract.package.id;
      const unitPrice = contract.paidAmount.toNumber() / contract.totalLessons;
      const prepaidBalance = unitPrice * contract.remainLessons;

      if (!packageMap.has(pkgId)) {
        packageMap.set(pkgId, {
          packageId: pkgId,
          packageName: contract.package.name,
          category: contract.package.category,
          contractCount: 0,
          remainLessons: 0,
          prepaidBalance: 0,
        });
      }

      const pkg = packageMap.get(pkgId);
      pkg.contractCount++;
      pkg.remainLessons += contract.remainLessons;
      pkg.prepaidBalance += prepaidBalance;
    }

    const result = Array.from(packageMap.values()).map((pkg) => ({
      ...pkg,
      prepaidBalance: DecimalUtil.format(pkg.prepaidBalance.toString()),
    }));

    // 按预收款余额降序排列
    result.sort((a, b) => parseFloat(b.prepaidBalance) - parseFloat(a.prepaidBalance));

    return result;
  }
}

