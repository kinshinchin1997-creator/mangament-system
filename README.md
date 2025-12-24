# 教培行业现金流管理系统

> 预收款 → 消课 → 退费 核心业务管理

## 🎯 系统简介

这是一个专为教育培训行业设计的内部管理系统，核心解决教培机构的现金流管理问题：

- **预收款管理**：学员签约购买课包，形成预收款（负债）
- **消课确认收入**：每次上课消耗课时，预收款转为已确认收入
- **退费管理**：学员退课时，按剩余课时计算退款

## 🏗️ 技术栈

- **后端框架**: NestJS (Node.js + TypeScript)
- **ORM**: Prisma
- **数据库**: MySQL
- **接口风格**: RESTful
- **权限控制**: RBAC (角色-权限模型)
- **API文档**: Swagger

## 📁 项目结构

```
src/
├── main.ts                    # 应用入口
├── app.module.ts              # 根模块
├── prisma/                    # Prisma 服务
├── common/                    # 通用模块
│   ├── decorators/           # 装饰器
│   ├── guards/               # 守卫
│   ├── interceptors/         # 拦截器
│   ├── dto/                  # 通用 DTO
│   ├── utils/                # 工具类
│   ├── constants/            # 常量
│   └── types/                # 类型定义
└── modules/                   # 业务模块
    ├── auth/                 # 认证
    ├── campus/               # 校区管理
    ├── user/                 # 用户管理
    ├── teacher/              # 教师管理
    ├── student/              # 学员管理
    ├── course-package/       # 课包管理
    ├── contract/             # 合同管理 ⭐
    ├── lesson/               # 消课管理 ⭐
    ├── refund/               # 退费管理 ⭐
    └── finance/              # 财务管理 ⭐
```

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库连接：

```env
DATABASE_URL="mysql://root:password@localhost:3306/edu_cashflow"
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="24h"
```

### 3. 数据库迁移

```bash
# 生成 Prisma Client
npm run prisma:generate

# 执行数据库迁移
npm run prisma:migrate

# 初始化种子数据
npm run prisma:seed
```

### 4. 启动服务

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

### 5. 访问 API 文档

打开浏览器访问: http://localhost:3000/api/docs

## 👥 默认账号

| 角色 | 用户名 | 密码 | 权限说明 |
|-----|-------|------|---------|
| 管理员 | admin | 123456 | 全部权限 |
| 财务 | finance | 123456 | 审批退费、财务报表 |
| 校区负责人 | manager1 | 123456 | 本校区业务管理 |

## 📊 核心业务流程

### 预收款（签约）

```
学员 + 课包 → 创建合同 → 收款入账 → 生成现金流水
```

### 消课（确认收入）

```
选择合同 → 记录上课 → 扣减课时 → 确认收入
```

### 退费

```
发起申请 → 计算可退金额 → 审批 → 打款 → 更新合同状态
```

## 🔐 权限设计

采用 RBAC 模型：用户 → 角色 → 权限

预设角色：
- **BOSS**: 老板，拥有全部权限
- **FINANCE**: 财务，可审批退费、查看报表
- **CAMPUS_MANAGER**: 校区负责人，管理本校区业务
- **TEACHER**: 教师，可进行消课操作

## 📈 财务报表

- 预收款余额报表
- 收入确认报表（消课统计）
- 现金流汇总
- 校区对比报表
- 日结对账

## 🛠️ 开发指南

### 添加新模块

```bash
nest g module modules/xxx
nest g controller modules/xxx
nest g service modules/xxx
```

### 数据库变更

```bash
# 修改 prisma/schema.prisma 后
npm run prisma:migrate
```

## 📝 License

UNLICENSED - 仅供内部使用

