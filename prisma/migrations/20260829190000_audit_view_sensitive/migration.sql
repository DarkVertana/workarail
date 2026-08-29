-- Records a privileged read of data that is normally never returned.
--
-- Added for the decryption of bank details during a payment run. Ordinary
-- reads are not audited, but access to an employee's account number must be
-- attributable to a named user after the fact.
ALTER TYPE "AuditAction" ADD VALUE 'view_sensitive';
