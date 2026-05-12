-- Repairs signed before agreement_type supported 'repair' were often saved as agreement_type = installation
-- with roof repair scope only. Normalize so dashboard/report filters that target repair behave consistently.

UPDATE order_form_contracts
SET agreement_type = 'repair'
WHERE agreement_type = 'installation'
  AND COALESCE(scope_roof_repair, false) = true
  AND COALESCE(scope_roof_replacement, false) = false
  AND status = 'completed'
  AND customer_signed_at IS NOT NULL;
