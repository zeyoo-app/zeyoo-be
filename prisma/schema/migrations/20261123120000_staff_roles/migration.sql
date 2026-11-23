-- More back-office roles: each opens only the areas its job needs.
ALTER TYPE "StaffRole" ADD VALUE 'ADMINISTRATOR';
ALTER TYPE "StaffRole" ADD VALUE 'SUPPORT';
ALTER TYPE "StaffRole" ADD VALUE 'FINANCE';
