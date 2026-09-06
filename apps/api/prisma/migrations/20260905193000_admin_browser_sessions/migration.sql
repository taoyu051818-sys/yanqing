CREATE TABLE "AdminLoginChallenge" (
 "id" TEXT PRIMARY KEY, "browserHash" TEXT NOT NULL, "scanHash" TEXT NOT NULL,
 "confirmationCode" TEXT NOT NULL, "browserLabel" TEXT NOT NULL,
 "approvedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL, "approvedAt" TIMESTAMP(3), "consumedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
 CONSTRAINT "AdminLoginChallenge_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminLoginChallenge_browserHash_key" ON "AdminLoginChallenge"("browserHash");
CREATE INDEX "AdminLoginChallenge_expiresAt_idx" ON "AdminLoginChallenge"("expiresAt");
CREATE INDEX "AdminLoginChallenge_createdAt_idx" ON "AdminLoginChallenge"("createdAt");
CREATE TABLE "AdminBrowserSession" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL, "userId" TEXT NOT NULL, "browserLabel" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
 CONSTRAINT "AdminBrowserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminBrowserSession_tokenHash_key" ON "AdminBrowserSession"("tokenHash");
CREATE INDEX "AdminBrowserSession_userId_expiresAt_idx" ON "AdminBrowserSession"("userId", "expiresAt");
