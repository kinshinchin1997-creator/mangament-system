import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化数据...\n');

  // ==================== 1. 创建权限 ====================
  console.log('📋 创建权限...');
  const permissions = [
    // 合同权限
    { code: 'contract:create', name: '创建合同', module: 'contract' },
    { code: 'contract:read', name: '查看合同', module: 'contract' },
    { code: 'contract:update', name: '更新合同', module: 'contract' },
    { code: 'contract:complete', name: '完结合同', module: 'contract' },

    // 消课权限
    { code: 'lesson:create', name: '创建消课', module: 'lesson' },
    { code: 'lesson:read', name: '查看消课', module: 'lesson' },
    { code: 'lesson:revoke', name: '撤销消课', module: 'lesson' },

    // 收款权限
    { code: 'payment:create', name: '创建收款', module: 'payment' },
    { code: 'payment:read', name: '查看收款', module: 'payment' },

    // 退费权限
    { code: 'refund:create', name: '申请退费', module: 'refund' },
    { code: 'refund:read', name: '查看退费', module: 'refund' },
    { code: 'refund:approve', name: '审批退费', module: 'refund' },
    { code: 'refund:complete', name: '完成退费', module: 'refund' },

    // 财务权限
    { code: 'finance:read', name: '查看财务', module: 'finance' },
    { code: 'finance:report', name: '财务报表', module: 'finance' },
    { code: 'finance:settlement', name: '日结管理', module: 'finance' },

    // 用户权限
    { code: 'user:create', name: '创建用户', module: 'user' },
    { code: 'user:read', name: '查看用户', module: 'user' },
    { code: 'user:update', name: '更新用户', module: 'user' },
    { code: 'user:delete', name: '删除用户', module: 'user' },

    // 校区权限
    { code: 'campus:create', name: '创建校区', module: 'campus' },
    { code: 'campus:read', name: '查看校区', module: 'campus' },
    { code: 'campus:update', name: '更新校区', module: 'campus' },
    { code: 'campus:delete', name: '删除校区', module: 'campus' },

    // 教师权限
    { code: 'teacher:create', name: '创建教师', module: 'teacher' },
    { code: 'teacher:read', name: '查看教师', module: 'teacher' },
    { code: 'teacher:update', name: '更新教师', module: 'teacher' },

    // 学员权限
    { code: 'student:create', name: '创建学员', module: 'student' },
    { code: 'student:read', name: '查看学员', module: 'student' },
    { code: 'student:update', name: '更新学员', module: 'student' },

    // 课包权限
    { code: 'course-package:create', name: '创建课包', module: 'course-package' },
    { code: 'course-package:read', name: '查看课包', module: 'course-package' },
    { code: 'course-package:update', name: '更新课包', module: 'course-package' },

    // 角色权限
    { code: 'role:create', name: '创建角色', module: 'role' },
    { code: 'role:read', name: '查看角色', module: 'role' },
    { code: 'role:update', name: '更新角色', module: 'role' },
    { code: 'role:delete', name: '删除角色', module: 'role' },

    // 审计权限
    { code: 'audit:read', name: '查看审计日志', module: 'audit' },
  ];

  const createdPermissions = [];
  for (const permission of permissions) {
    const p = await prisma.permission.upsert({
      where: { code: permission.code },
      update: {},
      create: permission,
    });
    createdPermissions.push(p);
  }
  console.log(`   ✓ 创建了 ${createdPermissions.length} 个权限\n`);

  // ==================== 2. 创建角色 ====================
  console.log('👔 创建角色...');
  const roles = [
    { code: 'BOSS', name: '老板', description: '系统最高权限，可以访问所有功能' },
    { code: 'FINANCE', name: '财务', description: '财务人员，可以审批退费、查看财务报表' },
    { code: 'CAMPUS_MANAGER', name: '校区负责人', description: '校区负责人，可以管理本校区的业务' },
    { code: 'TEACHER', name: '教师', description: '教师，可以进行消课操作' },
  ];

  const createdRoles = [];
  for (const role of roles) {
    const r = await prisma.role.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
    createdRoles.push(r);
  }
  console.log(`   ✓ 创建了 ${createdRoles.length} 个角色\n`);

  // ==================== 3. 角色-权限关联 ====================
  console.log('🔗 分配权限...');
  
  const roleMap = new Map(createdRoles.map((r) => [r.code, r]));
  const permissionMap = new Map(createdPermissions.map((p) => [p.code, p]));

  // BOSS 拥有所有权限
  const bossRole = roleMap.get('BOSS')!;
  for (const permission of createdPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: bossRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: bossRole.id, permissionId: permission.id },
    });
  }
  console.log(`   ✓ BOSS: 全部权限`);

  // FINANCE 的权限
  const financeRole = roleMap.get('FINANCE')!;
  const financePermCodes = [
    'contract:read', 'lesson:read', 'payment:read', 'refund:read', 'refund:approve', 'refund:complete',
    'finance:read', 'finance:report', 'finance:settlement',
    'student:read', 'teacher:read', 'campus:read', 'course-package:read',
  ];
  for (const code of financePermCodes) {
    const permission = permissionMap.get(code);
    if (permission) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: financeRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: financeRole.id, permissionId: permission.id },
      });
    }
  }
  console.log(`   ✓ FINANCE: ${financePermCodes.length} 个权限`);

  // CAMPUS_MANAGER 的权限
  const campusManagerRole = roleMap.get('CAMPUS_MANAGER')!;
  const campusManagerPermCodes = [
    'contract:create', 'contract:read', 'contract:update', 'contract:complete',
    'lesson:create', 'lesson:read', 'lesson:revoke',
    'payment:create', 'payment:read',
    'refund:create', 'refund:read',
    'finance:read',
    'student:create', 'student:read', 'student:update',
    'teacher:create', 'teacher:read', 'teacher:update',
    'campus:read', 'course-package:read',
  ];
  for (const code of campusManagerPermCodes) {
    const permission = permissionMap.get(code);
    if (permission) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: campusManagerRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: campusManagerRole.id, permissionId: permission.id },
      });
    }
  }
  console.log(`   ✓ CAMPUS_MANAGER: ${campusManagerPermCodes.length} 个权限`);

  // TEACHER 的权限
  const teacherRole = roleMap.get('TEACHER')!;
  const teacherPermCodes = ['lesson:create', 'lesson:read', 'student:read'];
  for (const code of teacherPermCodes) {
    const permission = permissionMap.get(code);
    if (permission) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: teacherRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: teacherRole.id, permissionId: permission.id },
      });
    }
  }
  console.log(`   ✓ TEACHER: ${teacherPermCodes.length} 个权限\n`);

  // ==================== 4. 创建校区 ====================
  console.log('🏫 创建校区...');
  const campuses = [
    { code: 'HQ', name: '总部', address: '北京市朝阳区xxx路xxx号', phone: '010-12345678' },
    { code: 'BJ001', name: '北京朝阳校区', address: '北京市朝阳区yyy路yyy号', phone: '010-87654321' },
    { code: 'BJ002', name: '北京海淀校区', address: '北京市海淀区zzz路zzz号', phone: '010-11111111' },
  ];

  const createdCampuses = [];
  for (const campus of campuses) {
    const c = await prisma.campus.upsert({
      where: { code: campus.code },
      update: {},
      create: campus,
    });
    createdCampuses.push(c);
  }
  const campusMap = new Map(createdCampuses.map((c) => [c.code, c]));
  console.log(`   ✓ 创建了 ${createdCampuses.length} 个校区\n`);

  // ==================== 5. 创建用户 ====================
  console.log('👤 创建用户...');
  const password = await bcrypt.hash('123456', 10);

  const users = [
    { username: 'admin', realName: '系统管理员', phone: '13800000000', email: 'admin@example.com', roleCode: 'BOSS' },
    { username: 'finance', realName: '财务张三', phone: '13800000001', email: 'finance@example.com', roleCode: 'FINANCE' },
    { username: 'manager1', realName: '李校长', phone: '13800000002', campusCode: 'BJ001', roleCode: 'CAMPUS_MANAGER' },
    { username: 'manager2', realName: '王校长', phone: '13800000003', campusCode: 'BJ002', roleCode: 'CAMPUS_MANAGER' },
  ];

  for (const userData of users) {
    const { roleCode, campusCode, ...userInfo } = userData;
    const campus = campusCode ? campusMap.get(campusCode) : null;

    const user = await prisma.user.upsert({
      where: { username: userData.username },
      update: {},
      create: {
        ...userInfo,
        password,
        campusId: campus?.id,
      },
    });

    const role = roleMap.get(roleCode);
    if (role) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
  }
  console.log(`   ✓ 创建了 ${users.length} 个用户\n`);

  // ==================== 6. 创建课包 ====================
  console.log('📦 创建课包...');
  const packages = [
    { code: 'ART-48', name: '美术基础班 48课时', category: '美术', unitPrice: 100, totalLessons: 48, totalAmount: 4800, validDays: 365 },
    { code: 'ART-96', name: '美术进阶班 96课时', category: '美术', unitPrice: 95, totalLessons: 96, totalAmount: 9120, validDays: 730 },
    { code: 'MUSIC-36', name: '钢琴入门班 36课时', category: '音乐', unitPrice: 150, totalLessons: 36, totalAmount: 5400, validDays: 365 },
    { code: 'CODE-24', name: '少儿编程入门 24课时', category: '编程', unitPrice: 200, totalLessons: 24, totalAmount: 4800, validDays: 180 },
    { code: 'DANCE-48', name: '舞蹈基础班 48课时', category: '舞蹈', unitPrice: 80, totalLessons: 48, totalAmount: 3840, validDays: 365 },
  ];

  for (const pkg of packages) {
    await prisma.coursePackage.upsert({
      where: { code: pkg.code },
      update: {},
      create: pkg,
    });
  }
  console.log(`   ✓ 创建了 ${packages.length} 个课包\n`);

  // ==================== 7. 创建教师 ====================
  console.log('👨‍🏫 创建教师...');
  const teachers = [
    { code: 'TCH001', name: '王老师', phone: '13900000001', campusCode: 'BJ001', hourlyRate: 80 },
    { code: 'TCH002', name: '赵老师', phone: '13900000002', campusCode: 'BJ001', hourlyRate: 100 },
    { code: 'TCH003', name: '刘老师', phone: '13900000003', campusCode: 'BJ002', hourlyRate: 90 },
    { code: 'TCH004', name: '陈老师', phone: '13900000004', campusCode: 'BJ002', hourlyRate: 85 },
  ];

  for (const teacher of teachers) {
    const { campusCode, ...teacherInfo } = teacher;
    const campus = campusMap.get(campusCode);
    await prisma.teacher.upsert({
      where: { code: teacher.code },
      update: {},
      create: { ...teacherInfo, campusId: campus!.id },
    });
  }
  console.log(`   ✓ 创建了 ${teachers.length} 个教师\n`);

  // ==================== 完成 ====================
  console.log('══════════════════════════════════════════');
  console.log('✅ 数据初始化完成！');
  console.log('══════════════════════════════════════════');
  console.log('');
  console.log('📋 默认账号：');
  console.log('   管理员:       admin / 123456');
  console.log('   财务:         finance / 123456');
  console.log('   朝阳校区校长: manager1 / 123456');
  console.log('   海淀校区校长: manager2 / 123456');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
