import Decimal from 'decimal.js';

// ============================================
// 业务单号生成器
// ============================================
export class NumberGenerator {
  private static counters: Map<string, number> = new Map();

  static generateContractNo(): string {
    return this.generate('HT');
  }

  static generateLessonRecordNo(): string {
    return this.generate('XK');
  }

  static generateRefundNo(): string {
    return this.generate('TF');
  }

  static generateCashFlowNo(): string {
    return this.generate('CF');
  }

  static generateStudentCode(): string {
    return this.generate('STU');
  }

  static generateTeacherCode(): string {
    return this.generate('TCH');
  }

  private static generate(prefix: string): string {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const key = `${prefix}_${dateStr}`;
    let counter = this.counters.get(key) || 0;
    counter++;
    this.counters.set(key, counter);
    const sequence = counter.toString().padStart(3, '0');
    return `${prefix}${dateStr}${sequence}`;
  }
}

// ============================================
// 金额计算工具类（高精度）
// ============================================
export class DecimalUtil {
  static add(a: number | string, b: number | string): string {
    return new Decimal(a).plus(b).toFixed(2);
  }

  static subtract(a: number | string, b: number | string): string {
    return new Decimal(a).minus(b).toFixed(2);
  }

  static multiply(a: number | string, b: number | string): string {
    return new Decimal(a).times(b).toFixed(2);
  }

  static divide(a: number | string, b: number | string): string {
    return new Decimal(a).dividedBy(b).toFixed(2);
  }

  static gt(a: number | string, b: number | string): boolean {
    return new Decimal(a).greaterThan(b);
  }

  static lt(a: number | string, b: number | string): boolean {
    return new Decimal(a).lessThan(b);
  }

  static toNumber(a: number | string): number {
    return new Decimal(a).toNumber();
  }

  static format(a: number | string): string {
    return new Decimal(a).toFixed(2);
  }
}

