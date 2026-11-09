BEGIN;

CREATE UNIQUE INDEX "HrEmployee_companyId_id_key" ON "HrEmployee"("companyId", "id");
CREATE TABLE "EmployeeAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "EmployeeAsset_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId")
        REFERENCES "HrEmployee"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "EmployeeAsset_companyId_number_key" ON "EmployeeAsset"("companyId", "number");
CREATE INDEX "EmployeeAsset_companyId_employeeId_idx" ON "EmployeeAsset"("companyId", "employeeId");

INSERT INTO "Subsystem" ("id","key","title","description","enabled","sortOrder","dependencies","updatedAt")
VALUES ('employee-assets','assets','اموال','ثبت اموال، تحویل به کارکنان و انتقال بین افراد',true,12,'["core","hr"]',now());
INSERT INTO "Permission" ("id","key","title") VALUES
  ('employee-assets-view','assets:register:view','مشاهده اموال کارکنان'),
  ('employee-assets-manage','assets:register:manage','ثبت و ویرایش اموال کارکنان'),
  ('employee-assets-self','assets:register:self','مشاهدهٔ اموال تحویلی به خود');
INSERT INTO "Group" ("id","name","subsystemId") VALUES
  ('employee-assets-manager','مدیر اموال','employee-assets'),
  ('employee-assets-viewer','مشاهده‌گر اموال','employee-assets'),
  ('employee-assets-personal','اموال من','employee-assets');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES
  ('employee-assets-manager','employee-assets-view'),('employee-assets-manager','employee-assets-manage'),
  ('employee-assets-manager','employee-assets-self'),('employee-assets-viewer','employee-assets-view'),
  ('employee-assets-personal','employee-assets-self');

-- The imported deputy role has operational access to each enabled business module.
INSERT INTO "UserGroup" ("userId","groupId")
SELECT ug."userId", 'employee-assets-manager' FROM "UserGroup" ug
JOIN "Group" g ON g."id" = ug."groupId"
JOIN "Subsystem" s ON s."id" = g."subsystemId"
WHERE s."key" = 'hr' AND g."name" = 'نمونه پرتال · معاون توسعه و پشتیبانی';
COMMIT;
