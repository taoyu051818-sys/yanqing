-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('MEMBER', 'FRONT_DESK', 'COACH', 'EVENT_MANAGER', 'HOST', 'MERCHANT', 'FINANCE', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');

-- CreateEnum
CREATE TYPE "MemberLevel" AS ENUM ('EXPERIENCE', 'REGULAR', 'GOLD', 'BLACK');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN', 'EVENT_POINTS', 'GROWTH_POINTS');

-- CreateEnum
CREATE TYPE "AccountTxnKind" AS ENUM ('CREDIT', 'DEBIT', 'FREEZE', 'UNFREEZE', 'EXPIRE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('VENUE', 'GAME', 'EVENT', 'TRAINING', 'GOODS', 'MEMBERSHIP', 'RECHARGE', 'ALLIANCE');

-- CreateEnum
CREATE TYPE "SubjectAccount" AS ENUM ('VENUE', 'TRAINING');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('WECHAT', 'CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN', 'OFFLINE_CASH', 'COUPON');

-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('MINI_PROGRAM', 'NEWCOMER_COUPON', 'ALLIANCE', 'REFERRAL', 'QUSPORT', 'STORE_VISIT', 'DOUYIN', 'MEITUAN', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CHECKED_IN', 'COMPLETED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CLOSED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CourtZone" AS ENUM ('EAST', 'WEST', 'SOUTH', 'NORTH');

-- CreateEnum
CREATE TYPE "CourtUsage" AS ENUM ('RETAIL', 'TRAINING', 'MEMBER_BLOCK', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SlotPeriod" AS ENUM ('EARLY', 'DAYTIME', 'PRIME');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "GameLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'MIXED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('WAITLISTED', 'REGISTERED', 'PAID', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('APPLIED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING_OBSERVATION', 'AVAILABLE', 'GRANTED', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamCategory" AS ENUM ('MEN_DOUBLES', 'WOMEN_DOUBLES', 'MIXED_DOUBLES');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'CONFIRMED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "TrainingAudience" AS ENUM ('YOUTH', 'ADULT');

-- CreateEnum
CREATE TYPE "TrainingEnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'ATTENDED', 'LEAVE', 'MAKEUP_REQUIRED', 'MADE_UP', 'ABSENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "MerchantLevel" AS ENUM ('TRAFFIC_PARTNER', 'MEMBER_BENEFIT', 'SPONSOR');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ISSUED', 'CLAIMED', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "InventoryMode" AS ENUM ('PURCHASE', 'CONSIGNMENT');

-- CreateEnum
CREATE TYPE "InventoryTxnType" AS ENUM ('PURCHASE_IN', 'CONSIGNMENT_IN', 'SALE_OUT', 'TRAINING_USAGE', 'EVENT_USAGE', 'ADJUSTMENT', 'RETURN_OUT', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "openId" TEXT,
    "unionId" TEXT,
    "phone" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryRole" "AppRole" NOT NULL DEFAULT 'MEMBER',
    "referrerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AppRole" NOT NULL,
    "merchantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "MemberLevel" NOT NULL DEFAULT 'EXPERIENCE',
    "tags" TEXT[],
    "sourceChannel" "SourceChannel" NOT NULL DEFAULT 'MINI_PROGRAM',
    "membershipExpiresAt" TIMESTAMP(3),
    "isNewCustomer" BOOLEAN NOT NULL DEFAULT true,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "consentVersion" TEXT,
    "consentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthMonth" TIMESTAMP(3),
    "guardianConsentStatus" BOOLEAN NOT NULL DEFAULT false,
    "authorizationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "frozenBalance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "AccountTxnKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "operatorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemParameter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" "ParameterType" NOT NULL,
    "description" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "AppRole",
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "requestId" TEXT,
    "ip" TEXT,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "userId" TEXT,
    "orderId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "summary" TEXT NOT NULL,
    "evidence" JSONB,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" "CourtZone" NOT NULL,
    "usage" "CourtUsage" NOT NULL DEFAULT 'RETAIL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "period" "SlotPeriod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeSlotId" TEXT,
    "weekdayMask" INTEGER NOT NULL DEFAULT 127,
    "priceCents" INTEGER NOT NULL,
    "newcomerPriceCents" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtBooking" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "memberId" TEXT,
    "orderId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "usage" "CourtUsage" NOT NULL DEFAULT 'RETAIL',
    "trainingClassId" TEXT,
    "gameId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourtBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "MemberLevel" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "benefits" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdById" TEXT,
    "businessType" "BusinessType" NOT NULL,
    "subjectAccount" "SubjectAccount" NOT NULL,
    "paymentChannel" "PaymentChannel",
    "sourceChannel" "SourceChannel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "listAmountCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "payableCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "externalOrderNo" TEXT,
    "consumedCouponCode" TEXT,
    "parameterSnapshot" JSONB NOT NULL,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerTradeNo" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "refundNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerRefundNo" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "level" "GameLevel" NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "newcomerOnly" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "rewardRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRegistration" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "HostStatus" NOT NULL DEFAULT 'APPLIED',
    "level" TEXT NOT NULL DEFAULT 'BRONZE',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,

    CONSTRAINT "HostProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostReward" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "basisCount" INTEGER NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING_OBSERVATION',
    "availableAt" TIMESTAMP(3),
    "grantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "registrationEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "capacityPeople" INTEGER NOT NULL DEFAULT 48,
    "minimumPeople" INTEGER NOT NULL DEFAULT 24,
    "totalRounds" INTEGER NOT NULL DEFAULT 5,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL,
    "memberFeeCents" INTEGER,
    "rules" JSONB NOT NULL,
    "prizePool" JSONB,
    "sponsor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTeam" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "captainId" TEXT NOT NULL,
    "orderId" TEXT,
    "name" TEXT NOT NULL,
    "playerAName" TEXT NOT NULL,
    "playerBName" TEXT NOT NULL,
    "playerAUserId" TEXT,
    "playerBUserId" TEXT,
    "category" "TeamCategory" NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "checkedInAt" TIMESTAMP(3),
    "points" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "scoreDiff" INTEGER NOT NULL DEFAULT 0,
    "opponents" TEXT[],
    "finalRank" INTEGER,
    "eventPointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "courtLabel" TEXT,
    "teamAId" TEXT NOT NULL,
    "teamBId" TEXT,
    "startingScoreA" INTEGER NOT NULL DEFAULT 0,
    "startingScoreB" INTEGER NOT NULL DEFAULT 0,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "confirmedById" TEXT,
    "correctionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "TrainingAudience" NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "unitRevenueCents" INTEGER NOT NULL,
    "refundRule" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coachId" TEXT,
    "assistantId" TEXT,
    "schedule" JSONB NOT NULL,
    "capacity" INTEGER NOT NULL,
    "courtCountPerSession" INTEGER NOT NULL DEFAULT 1,
    "hoursPerSession" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "coachCostCents" INTEGER NOT NULL DEFAULT 0,
    "assistantCostCents" INTEGER NOT NULL DEFAULT 0,
    "materialCostCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "enrollmentNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "classId" TEXT,
    "studentId" TEXT,
    "buyerId" TEXT NOT NULL,
    "orderId" TEXT,
    "contractNo" TEXT NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "consumedSessions" INTEGER NOT NULL DEFAULT 0,
    "totalAmountCents" INTEGER NOT NULL,
    "prepaidBalanceCents" INTEGER NOT NULL,
    "confirmedRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "TrainingEnrollmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "guardianAuthorization" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "courtCount" INTEGER NOT NULL,
    "occupiedCourtHours" DECIMAL(8,2) NOT NULL,
    "coachCostCents" INTEGER NOT NULL DEFAULT 0,
    "assistantCostCents" INTEGER NOT NULL DEFAULT 0,
    "materialCostCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "consumedSessions" INTEGER NOT NULL DEFAULT 0,
    "confirmedRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "coachCostAllocatedCents" INTEGER NOT NULL DEFAULT 0,
    "assistantCostAllocatedCents" INTEGER NOT NULL DEFAULT 0,
    "materialCostAllocatedCents" INTEGER NOT NULL DEFAULT 0,
    "growthPointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "feedback" TEXT,
    "operatorId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSettlement" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "effectiveRevenueCents" INTEGER NOT NULL,
    "contractRateBps" INTEGER NOT NULL DEFAULT 2000,
    "venueContributionCents" INTEGER NOT NULL,
    "venueFeeCents" INTEGER NOT NULL DEFAULT 0,
    "trainingPayableVenueCents" INTEGER NOT NULL DEFAULT 0,
    "coachCostCents" INTEGER NOT NULL DEFAULT 0,
    "assistantCostCents" INTEGER NOT NULL DEFAULT 0,
    "materialCostCents" INTEGER NOT NULL DEFAULT 0,
    "acquisitionCostCents" INTEGER NOT NULL DEFAULT 0,
    "marketingCostCents" INTEGER NOT NULL DEFAULT 0,
    "occupiedCourtHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashContributionMarginCents" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRevenueRecognition" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "settlementId" TEXT,
    "effectiveRevenueCents" INTEGER NOT NULL,
    "contractRateBps" INTEGER NOT NULL DEFAULT 2000,
    "venueContributionCents" INTEGER NOT NULL,
    "venueFeeCents" INTEGER NOT NULL DEFAULT 0,
    "trainingPayableVenueCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingRevenueRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" "MerchantLevel" NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "settlementRule" JSONB NOT NULL,
    "cooperationStartsAt" TIMESTAMP(3),
    "cooperationEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "benefitDescription" TEXT NOT NULL,
    "faceValueCents" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "claimLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "issueLimit" INTEGER NOT NULL,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponCode" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CouponStatus" NOT NULL DEFAULT 'ISSUED',
    "holderId" TEXT,
    "redeemedById" TEXT,
    "redeemedMerchantId" TEXT,
    "attributionOrderId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attributedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllianceSettlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "issuedCount" INTEGER NOT NULL,
    "claimedCount" INTEGER NOT NULL,
    "redeemedCount" INTEGER NOT NULL,
    "effectiveNewCustomers" INTEGER NOT NULL,
    "attributedGmvCents" INTEGER NOT NULL,
    "attributedGrossProfitCents" INTEGER NOT NULL,
    "cooperationFeeCents" INTEGER NOT NULL,
    "roi" DECIMAL(12,4),
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "detail" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllianceSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "triggerOrderId" TEXT,
    "triggerType" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING_OBSERVATION',
    "observationEndsAt" TIMESTAMP(3) NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" "InventoryMode" NOT NULL,
    "supplier" TEXT NOT NULL,
    "purchasePriceCents" INTEGER NOT NULL,
    "salePriceCents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "safeStock" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "InventoryTxnType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "orderItemId" TEXT,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'xlsx',
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "downloadUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_openId_key" ON "User"("openId");

-- CreateIndex
CREATE UNIQUE INDEX "User_unionId_key" ON "User"("unionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_referrerId_idx" ON "User"("referrerId");

-- CreateIndex
CREATE INDEX "User_primaryRole_status_idx" ON "User"("primaryRole", "status");

-- CreateIndex
CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_merchantId_key" ON "UserRole"("userId", "role", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfile_userId_key" ON "MemberProfile"("userId");

-- CreateIndex
CREATE INDEX "MemberProfile_level_membershipExpiresAt_idx" ON "MemberProfile"("level", "membershipExpiresAt");

-- CreateIndex
CREATE INDEX "MemberProfile_sourceChannel_createdAt_idx" ON "MemberProfile"("sourceChannel", "createdAt");

-- CreateIndex
CREATE INDEX "Student_guardianId_idx" ON "Student"("guardianId");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_type_key" ON "Account"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AccountTransaction_idempotencyKey_key" ON "AccountTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountTransaction_accountId_createdAt_idx" ON "AccountTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountTransaction_orderId_idx" ON "AccountTransaction"("orderId");

-- CreateIndex
CREATE INDEX "SystemParameter_key_effectiveFrom_effectiveTo_idx" ON "SystemParameter"("key", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "SystemParameter_key_effectiveFrom_key" ON "SystemParameter"("key", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_objectType_objectId_createdAt_idx" ON "AuditLog"("objectType", "objectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE INDEX "RiskEvent_status_severity_createdAt_idx" ON "RiskEvent"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvent_userId_createdAt_idx" ON "RiskEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Court_code_key" ON "Court"("code");

-- CreateIndex
CREATE INDEX "Court_enabled_sortOrder_idx" ON "Court"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_code_key" ON "TimeSlot"("code");

-- CreateIndex
CREATE INDEX "PriceRule_timeSlotId_effectiveFrom_effectiveTo_idx" ON "PriceRule"("timeSlotId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "CourtBooking_orderId_key" ON "CourtBooking"("orderId");

-- CreateIndex
CREATE INDEX "CourtBooking_courtId_startsAt_status_idx" ON "CourtBooking"("courtId", "startsAt", "status");

-- CreateIndex
CREATE INDEX "CourtBooking_memberId_startsAt_idx" ON "CourtBooking"("memberId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourtBooking_courtId_startsAt_endsAt_key" ON "CourtBooking"("courtId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipProduct_code_key" ON "MembershipProduct"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSubscription_orderId_key" ON "MemberSubscription"("orderId");

-- CreateIndex
CREATE INDEX "MemberSubscription_memberId_status_endsAt_idx" ON "MemberSubscription"("memberId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Order_externalOrderNo_key" ON "Order"("externalOrderNo");

-- CreateIndex
CREATE INDEX "Order_memberId_createdAt_idx" ON "Order"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_businessType_subjectAccount_createdAt_idx" ON "Order"("businessType", "subjectAccount", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_sourceChannel_createdAt_idx" ON "Order"("sourceChannel", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTradeNo_key" ON "Payment"("providerTradeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_refundNo_key" ON "Refund"("refundNo");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundNo_key" ON "Refund"("providerRefundNo");

-- CreateIndex
CREATE INDEX "Refund_orderId_status_idx" ON "Refund"("orderId", "status");

-- CreateIndex
CREATE INDEX "Refund_status_requestedAt_idx" ON "Refund"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Game_code_key" ON "Game"("code");

-- CreateIndex
CREATE INDEX "Game_status_startsAt_idx" ON "Game"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Game_hostId_startsAt_idx" ON "Game"("hostId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameRegistration_orderId_key" ON "GameRegistration"("orderId");

-- CreateIndex
CREATE INDEX "GameRegistration_gameId_status_idx" ON "GameRegistration"("gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameRegistration_gameId_userId_key" ON "GameRegistration"("gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "HostProfile_userId_key" ON "HostProfile"("userId");

-- CreateIndex
CREATE INDEX "HostReward_hostId_status_idx" ON "HostReward"("hostId", "status");

-- CreateIndex
CREATE INDEX "HostReward_gameId_idx" ON "HostReward"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_code_key" ON "Event"("code");

-- CreateIndex
CREATE INDEX "Event_status_startsAt_idx" ON "Event"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventTeam_orderId_key" ON "EventTeam"("orderId");

-- CreateIndex
CREATE INDEX "EventTeam_eventId_status_idx" ON "EventTeam"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventTeam_eventId_seed_key" ON "EventTeam"("eventId", "seed");

-- CreateIndex
CREATE INDEX "EventMatch_eventId_round_status_idx" ON "EventMatch"("eventId", "round", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventMatch_eventId_round_teamAId_key" ON "EventMatch"("eventId", "round", "teamAId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProduct_code_key" ON "TrainingProduct"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingClass_code_key" ON "TrainingClass"("code");

-- CreateIndex
CREATE INDEX "TrainingClass_productId_active_idx" ON "TrainingClass"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_enrollmentNo_key" ON "TrainingEnrollment"("enrollmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_orderId_key" ON "TrainingEnrollment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_contractNo_key" ON "TrainingEnrollment"("contractNo");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_buyerId_status_idx" ON "TrainingEnrollment"("buyerId", "status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_classId_status_idx" ON "TrainingEnrollment"("classId", "status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_studentId_idx" ON "TrainingEnrollment"("studentId");

-- CreateIndex
CREATE INDEX "TrainingSession_startsAt_status_idx" ON "TrainingSession"("startsAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_classId_startsAt_key" ON "TrainingSession"("classId", "startsAt");

-- CreateIndex
CREATE INDEX "TrainingAttendance_enrollmentId_status_idx" ON "TrainingAttendance"("enrollmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAttendance_sessionId_enrollmentId_key" ON "TrainingAttendance"("sessionId", "enrollmentId");

-- CreateIndex
CREATE INDEX "TrainingSettlement_status_periodEnd_idx" ON "TrainingSettlement"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSettlement_periodStart_periodEnd_key" ON "TrainingSettlement"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRevenueRecognition_attendanceId_key" ON "TrainingRevenueRecognition"("attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRevenueRecognition_idempotencyKey_key" ON "TrainingRevenueRecognition"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TrainingRevenueRecognition_createdAt_idx" ON "TrainingRevenueRecognition"("createdAt");

-- CreateIndex
CREATE INDEX "TrainingRevenueRecognition_settlementId_idx" ON "TrainingRevenueRecognition"("settlementId");

-- CreateIndex
CREATE INDEX "TrainingRevenueRecognition_enrollmentId_idx" ON "TrainingRevenueRecognition"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_code_key" ON "Merchant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponTemplate_code_key" ON "CouponTemplate"("code");

-- CreateIndex
CREATE INDEX "CouponTemplate_merchantId_enabled_validTo_idx" ON "CouponTemplate"("merchantId", "enabled", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "CouponCode_code_key" ON "CouponCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponCode_idempotencyKey_key" ON "CouponCode"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CouponCode_templateId_status_idx" ON "CouponCode"("templateId", "status");

-- CreateIndex
CREATE INDEX "CouponCode_holderId_status_idx" ON "CouponCode"("holderId", "status");

-- CreateIndex
CREATE INDEX "CouponCode_redeemedMerchantId_redeemedAt_idx" ON "CouponCode"("redeemedMerchantId", "redeemedAt");

-- CreateIndex
CREATE INDEX "AllianceSettlement_status_periodEnd_idx" ON "AllianceSettlement"("status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "AllianceSettlement_merchantId_periodStart_periodEnd_key" ON "AllianceSettlement"("merchantId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ReferralReward_referrerId_status_idx" ON "ReferralReward"("referrerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_newUserId_triggerType_triggerOrderId_key" ON "ReferralReward"("newUserId", "triggerType", "triggerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryItem_enabled_category_idx" ON "InventoryItem"("enabled", "category");

-- CreateIndex
CREATE INDEX "InventoryItem_stock_safeStock_idx" ON "InventoryItem"("stock", "safeStock");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key" ON "InventoryTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_createdAt_idx" ON "InventoryTransaction"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_userId_createdAt_idx" ON "ExportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemParameter" ADD CONSTRAINT "SystemParameter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_trainingClassId_fkey" FOREIGN KEY ("trainingClassId") REFERENCES "TrainingClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MemberProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MembershipProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRegistration" ADD CONSTRAINT "GameRegistration_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRegistration" ADD CONSTRAINT "GameRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRegistration" ADD CONSTRAINT "GameRegistration_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostProfile" ADD CONSTRAINT "HostProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostReward" ADD CONSTRAINT "HostReward_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostReward" ADD CONSTRAINT "HostReward_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTeam" ADD CONSTRAINT "EventTeam_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTeam" ADD CONSTRAINT "EventTeam_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTeam" ADD CONSTRAINT "EventTeam_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "EventTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "EventTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClass" ADD CONSTRAINT "TrainingClass_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TrainingProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TrainingProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TrainingClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TrainingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAttendance" ADD CONSTRAINT "TrainingAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAttendance" ADD CONSTRAINT "TrainingAttendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TrainingEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAttendance" ADD CONSTRAINT "TrainingAttendance_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRevenueRecognition" ADD CONSTRAINT "TrainingRevenueRecognition_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "TrainingAttendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRevenueRecognition" ADD CONSTRAINT "TrainingRevenueRecognition_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TrainingEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRevenueRecognition" ADD CONSTRAINT "TrainingRevenueRecognition_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "TrainingSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponTemplate" ADD CONSTRAINT "CouponTemplate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_redeemedMerchantId_fkey" FOREIGN KEY ("redeemedMerchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_attributionOrderId_fkey" FOREIGN KEY ("attributionOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceSettlement" ADD CONSTRAINT "AllianceSettlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_triggerOrderId_fkey" FOREIGN KEY ("triggerOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants that must remain true even when data is written outside the API.
ALTER TABLE "Account" ADD CONSTRAINT "Account_nonnegative_balances" CHECK (balance >= 0 AND "frozenBalance" >= 0 AND "frozenBalance" <= balance);
ALTER TABLE "Order" ADD CONSTRAINT "Order_valid_amounts" CHECK (
  "listAmountCents" >= 0 AND "discountCents" >= 0 AND "payableCents" >= 0 AND
  "paidCents" >= 0 AND "refundedCents" >= 0 AND
  "payableCents" = "listAmountCents" - "discountCents" AND "refundedCents" <= "paidCents"
);
ALTER TABLE "TrainingSettlement" ADD CONSTRAINT "TrainingSettlement_contract_invariants" CHECK (
  "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
  "effectiveRevenueCents" >= 0 AND "venueContributionCents" = ROUND("effectiveRevenueCents" * 2000 / 10000.0)
);
ALTER TABLE "TrainingRevenueRecognition" ADD CONSTRAINT "TrainingRecognition_contract_invariants" CHECK (
  "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
  "effectiveRevenueCents" >= 0 AND "venueContributionCents" = ROUND("effectiveRevenueCents" * 2000 / 10000.0)
);
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_single_game_to_21" CHECK (
  ("scoreA" IS NULL AND "scoreB" IS NULL) OR
  ("scoreA" BETWEEN 0 AND 21 AND "scoreB" BETWEEN 0 AND 21 AND (("scoreA" = 21 AND "scoreB" <= 20) OR ("scoreB" = 21 AND "scoreA" <= 20)))
);
ALTER TABLE "CouponCode" ADD CONSTRAINT "CouponCode_redeemed_is_complete" CHECK (
  status <> 'REDEEMED' OR ("holderId" IS NOT NULL AND "redeemedById" IS NOT NULL AND "redeemedMerchantId" IS NOT NULL AND "redeemedAt" IS NOT NULL)
);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_nonnegative_stock" CHECK (stock >= 0 AND "safeStock" >= 0);
